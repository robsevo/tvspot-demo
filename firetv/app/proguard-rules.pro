# Keep the JS bridge the web app calls to exit at the /tv root.
-keepclassmembers class com.tvspot.tv.MainActivity$TvBridge {
    @android.webkit.JavascriptInterface <methods>;
}
