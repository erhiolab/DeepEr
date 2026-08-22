package app.nori.pet

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

/**
 * 原生模型桥: 由 WebView 注入为 window.NoriBridge.
 * 提供 -> 网关 download_url 下载 ZIP -> 解压到 filesDir/models/<id>/<entryBase>/.
 * 模型文件随后由 shouldInterceptRequest 拦截 "live2d/" 前缀请求从磁盘返回.
 * 全程只用 Android 自带 API, 不依赖浏览器 OPFS / Service Worker.
 */
class ModelBridge(private val appContext: Context) {

    companion object {
        private const val API_BASE = "https://api.elake.top/deeper"
        const val MODELS_ROOT = "models"
    }

    val modelsDir: File
        get() = File(appContext.filesDir, MODELS_ROOT)

    /** 下载并安装模型, 返回 {"ok":true,"entryBase":"Haru"} 或 {"ok":false,"message":"..."} */
    @android.webkit.JavascriptInterface
    fun download(id: String): String {
        return runCatching {
            val modelDir = modelsDir.resolve(safeSegment(id))
            // 已安装则直接复用
            val existing = findEntryBase(modelDir)
            if (existing != null) {
                return ok(existing)
            }
            // 1. 获取签名下载链接
            val url = getDownloadUrl(id)
            // 2. 下载 ZIP 到内存
            val zipBytes = fetchBytes(url)
            // 3. 安全解压
            val installed = installZip(id, zipBytes)
            ok(installed)
        }.getOrElse { e ->
            err(e.message ?: "下载失败")
        }
    }

    /** 已安装模型列表 -> [{"id":...,"entryBase":...}] (JSON 字符串) */
    @android.webkit.JavascriptInterface
    fun listInstalled(): String {
        val arr = JSONArray()
        runCatching {
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

    /** 删除模型目录 */
    @android.webkit.JavascriptInterface
    fun delete(id: String) {
        runCatching { modelsDir.resolve(safeSegment(id)).deleteRecursively() }
    }

    /** 在 <modelDir> 内定位 *.model3.json 所处最浅目录, 返回该目录名 (entry base) */
    private fun findEntryBase(modelDir: File): String? {
        if (!modelDir.isDirectory) return null
        return modelDir.walkTopDown()
            .filter { it.isFile && it.name.endsWith("model3.json", true) }
            .mapNotNull { f ->
                val rel = f.toRelativeString(modelDir).replace('\\', '/')
                val parts = rel.split("/").filter { it.isNotEmpty() }
                val base = when {
                    parts.isEmpty()-> null
                    parts.size <= 1 -> f.name.removeSuffix(".model3.json")
                    else -> parts[0]
                }
                base?.takeIf { it.isNotBlank() }
            }
            .minByOrNull { depthOfEntry(modelDir, it) }
    }

    /** 估算 entry 所在目录深度 (越小越浅) */
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

    private fun fetchBytes(url: String): ByteArray {
        val u = URL(url)
        val conn = (u.openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
        }
        try {
            if (conn.responseCode !in 200..299) throw RuntimeException("下载 ZIP 失败: HTTP ${conn.responseCode}")
            return conn.inputStream.use { it.readBytes() }
        } finally {
            conn.disconnect()
        }
    }

    private fun installZip(id: String, data: ByteArray): String {
        val target = modelsDir.resolve(safeSegment(id))
        if (target.exists()) target.deleteRecursively()
        target.mkdirs()
        val entries = LinkedHashMap<String, ByteArray>()
        ZipInputStream(data.inputStream()).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                if (!entry.isDirectory) entries[sanitize(entry.name)] = zip.readBytes()
                zip.closeEntry()
                entry = zip.nextEntry
            }
        }
        // 定位入口 base
        val entryFiles = entries.filterKeys { it.endsWith(".model3.json", true) }
        val best = entryFiles.keys.minByOrNull { it.count { c -> c == '/' } } ?: throw RuntimeException("模型包缺少 .model3.json")
        val parts = best.split("/")
        val entryBase = parts[parts.size - 1].removeSuffix(".model3.json").trim()
        if (entryBase.isEmpty()) throw RuntimeException("模型入口名无效")
        val prefix = parts.dropLast(1).joinToString("/")
        val outBase = File(target, safeSegment(entryBase))
        for ((rawPath, bytes) in entries) {
            var rel = rawPath
            if (prefix.isNotEmpty() && rel.startsWith("$prefix/")) rel = rel.removePrefix("$prefix/")
            val out = outBase.resolve(sanitizeSegments(rel, entryBase))
            out.parentFile?.mkdirs()
            if (!isSafeChild(out, target)) continue
            FileOutputStream(out).use { it.write(bytes) }
        }
        return entryBase
    }

    private fun isSafeChild(f: File, root: File): Boolean {
        return try {
            f.canonicalFile.toPath().startsWith(root.canonicalFile.toPath())
        } catch (_: Exception) {
            false
        }
    }

    private fun sanitizeSegments(rel: String, entryBase: String): String {
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