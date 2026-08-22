package app.nori.pet

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * 聊天/设置/记忆桥: 由 WebView 注入为 window.NoriChat.
 * - fetchModels / chat 走 OpenAI 兼容接口 (原生调用, 无 CORS 限制)
 * - 网络请求在后台线程执行, 结果通过 JS 回调异步回传, 不阻塞主线程/JS 线程
 * - 聊天记录、记忆、设置写入 <公共 Documents>/NoriPet/, 卸载重装也不丢
 */
class ChatBridge(private val appContext: Context) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private val ioExecutor: ExecutorService = Executors.newCachedThreadPool()

    /** 绑定 WebView(用于把后台线程结果回调回 JS) */
    fun attach(v: WebView) { webView = v }

    private val storeDir: File
        get() = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
            "NoriPet"
        )

    private fun fileOf(name: String): File = File(storeDir, name)

    @android.webkit.JavascriptInterface
    fun isStorageReady(): Boolean {
        // Android 11+ 用"所有文件访问"是否开启判断; 老版本看 WRITE_EXTERNAL_STORAGE
        return if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            appContext.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
        }
    }

    /** 跳转系统"所有文件访问"设置页, 引导授权 (存储未就绪时可调用) */
    @android.webkit.JavascriptInterface
    fun requestStoragePermission() {
        mainHandler.post {
            runCatching {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                intent.data = android.net.Uri.parse("package:${appContext.packageName}")
                if (appContext is Activity) appContext.startActivity(intent)
            }
        }
    }

    // ---------- 公共存储读写 ----------

    @android.webkit.JavascriptInterface
    fun readFile(name: String): String {
        return runCatching {
            val f = fileOf(safeName(name))
            if (!f.isFile) return ""
            f.readText()
        }.getOrElse { "" }
    }

    @android.webkit.JavascriptInterface
    fun writeFile(name: String, content: String): String {
        return runCatching {
            storeDir.mkdirs()
            fileOf(safeName(name)).writeText(content)
            "ok"
        }.getOrElse { "err:${it.message}" }
    }

    /** 追加一行到记忆文件 (行式文本, 永不覆盖) */
    @android.webkit.JavascriptInterface
    fun appendMemory(text: String): String {
        return runCatching {
            storeDir.mkdirs()
            val f = fileOf("memory.txt")
            val exist = if (f.isFile) f.readText().trim() else ""
            f.writeText((if (exist.isEmpty()) "" else "$exist\n") + text.trim())
            "ok"
        }.getOrElse { "err:${it.message}" }
    }

    @android.webkit.JavascriptInterface
    fun readMemory(): String {
        return runCatching {
            val f = fileOf("memory.txt")
            if (!f.isFile) "" else f.readText()
        }.getOrElse { "" }
    }

    // ---------- 异步网络接口 (后台线程 → 回调 JS) ----------

    @android.webkit.JavascriptInterface
    fun fetchModels(baseUrl: String, apiKey: String) {
        ioExecutor.execute {
            val json = fetchModelsSync(baseUrl, apiKey)
            postToJs("__noriModelsRes", json)
        }
    }

    @android.webkit.JavascriptInterface
    fun chat(baseUrl: String, apiKey: String, model: String, messagesJson: String) {
        ioExecutor.execute {
            val json = chatSync(baseUrl, apiKey, model, messagesJson)
            postToJs("__noriChatRes", json)
        }
    }

    /** 结果经主线程 evaluateJavascript 回传 JS, 避免并发/时序问题 */
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

    // ---------- OpenAI 兼容实现 ----------

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

    // ---------- helpers ----------

    private fun normalizeBase(base: String): String {
        var b = base.trim()
        if (b.isEmpty()) b = "https://api.openai.com/v1"
        b = b.trimEnd('/')
        // 兼容填了完整 chat/completions 的情况
        if (b.endsWith("/chat/completions")) b = b.removeSuffix("/chat/completions")
        if (!b.startsWith("http")) b = "https://$b"
        return b
    }

    private fun open(
        url: String,
        method: String,
        apiKey: String,
        contentType: String?,
        body: String?
    ): HttpURLConnection {
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

    private fun safeName(name: String): String =
        name.replace(Regex("[^A-Za-z0-9._-]"), "_").takeIf { it.isNotBlank() } ?: "data"
}