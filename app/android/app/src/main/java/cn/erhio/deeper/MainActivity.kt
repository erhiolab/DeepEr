package cn.erhio.deeper

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import java.io.File

class MainActivity : AppCompatActivity() {

    private val filePicker = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { uri ->
        modelBridge.setPickedUri(uri)
        modelBridge.importPicked()
    }

    private lateinit var webView: WebView
    private lateinit var errorView: TextView
    private lateinit var assetLoader: WebViewAssetLoader
    private val modelBridge by lazy { ModelBridge(applicationContext) }
    private val chatBridge by lazy { ChatBridge(this) }
    private val ttsBridge by lazy { TtsBridge(applicationContext) }

    companion object {
        private const val ENTRY_URL = "https://appassets.androidplatform.net/assets/web/index.html"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        errorView = findViewById(R.id.errorView)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.addJavascriptInterface(modelBridge, "NoriBridge")
        webView.addJavascriptInterface(chatBridge, "NoriChat")
        webView.addJavascriptInterface(ttsBridge, "NoriTTS")
        chatBridge.attach(webView)
        modelBridge.onPickFile = { filePicker.launch("*/*") }
        modelBridge.attach(webView)
        ttsBridge.attach(webView)

        setupImmersive()
        setupWebView()
        loadPage()
    }

    private fun setupImmersive() {
        window.statusBarColor = 0xFF0F172A.toInt()
        window.navigationBarColor = 0xFF0F172A.toInt()
        runCatching {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                val controller = window.insetsController ?: return@runCatching
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(WindowInsets.Type.systemBars())
            } else {
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                    )
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "RequiresFeature")
    private fun setupWebView() {
        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.databaseEnabled = true
        settings.setSupportZoom(false)
        settings.displayZoomControls = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.textZoom = 100
        webView.setBackgroundColor(0xFF0F172A.toInt())
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: android.webkit.ConsoleMessage?): Boolean {
                if (message?.message()?.isNotBlank() == true) {
                    android.util.Log.d("WebViewConsole", "${message.message()} [src=${message.sourceId()}:${message.lineNumber()}]")
                }
                return super.onConsoleMessage(message)
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url ?: return null
                serveModelFile(url.toString())?.let { return it }
                return assetLoader.shouldInterceptRequest(url)
            }

            private fun serveModelFile(url: String): WebResourceResponse? {
                val marker = "/live2d/"
                val idx = url.indexOf(marker)
                if (idx < 0) return null
                val rel = url.substring(idx + marker.length)
                if (rel.isBlank()) return null
                val file = File(modelBridge.modelsDir, rel)
                if (!file.exists() || !file.isFile) return null
                val stream = try { file.inputStream() } catch (_: Exception) { return null }
                val mime = mimeFor(rel)
                return WebResourceResponse(mime, null, stream)
            }

            private fun mimeFor(name: String): String = when {
                name.endsWith(".json", true) -> "application/json"
                name.endsWith(".png", true) -> "image/png"
                name.endsWith(".webp", true) -> "image/webp"
                name.endsWith(".jpg", true) || name.endsWith(".jpeg", true) -> "image/jpeg"
                name.endsWith(".gif", true) -> "image/gif"
                name.endsWith(".moc3", true) -> "application/octet-stream"
                else -> "application/octet-stream"
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    errorView.text = "页面加载失败: ${error?.description}\n请先执行 web-src 下的构建脚本"
                    errorView.visibility = View.VISIBLE
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                errorView.visibility = View.GONE
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_OFF)
        }
    }

    private fun loadPage() {
        runCatching {
            assets.open("web/index.html").close()
        }.onFailure {
            errorView.text =
                "前端资源未找到。\n请先在 web-src 目录执行:\n  pnpm install\n  pnpm build\n然后重新构建 APP。"
            errorView.visibility = View.VISIBLE
            return
        }
        webView.loadUrl(ENTRY_URL)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) setupImmersive()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        setupImmersive()
    }

    override fun onDestroy() {
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }
}
