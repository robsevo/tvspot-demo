# TVSpot on a Fire TV Stick (Fire OS / Android)

This folder is a complete Android app package source. Like the Samsung/Tizen
package in `../tizen/`, it is a **thin wrapper**: one Activity holding a
full-screen WebView that loads the hosted Vercel deployment's `/tv` routes.
All logic, auth, and the API proxy stay on the server — the Fire TV app picks
up every deploy automatically, and you only ever rebuild the APK if this
wrapper itself changes.

**This is why the Fire TV and Samsung apps look and behave identically**: they
are not two implementations of the same design, they are two shells around the
*same* `/tv` pages. A UI change ships to both at once, with no re-packaging of
either.

The `/tv` experience also works in Fire TV's Silk browser directly
(`https://<your-domain>/tv`); TV browsers hitting `/` are redirected to `/tv`
by user-agent. The wrapper app is nicer (real home-screen tile with a banner,
no address bar, remote Back key behaves).

## Build

Toolchain already present on this machine:

- JDK 21 — `~/android-studio/jbr`
- Android SDK — `~/Android/Sdk` (set in `local.properties`)
- Gradle 9.4.1 via the wrapper, AGP 9.2.0, Kotlin 2.2.10

```bash
cd firetv
JAVA_HOME=~/android-studio/jbr ./gradlew :app:assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk   (~2.2 MB)
```

`minSdk` is 22 so the APK also installs on Fire OS 5 sticks.

## Install on the stick

1. On the Fire TV: **Settings → My Fire TV → Developer Options → ADB
   Debugging: On**. (If Developer Options is hidden, go to Settings → My Fire
   TV → About and click *Fire TV Stick* seven times.)
2. Find its IP: **Settings → My Fire TV → About → Network**.

```bash
adb connect <stick-ip>:5555
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.tvspot.tv/.MainActivity      # optional: launch it
```

The app appears in the Fire TV **Your Apps & Channels** row with the TVSpot
banner. Launch it — it shows "Starting TVSpot…" then lands on the TV login.
Sign in once with "Remember on this TV" checked; after that the nightly 4 AM
logout re-signs itself in silently.

## Remote controls in the app

Identical to the Samsung app, because it is the same web UI:

| Key | Browsing | Live player | VOD player |
|-----|----------|-------------|------------|
| D-pad | move focus | Up/Down channel · Left/Right source | Left/Right seek 15s |
| Select | open item | info overlay (sources/recheck) | pause/resume |
| Back | previous page (exits at Home) | close overlay / leave player | stop playback |
| Play/Pause | — | pause/resume | pause/resume |

## How the wrapper hands off to the web app

Three seams, and nothing else:

1. **Startup** — probe `/api/version`, then load `/tv/login`. Targeting
   `/tv/login` rather than `/tv` is load-bearing and carried over verbatim from
   the Tizen wrapper: a direct cold load of `/tv` server-renders and hydrates
   the entire home screen at once, which wedges low-RAM TV boxes. Going through
   the trivial login page lets it hand off to `/tv` as a *client-side*
   navigation into an already-warm runtime. The probe and the navigation are
   both watchdogged and auto-retry, because a cold TV's network stack is often
   not up yet at launch.

2. **Back key** — Android delivers `KEYCODE_BACK` to the Activity, never to the
   page, while the web app listens for the Tizen back code (10009).
   `MainActivity` re-dispatches it as that synthetic key, so the page's own back
   stack (overlays → players → `router.back()`) stays the single authority on
   both TVs.

3. **Exit** — when that back stack bottoms out at the `/tv` root, the page calls
   `exitTvApp()` in `lib/tv.ts`, which finds the `TVSpotAndroid` JS bridge this
   Activity injects and calls `finish()`. On Samsung the same function finds the
   `tizen` global instead.

## Caveats

- **WebView version varies by stick.** Fire OS 5 devices ship a much older
  Chromium than Fire OS 7/8. If the app white-screens on an old stick, the JS
  bundle syntax is the first suspect — fixable with a browserslist/transpile
  target change in the Next config. Report which stick model it is.
- `usesCleartextTraffic` is **false** and a bundled ISRG Root X1 is trusted
  alongside the system CA store, so Let's Encrypt chains validate on Fire OS 5,
  whose CA store predates that root.
- `mediaPlaybackRequiresUserGesture` is disabled — there is no tap on a remote,
  so streams must be allowed to start on their own.
- Minification is off on purpose: the `@JavascriptInterface` exit bridge must
  not be stripped, and there is nothing here worth shrinking.

## Release build / distribution

```bash
keytool -genkey -v -keystore tvspot-firetv.jks \
    -keyalg RSA -keysize 2048 -validity 10000 -alias tvspot
# add a signingConfig to app/build.gradle.kts, then:
JAVA_HOME=~/android-studio/jbr ./gradlew :app:assembleRelease
```

Sideload the resulting APK the same way as the debug one.
