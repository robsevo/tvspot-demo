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

Public installs go through the **Downloader** app (AFTVnews) on the stick, so the
build has to be signed with the release key and published at a URL a stranger can
reach with no cookie.

### The signing key — read this before touching anything

The release keystore is **not in this repo**. It lives at
`~/.config/tvspot/tvspot-release.jks`, and `firetv/keystore.properties`
(gitignored) holds its path and passwords.

Android identifies an installed app by `applicationId` + *signing certificate*.
Once a stranger has installed a signed build, only the **same key** can ever
upgrade it in place. Lose the key and every user must uninstall — losing their
remembered session — before they can move to a new build. Back up **both** files
off this machine.

Current cert: `CN=TVSpot, O=TVSpot, C=CA`, RSA 4096, SHA-256 fingerprint
`7B:74:A8:72:65:51:F2:1E:87:D4:A1:B9:2C:E6:D1:20:01:38:6A:8F:F7:6B:56:5F:83:22:5E:9B:B0:47:72:DA`.
Verify any APK before publishing it:

```bash
PATH=~/android-studio/jbr/bin:$PATH \
  ~/Android/Sdk/build-tools/35.0.0/apksigner verify --print-certs <apk>
```

v1 signing is enabled alongside v2/v3 because `minSdk` 22 keeps Fire OS 5 sticks
in scope and those only understand v1 (JAR) signatures.

### Cutting a release

1. **Bump `versionCode`** in `app/build.gradle.kts`. Fire OS refuses an APK whose
   `versionCode` is ≤ the installed one, so a forgotten bump means nobody
   upgrades. Bump `versionName` too if it's a user-visible change.
2. Build and publish:

```bash
cd firetv
JAVA_HOME=~/android-studio/jbr ./gradlew :app:assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../public/tvspot.apk
cd .. && git add public/tvspot.apk && git commit && git push origin deploy
gh workflow run "Nightly link refresh" -f mode=deploy-only
```

The build fails loudly if `keystore.properties` is missing — otherwise AGP
quietly emits `app-release-unsigned.apk`, which looks fine and then fails to
install on every stick it reaches.

### How people install it

`public/tvspot.apk` is served by the Next app at a path that is **public by
design** — `middleware.ts` allowlists it, because the person fetching it has no
account yet. The APK is only a WebView shell that lands on `/tv/login`, so there
is nothing to protect. Two seams make it work with Downloader:

- The path ends in **`.apk`**, and `next.config.ts` serves it as
  `application/vnd.android.package-archive`. Downloader decides "file to install"
  vs "web page to render" from that; an extensionless path gets rendered.
- `/fire` is the human-typable alias and 307s to `/tvspot.apk`, so the URL that
  finally lands in Downloader still carries the extension.

Live at `https://tv.example.com/tvspot.apk` (own domain on purpose — the AFTVnews
short code registered against it is **permanent and uneditable**, so the target
had to be a hostname that can be repointed at a different host forever).

**Downloader code: `8167020`** — also reachable as `aftv.news/8167020`. That code
is welded to the URL above for good: it cannot be edited, re-pointed or deleted,
and one URL can only ever hold one code. If the APK has to move, the fix is to
keep serving `tv.example.com/tvspot.apk` (repoint the DNS, or redirect the path) —
never to mint a second code, which would strand everyone holding the first.

On the stick: **Settings → My Fire TV → Developer Options → Install unknown
apps → Downloader: On**, then enter the code or URL in Downloader.

> A stick that already has a **debug** build installed cannot take the release
> APK over the top — different signing key, `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
> Uninstall the old one first. This applies to our own test sticks, not to new
> users.
