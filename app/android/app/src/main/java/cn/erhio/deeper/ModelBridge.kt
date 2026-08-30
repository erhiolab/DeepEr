package cn.erhio.deeper

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.zip.ZipInputStream

class ModelBridge(private val appContext: Context) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private val ioExecutor: ExecutorService = Executors.newCachedThreadPool()
    private var pickedUri: Uri? = null

    var onPickFile: (() -> Unit)? = null

    fun attach(v: WebView) { webView = v }

    fun setPickedUri(uri: Uri?) { pickedUri = uri }

    companion object {
        private const val API_BASE = "https://api.elake.top/deeper"
        const val MODELS_ROOT = "DeepEr/models"
    }

    val modelsDir: File
        get() = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            MODELS_ROOT
        )

    private fun migrateLegacyModels() {
        val legacy = File(appContext.filesDir, "models")
        if (!legacy.isDirectory) return
        modelsDir.mkdirs()
        legacy.listFiles()?.forEach { dir ->
            val target = File(modelsDir, dir.name)
            if (target.exists()) return@forEach
            if (!dir.renameTo(target)) {
                runCatching { dir.copyRecursively(target, overwrite = true) }
            }
        }
        runCatching { legacy.deleteRecursively() }
    }

    @android.webkit.JavascriptInterface
    fun pickModel() {
        mainHandler.post { onPickFile?.invoke() }
    }

    @android.webkit.JavascriptInterface
    fun importPicked() {
        ioExecutor.execute {
            val json = runCatching {
                val uri = pickedUri ?: return@runCatching err("未选择文件")
                if (!ChatBridge.storageReady(appContext)) return@runCatching err("请先授予文件访问权限")
                migrateLegacyModels()
                if (!modelsDir.isDirectory && !modelsDir.mkdirs()) return@runCatching err("无法创建模型目录")
                val displayName = queryDisplayName(uri) ?: "import_${System.currentTimeMillis()}.zip"
                val id = safeSegment(displayName.removeSuffix(".zip").removeSuffix(".ZIP").ifEmpty { "import_${System.currentTimeMillis()}" })
                val modelDir = modelsDir.resolve(id)
                val existing = findEntryBase(modelDir)
                if (existing != null) return@runCatching ok(existing)
                val cacheZip = File(appContext.cacheDir, "import_$id.zip")
                appContext.contentResolver.openInputStream(uri)!!.use { input ->
                    cacheZip.outputStream().use { output -> input.copyTo(output, 128 * 1024) }
                }
                val entryBase = installZip(id, cacheZip)
                cacheZip.delete()
                ok(entryBase)
            }.getOrElse { e -> err(e.message ?: "导入失败") }
            postToJs("__noriModelRes", json)
        }
    }

    private fun queryDisplayName(uri: Uri): String? = runCatching {
        appContext.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && c.moveToFirst()) c.getString(idx) else null
        }
    }.getOrNull()

    @android.webkit.JavascriptInterface
    fun download(id: String) {
        ioExecutor.execute {
            val json = runCatching {
                if (!ChatBridge.storageReady(appContext)) {
                    return@runCatching err("请先在设置中授予文件访问权限, 再下载模型")
                }
                migrateLegacyModels()
                if (!modelsDir.isDirectory && !modelsDir.mkdirs()) {
                    return@runCatching err("无法创建模型目录, 请检查存储权限")
                }
                val modelDir = modelsDir.resolve(safeSegment(id))
                val existing = findEntryBase(modelDir)
                if (existing != null) return@runCatching ok(existing)
                val url = getDownloadUrl(id)
                val zipFile = File(appContext.cacheDir, "model_${safeSegment(id)}.zip")
                downloadToFile(url, zipFile)
                val entryBase = installZip(id, zipFile)
                zipFile.delete()
                ok(entryBase)
            }.getOrElse { e ->
                err(e.message ?: "下载失败")
            }
            postToJs("__noriModelRes", json)
        }
    }

    private fun postToJs(fn: String, json: String) {
        mainHandler.post {
            runCatching {
                webView?.evaluateJavascript("window.$fn && window.$fn(${JSONObject.quote(json)})", null)
            }
        }
    }

    @android.webkit.JavascriptInterface
    fun listInstalled(): String {
        val arr = JSONArray()
        runCatching {
            migrateLegacyModels()
            val root = modelsDir
            root.listFiles()?.forEach { dir ->
                dir.takeIf { it.isDirectory }?.let { d ->
                    findEntryBase(d)?.let { base ->
                        arr.put(JSONObject().put("id", d.name).put("entryBase", base))
                    }
                }
            }
        }
        return arr.toString()
    }

    @android.webkit.JavascriptInterface
    fun delete(id: String) {
        runCatching { modelsDir.resolve(safeSegment(id)).deleteRecursively() }
    }

    private fun findEntryBase(modelDir: File): String? {
        if (!modelDir.isDirectory) return null
        return modelDir.walkTopDown()
            .filter { it.isFile && it.name.endsWith("model3.json", true) }
            .mapNotNull { f ->
                val rel = f.toRelativeString(modelDir).replace('\\', '/')
                val parts = rel.split("/").filter { it.isNotEmpty() }
                val base = when {
                    parts.isEmpty() -> null
                    parts.size <= 1 -> f.name.removeSuffix(".model3.json")
                    else -> parts[0]
                }
                base?.takeIf { it.isNotBlank() }
            }
            .minByOrNull { depthOfEntry(modelDir, it) }
    }

    private fun depthOfEntry(modelDir: File, entryBase: String): Int {
        val dir = modelDir.resolve(safeSegment(entryBase))
        val f = File(dir, "$entryBase.model3.json")
        return if (f.exists()) 0 else 1
    }

    private fun getDownloadUrl(id: String): String {
        val u = URL("$API_BASE/resource/download_url?type=live2d&name=${encode(id)}")
        val conn = (u.openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 10_000
            requestMethod = "GET"
        }
        try {
            if (conn.responseCode !in 200..299) throw RuntimeException("获取下载链接失败: HTTP ${conn.responseCode}")
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            if (json.optBoolean("error", false)) throw RuntimeException(json.optString("message", "网关返回错误"))
            return json.optJSONObject("body")?.optString("url") ?: throw RuntimeException("下载链接为空")
        } finally {
            conn.disconnect()
        }
    }

    private fun downloadToFile(url: String, out: File) {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
        }
        try {
            if (conn.responseCode !in 200..299) throw RuntimeException("下载 ZIP 失败: HTTP ${conn.responseCode}")
            conn.inputStream.use { input ->
                FileOutputStream(out).use { output -> input.copyTo(output, 128 * 1024) }
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun installZip(id: String, zipFile: File): String {
        val target = modelsDir.resolve(safeSegment(id))
        if (target.exists()) target.deleteRecursively()
        val tmp = File(modelsDir, ".tmp_$id")
        tmp.deleteRecursively()
        tmp.mkdirs()
        try {
            ZipInputStream(zipFile.inputStream().buffered()).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    if (!entry.isDirectory) {
                        val out = tmp.resolve(sanitize(entry.name))
                        if (isSafeChild(out, tmp)) {
                            out.parentFile?.mkdirs()
                            FileOutputStream(out).use { output -> zip.copyTo(output, 128 * 1024) }
                        }
                    }
                    zip.closeEntry()
                    entry = zip.nextEntry
                }
            }
            val best = tmp.walkTopDown()
                .filter { it.isFile && it.name.endsWith(".model3.json", true) }
                .map { it.toRelativeString(tmp).replace('\\', '/') }
                .minByOrNull { it.count { c -> c == '/' } }
                ?: throw RuntimeException("模型包缺少 .model3.json")
            val parts = best.split("/")
            val entryBase = parts.last().removeSuffix(".model3.json").trim()
            if (entryBase.isEmpty()) throw RuntimeException("模型入口名无效")
            val prefix = parts.dropLast(1).joinToString("/")
            val outBase = File(target, safeSegment(entryBase))
            tmp.walkTopDown().filter { it.isFile }.forEach { f ->
                var rel = f.toRelativeString(tmp).replace('\\', '/')
                if (prefix.isNotEmpty() && rel.startsWith("$prefix/")) rel = rel.removePrefix("$prefix/")
                val out = outBase.resolve(sanitizeSegments(rel))
                if (!isSafeChild(out, target)) return@forEach
                out.parentFile?.mkdirs()
                if (!f.renameTo(out)) f.copyTo(out, overwrite = true)
            }
            return entryBase
        } finally {
            tmp.deleteRecursively()
        }
    }

    private fun isSafeChild(f: File, root: File): Boolean {
        return try {
            f.canonicalFile.toPath().startsWith(root.canonicalFile.toPath())
        } catch (_: Exception) {
            false
        }
    }

    private fun sanitizeSegments(rel: String): String {
        val segs = rel.split("/").filter { it.isNotEmpty() && it != "." && it != ".." }
        return sanitize(segs.joinToString("/"))
    }

    private fun sanitize(raw: String): String = raw.replace("\\", "/")

    private fun safeSegment(s: String): String = s.replace(Regex("[^A-Za-z0-9._-]"), "_")

    private fun encode(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")

    private fun ok(entryBase: String): String =
        JSONObject().put("ok", true).put("entryBase", entryBase).toString()

    private fun err(msg: String): String =
        JSONObject().put("ok", false).put("message", msg).toString()
}
