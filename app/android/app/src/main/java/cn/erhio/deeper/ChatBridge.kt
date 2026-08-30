package cn.erhio.deeper

import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.webkit.WebView
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class ChatBridge(private val appContext: Context) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private val ioExecutor: ExecutorService = Executors.newCachedThreadPool()

    private val cr get() = appContext.contentResolver

    fun attach(v: WebView) { webView = v }

    @android.webkit.JavascriptInterface
    fun isStorageReady(): Boolean = storageReady(appContext)

    @android.webkit.JavascriptInterface
    fun requestStoragePermission() {
        mainHandler.post {
            when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> {
                    if (!Environment.isExternalStorageManager()) {
                        runCatching {
                            val intent = android.content.Intent(
                                android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                Uri.parse("package:${appContext.packageName}")
                            )
                            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                            appContext.startActivity(intent)
                        }.onFailure {
                            runCatching {
                                appContext.startActivity(
                                    android.content.Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                                        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                                )
                            }
                        }
                    }
                }
                Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q -> {
                    (appContext as? Activity)?.requestPermissions(
                        arrayOf(
                            android.Manifest.permission.WRITE_EXTERNAL_STORAGE,
                            android.Manifest.permission.READ_EXTERNAL_STORAGE
                        ),
                        1001
                    )
                }
            }
        }
    }

    @android.webkit.JavascriptInterface
    fun getStorageDir(): String = "Download/DeepEr"

    @android.webkit.JavascriptInterface
    fun setAlarm(hour: Int, minute: Int, label: String): String = runCatching {
        val intent = android.content.Intent(android.provider.AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(android.provider.AlarmClock.EXTRA_HOUR, hour.coerceIn(0, 23))
            putExtra(android.provider.AlarmClock.EXTRA_MINUTES, minute.coerceIn(0, 59))
            if (label.isNotBlank()) putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, label)
            putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, true)
            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        appContext.startActivity(intent)
        "ok"
    }.getOrElse { "err:${it.message}" }

    @android.webkit.JavascriptInterface
    fun battery(): String = runCatching {
        val intent = android.content.Intent(android.content.Intent.ACTION_BATTERY_CHANGED)
        val r = appContext.registerReceiver(null, android.content.IntentFilter(intent.action))
        val level = r?.getIntExtra("level", -1) ?: -1
        val scale = r?.getIntExtra("scale", -1) ?: -1
        val plugged = r?.getIntExtra("plugged", 0) ?: 0
        if (level < 0 || scale <= 0) "{\"error\":1}"
        else "{\"level\":${level * 100 / scale},\"plugged\":$plugged}"
    }.getOrElse { "{\"error\":1}" }

    private fun queryUri(name: String): Uri? {
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val sel = "${MediaStore.MediaColumns.DISPLAY_NAME}=?"
        val cur = cr.query(collection, arrayOf(MediaStore.MediaColumns._ID), sel, arrayOf(name), "${MediaStore.MediaColumns.DATE_ADDED} DESC")
        return cur.use { c ->
            if (c != null && c.moveToFirst()) ContentUris.withAppendedId(collection, c.getLong(0)) else null
        }
    }

    @android.webkit.JavascriptInterface
    fun readFile(name: String): String {
        val n = safeName(name)
        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val uri = queryUri(n) ?: return ""
                cr.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            } else {
                val f = File(legacyDir(), n)
                if (f.isFile) f.readText() else ""
            }
        }.getOrElse { "" }
    }

    @android.webkit.JavascriptInterface
    fun writeFile(name: String, content: String): String {
        val n = safeName(name)
        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                queryUri(n)?.let { cr.delete(it, null, null) }
                val cv = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, n)
                    put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/DeepEr")
                }
                val uri = cr.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), cv)
                    ?: return "err:insert"
                cr.openOutputStream(uri)?.use { it.write(content.toByteArray(Charsets.UTF_8)) } ?: return "err:stream"
                "ok"
            } else {
                if (!isStorageReady()) return "err:perm"
                val dir = legacyDir(); dir.mkdirs()
                File(dir, n).writeText(content)
                "ok"
            }
        }.getOrElse { "err:${it.message}" }
    }

    @android.webkit.JavascriptInterface
    fun appendMemory(text: String): String {
        val cur = readFile(MEMORY_FILE).trim()
        return writeFile(MEMORY_FILE, (if (cur.isEmpty()) "" else "$cur\n") + text.trim())
    }

    @android.webkit.JavascriptInterface
    fun readMemory(): String = readFile(MEMORY_FILE)

    private fun legacyDir(): File = File(
        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
        "DeepEr"
    )

    private fun safeName(name: String): String =
        name.replace(Regex("[^A-Za-z0-9._-]"), "_").takeIf { it.isNotBlank() } ?: "data"

    @android.webkit.JavascriptInterface
    fun fetchModels(baseUrl: String, apiKey: String) {
        ioExecutor.execute {
            postToJs("__noriModelsRes", fetchModelsSync(baseUrl, apiKey))
        }
    }

    @android.webkit.JavascriptInterface
    fun chat(baseUrl: String, apiKey: String, model: String, messagesJson: String) {
        ioExecutor.execute {
            postToJs("__noriChatRes", chatSync(baseUrl, apiKey, model, messagesJson))
        }
    }

    private fun postToJs(fn: String, json: String) {
        mainHandler.post {
            runCatching {
                webView?.evaluateJavascript(
                    "window.$fn && window.$fn(${JSONObject.quote(json)})",
                    null
                )
            }
        }
    }

    private fun fetchModelsSync(baseUrl: String, apiKey: String): String {
        return runCatching {
            val base = normalizeBase(baseUrl)
            val conn = open(base + "/models", "GET", apiKey, null, null)
            val body = conn.readBody()
            val json = JSONObject(body)
            val arr = json.optJSONArray("data") ?: JSONArray()
            val names = JSONArray()
            for (i in 0 until arr.length()) {
                val id = arr.optJSONObject(i)?.optString("id")
                if (!id.isNullOrBlank()) names.put(id)
            }
            JSONObject().put("ok", true).put("models", names).toString()
        }.getOrElse { e ->
            JSONObject().put("ok", false).put("message", e.message ?: "拉取模型失败").toString()
        }
    }

    private fun chatSync(baseUrl: String, apiKey: String, model: String, messagesJson: String): String {
        return runCatching {
            val base = normalizeBase(baseUrl)
            val req = JSONObject()
                .put("model", model)
                .put("messages", JSONArray(messagesJson))
                .put("stream", false)
            val conn = open(base + "/chat/completions", "POST", apiKey, "application/json", req.toString())
            val body = conn.readBody()
            val json = JSONObject(body)
            if (json.has("error")) {
                val err = json.optJSONObject("error")?.optString("message") ?: json.optString("error")
                return JSONObject().put("ok", false).put("message", err.ifBlank { "接口返回错误" }).toString()
            }
            val content = json.optJSONArray("choices")
                ?.optJSONObject(0)
                ?.optJSONObject("message")
                ?.optString("content")
                .orEmpty()
            JSONObject().put("ok", true).put("content", content).toString()
        }.getOrElse { e ->
            JSONObject().put("ok", false).put("message", e.message ?: "请求失败").toString()
        }
    }

    private fun normalizeBase(base: String): String {
        var b = base.trim()
        if (b.isEmpty()) b = "https://api.openai.com/v1"
        b = b.trimEnd('/')
        if (b.endsWith("/chat/completions")) b = b.removeSuffix("/chat/completions")
        if (!b.startsWith("http")) b = "https://$b"
        return b
    }

    private fun open(url: String, method: String, apiKey: String, contentType: String?, body: String?): HttpURLConnection {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 60_000
            requestMethod = method
            if (apiKey.isNotBlank()) setRequestProperty("Authorization", "Bearer $apiKey")
            if (contentType != null) setRequestProperty("Content-Type", contentType)
        }
        if (body != null) {
            conn.doOutput = true
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        return conn
    }

    private fun HttpURLConnection.readBody(): String {
        return try {
            if (responseCode in 200..299) inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
            else {
                val msg = runCatching { errorStream.use { it.readBytes().toString(Charsets.UTF_8) } }.getOrElse { "" }
                throw RuntimeException("HTTP ${responseCode} $msg".trim())
            }
        } finally {
            disconnect()
        }
    }

    companion object {
        private const val MEMORY_FILE = "memory.txt"

        fun storageReady(ctx: Context): Boolean {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                return Environment.isExternalStorageManager()
            }
            return ContextCompat.checkSelfPermission(
                ctx, android.Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
    }
}
