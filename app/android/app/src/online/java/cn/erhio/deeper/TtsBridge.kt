package cn.erhio.deeper

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import org.json.JSONObject
import kotlin.concurrent.thread

class TtsBridge(appContext: Context) {

    private val engine = TtsEngine(appContext)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private var initStarted = false

    fun attach(v: WebView) {
        webView = v
        engine.onEvent = { ev -> post(ev) }
    }

    private fun post(json: String) {
        mainHandler.post {
            runCatching {
                webView?.evaluateJavascript("window.__noriTTSRes && window.__noriTTSRes(${JSONObject.quote(json)})", null)
            }
        }
    }

    @android.webkit.JavascriptInterface
    fun init() {
        if (initStarted && engine.state == TtsEngine.State.READY) {
            post("""{"event":"init-done","ok":true,"message":${JSONObject.quote(engine.initMessage)}}""")
            return
        }
        initStarted = true
        thread {
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND)
            engine.init { msg -> post("""{"event":"init","message":${JSONObject.quote(msg)}}""") }
            post("""{"event":"init-done","ok":${engine.state == TtsEngine.State.READY},"message":${JSONObject.quote(engine.initMessage)}}""")
        }
    }

    @android.webkit.JavascriptInterface
    fun status(): String =
        """{"state":"${engine.state.name.lowercase()}","message":${JSONObject.quote(engine.initMessage)}}"""

    @android.webkit.JavascriptInterface
    fun emotions(): String = org.json.JSONArray(engine.emotionNames()).toString()

    @android.webkit.JavascriptInterface
    fun ready(): Boolean = engine.state == TtsEngine.State.READY

    @android.webkit.JavascriptInterface
    fun synthesize(text: String, emotion: String): Int =
        engine.enqueue(text, emotion.ifBlank { "gentleness" })

    @android.webkit.JavascriptInterface
    fun play(id: Int) = engine.playBuffered(id)

    @android.webkit.JavascriptInterface
    fun stop() = engine.stopAll()
}