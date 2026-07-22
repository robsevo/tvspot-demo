package com.tvspot.tv

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.app.Activity
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * The entire Fire TV app: a full-screen WebView on the hosted /tv experience.
 *
 * This mirrors ../tizen/app.js one-for-one — same probe-then-navigate flow, same
 * timeouts, same auto-retry — because the failure modes are the same (a cold TV
 * whose network stack isn't up yet, or a navigation that never commits). The
 * differences are all Android-specific: the remote's Back key, HTML5 fullscreen
 * video, and the media-autoplay gesture requirement.
 */
class MainActivity : Activity() {

    private companion object {
        /** Deployed origin, no trailing slash. Matches tizen/app.js APP_URL. */
        const val APP_URL = "https://tvspot.vercel.app"

        const val PROBE_TIMEOUT_MS = 6000
        const val PROBE_RETRY_MS = 5000L
        const val NAV_WATCHDOG_MS = 14000L
        const val MAX_NAV_RETRIES = 2

        /**
         * Deliver the remote's Back to the page as the Tizen back code (10009),
         * which is what TvNav already listens for.
         *
         * `keyCode` is NOT part of the standard KeyboardEventInit dictionary —
         * it's a legacy Blink/Gecko extension — so passing it in the init object
         * is silently dropped on some WebViews, and Back would do nothing at all.
         * Defining it as an own accessor after construction shadows the
         * prototype's readonly getter and works on old and new engines alike.
         * `key: 'Escape'` is a belt-and-braces second signal: TvNav treats
         * Escape (27) as Back too, for desktop-browser testing.
         */
        const val BACK_KEY_JS = """
            (function () {
              var e = new KeyboardEvent('keydown', {
                key: 'Escape', bubbles: true, cancelable: true
              });
              try {
                Object.defineProperty(e, 'keyCode', { get: function () { return 10009; } });
                Object.defineProperty(e, 'which',   { get: function () { return 10009; } });
              } catch (err) {}
              window.dispatchEvent(e);
            })();
        """
    }

    private lateinit var web: WebView
    private lateinit var splash: LinearLayout
    private lateinit var status: TextView
    private lateinit var error: TextView
    private lateinit var fullscreenHost: FrameLayout

    private val main = Handler(Looper.getMainLooper())
    private var navAttempts = 0
    private var inFlight = false
    private var loaded = false

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private val navWatchdog = Runnable { onNavStalled() }
    private val retry = Runnable { start() }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        splash = findViewById(R.id.splash)
        status = findViewById(R.id.status)
        error = findViewById(R.id.error)
        fullscreenHost = findViewById(R.id.fullscreen)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // /tv keeps My List + session in localStorage
            loadWithOverviewMode = true
            useWideViewPort = true
            // Streams must start without a tap — there is no tap on a remote.
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            }
        }
        web.setBackgroundColor(0xFF0B0D12.toInt())
        web.addJavascriptInterface(TvBridge(), "TVSpotAndroid")

        web.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                // The navigation committed — the watchdog's job is done.
                main.removeCallbacks(navWatchdog)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                loaded = true
                inFlight = false
                navAttempts = 0
                splash.visibility = View.GONE
                web.requestFocus()
            }

            @Suppress("DEPRECATION")
            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?,
            ) {
                if (!loaded) onNavStalled()
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                err: WebResourceError?,
            ) {
                // Only a failure of the MAIN document is fatal; a dead poster or
                // stream segment must not tear down a working app.
                if (!loaded && request?.isForMainFrame == true) onNavStalled()
            }
        }

        // HTML5 fullscreen video (the /tv player calls requestFullscreen()).
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (customView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                fullscreenHost.addView(
                    view,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    ),
                )
                fullscreenHost.visibility = View.VISIBLE
                view?.requestFocus()
            }

            override fun onHideCustomView() = exitFullscreen()
        }

        start()
    }

    /** Collapse HTML5 fullscreen video. A plain method, not a call back through
     *  WebView.getWebChromeClient() — that getter only exists from API 26 and we
     *  ship to API 22. */
    private fun exitFullscreen() {
        if (customView == null) return
        fullscreenHost.removeAllViews()
        fullscreenHost.visibility = View.GONE
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        web.requestFocus()
    }

    /** Called from the page when Back is pressed at the /tv root (see lib/tv.ts). */
    private inner class TvBridge {
        @JavascriptInterface
        fun exit() {
            main.post { finish() }
        }
    }

    private fun show(statusText: String?, errorText: String?) {
        splash.visibility = View.VISIBLE
        if (statusText == null) {
            status.visibility = View.GONE
        } else {
            status.visibility = View.VISIBLE
            status.text = statusText
        }
        if (errorText == null) {
            error.visibility = View.GONE
        } else {
            error.visibility = View.VISIBLE
            error.text = errorText
        }
    }

    private fun clearTimers() {
        main.removeCallbacks(navWatchdog)
        main.removeCallbacks(retry)
    }

    /**
     * Probe the origin, then navigate. The probe AUTO-RETRIES: at cold launch the
     * TV's network stack is often not up yet, so a one-shot check leaves a dead
     * screen (learned on the Samsung RU7100, and Fire TV behaves the same).
     */
    private fun start() {
        if (inFlight) return
        inFlight = true
        clearTimers()
        show(getString(R.string.status_starting), null)

        thread(isDaemon = true) {
            val ok = probe()
            main.post {
                if (ok) {
                    go()
                } else {
                    inFlight = false
                    show(null, getString(R.string.error_unreachable))
                    main.postDelayed(retry, PROBE_RETRY_MS)
                }
            }
        }
    }

    private fun probe(): Boolean = try {
        val conn = URL("$APP_URL/api/version").openConnection() as HttpURLConnection
        conn.connectTimeout = PROBE_TIMEOUT_MS
        conn.readTimeout = PROBE_TIMEOUT_MS
        conn.requestMethod = "GET"
        val code = conn.responseCode
        conn.disconnect()
        code in 200..499   // any HTTP answer proves the origin is reachable
    } catch (e: Exception) {
        false
    }

    /**
     * Navigate to the app, watchdogged.
     *
     * TARGET IS /tv/login, NOT /tv — load-bearing, exactly as in tizen/app.js.
     * Loading /tv directly as the FIRST document server-renders and hydrates the
     * whole home screen as a cold first paint, which wedges low-RAM TV boxes.
     * Reaching the same /tv through /tv/login paints a trivial page, silently
     * re-signs in with remembered credentials, and hands off to /tv as a
     * CLIENT-SIDE navigation into an already-warm runtime.
     *
     * The cache-busting query guarantees a poisoned service-worker entry can
     * never be handed back for this key.
     */
    private fun go() {
        clearTimers()
        loaded = false
        show(getString(R.string.status_loading), null)
        main.postDelayed(navWatchdog, NAV_WATCHDOG_MS)
        web.loadUrl("$APP_URL/tv/login?b=" + System.currentTimeMillis())
    }

    /** The navigation never committed. Say so, and try again a bounded number of
     *  times — endless silent reloads on a broken backend just hide the problem. */
    private fun onNavStalled() {
        inFlight = false
        navAttempts++
        if (navAttempts > MAX_NAV_RETRIES) {
            show(null, getString(R.string.error_stalled))
            return
        }
        show(getString(R.string.status_retrying), null)
        main.postDelayed({ go() }, 1500)
    }

    /**
     * Remote keys. Arrows/Enter/media keys reach the page as normal DOM key
     * events, so /tv's own D-pad navigation handles them untouched.
     *
     * Back is the exception: Android delivers KEYCODE_BACK to the Activity, never
     * to the page, while /tv listens for the Tizen Back code (10009). We forward
     * it as that synthetic key so ONE web implementation serves both TVs — the
     * page's back stack (overlays, players, router.back) stays authoritative, and
     * it calls TVSpotAndroid.exit() when it's genuinely at the root.
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Fullscreen video first: collapse it rather than leaving the page.
            if (customView != null) {
                exitFullscreen()
                return true
            }
            if (!loaded) {
                // Still on the splash/error screen — Back exits, nothing to go back to.
                finish()
                return true
            }
            web.evaluateJavascript(BACK_KEY_JS, null)
            return true
        }

        // OK/Enter on the splash retries immediately, mirroring the Tizen wrapper.
        if (!loaded &&
            (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)
        ) {
            navAttempts = 0
            inFlight = false
            start()
            return true
        }

        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        web.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onDestroy() {
        clearTimers()
        web.destroy()
        super.onDestroy()
    }
}
