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

## One-time setup (done 2026-07-18 on the RU7100 — kept for re-runs)

1. **App URL** is set in `index.html` (https://tvspot.vercel.app).

2. **Tizen Studio CLI** is installed at `~/tizen-studio` (web-cli installer
   from download.tizen.org/sdk/Installer/ — no AUR package needed), plus the
   `Certificate-Manager` and `cert-add-on` packages via
   `~/tizen-studio/package-manager/package-manager-cli.bin install`.

3. **Certificate**: a plain Tizen author certificate + default distributor
   was ENOUGH for developer-mode sideloading on the RU7100 — no
   Samsung-account certificate needed. Profile "tvspot" already exists
   (created with `tizen certificate` / `tizen security-profiles add`).

4. **TV developer mode**: on the TV open the **Apps** panel, type `12345` on
   the remote, switch Developer mode **On**, enter this computer's LAN IP,
   reboot the TV. TV and computer on the same network.

## Package and install

```bash
# from this tizen/ directory
TIZEN=~/tizen-studio/tools/ide/bin/tizen
~/tizen-studio/tools/sdb connect <TV-IP>
$TIZEN package -t wgt -s tvspot -- .
$TIZEN install -n TVSpot.wgt -t <name from `sdb devices`> -- .
$TIZEN run -p TVSpotTVapp.TVSpot -t <name>     # optional: launch remotely
```

**Rules the real TV enforces (learned the hard way):**
- config.xml: the application id must be `<exactly-10-alphanumeric>.<name>`
  with `package` equal to the 10-char part, and the profile must be
  `tv-samsung` — violations fail install with an opaque
  "Parsing error [118, -19]".
- **No inline `<script>` or `<style>` in widget pages**: Tizen's default
  CSP is `script-src 'self'` — inline code silently never executes (the
  original inline wrapper = "blank screen" on the TV, while working fine in
  desktop browsers). Everything must live in packaged files (app.js,
  app.css).
- The wrapper's network probe auto-retries: at cold app launch the TV's
  network stack is often not up yet, so the first probe can fail even
  though the network is fine seconds later.

**Debugging on the TV from this machine** (invaluable — evaluate JS, read
state, force navigation): `sdb -s <TV-IP>:26101 shell 0 debug
TVSpotTVapp.TVSpot` prints a port; then Chrome DevTools protocol on
`http://<TV-IP>:<port>/json` (see scratchpad tvdbg.mjs pattern: connect the
websocket, send Runtime.evaluate). DevTools evaluate bypasses CSP — code
that works there can still be CSP-blocked as page code.

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
