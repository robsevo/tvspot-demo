# TVSpot on a Samsung TV (Tizen)

This folder is a complete Tizen web-app package source. It's a **thin
wrapper**: one local page that redirects the TV's webview to the hosted
Vercel deployment's `/tv` routes. All logic, auth, and the API proxy stay on
the server — the TV app picks up every deploy automatically, and you only
ever re-package if this wrapper itself changes.

The `/tv` experience also works in any TV browser (Samsung's built-in
browser, Fire TV Silk): just open `https://<your-domain>/tv`. TV browsers
hitting `/` are redirected to `/tv` automatically by user-agent. The wrapper
app is nicer (real home-screen tile, no address bar, remote Back key exits).

## One-time setup

1. **Set the app URL**: edit `index.html` and replace
   `https://YOUR-TVSPOT-DOMAIN.vercel.app` with the real deployed origin.

2. **Install Tizen Studio** (with CLI) from
   https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html
   — during install, add the "TV Extensions" package. The `tizen` CLI lands in
   `~/tizen-studio/tools/ide/bin/`.

3. **Create a Samsung certificate** (once): Tizen Studio → Tools →
   Certificate Manager → new **Samsung** certificate (needs a free Samsung
   account). Both an author and a distributor certificate are created.

4. **Put the TV in developer mode**:
   - On the TV: open the **Apps** panel, type `12345` on the remote (a hidden
     dialog opens), switch Developer mode **On**, and enter your computer's
     IP. Reboot the TV.
   - TV and computer must be on the same network.

## Package and install

```bash
# from this tizen/ directory
tizen package -t wgt -s <your-certificate-profile-name> -- .
tizen connect <TV-IP>                 # sdb connects to the TV
tizen install -n TVSpot.wgt -t <target-name-from-`sdb devices`>
```

The app appears in the TV's Apps row. Launch it — it should show
"Starting TVSpot…" then land on the TV login. Sign in once with
"Remember on this TV" checked; after that, the nightly 4 AM logout re-signs
itself in silently.

## Remote controls in the app

| Key | Browsing | Live player | VOD player |
|-----|----------|-------------|------------|
| Arrows | move focus | Up/Down channel · Left/Right source | Left/Right seek 15s |
| Enter | open item | info overlay (sources/recheck) | pause/resume |
| Back | previous page (exits at Home) | close overlay / leave player | stop playback |
| Play/Pause | — | pause/resume | pause/resume |
| Ch +/− | — | channel up/down | — |

## Caveats

- **TV model year**: the webview is an old Chromium (2020 models ≈ Chromium 69,
  2021 ≈ 76, 2022 ≈ 85+). The app targets modern browsers; if it white-screens
  on an older TV, the JS bundle syntax is the first suspect — that's fixable
  with a browserslist/transpile target change in the Next config, so report
  what model year the TV is.
- **Closed captions / subtitles** aren't wired into the TV player UI yet
  (they exist on mobile). Live CEA-608 decoding still happens under the hood.
- The wrapper needs `allow-navigation` kept permissive (`*`) because stream
  CDNs redirect across many hosts.
