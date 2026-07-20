/* TVSPOT service worker — app-shell cache for instant, eviction-proof reloads.
 *
 * Strategy:
 *  - Navigations (HTML): stale-while-revalidate. Serve the cached shell instantly
 *    so a reload repaints in one frame instead of blanking, then refresh in the
 *    background. The client still re-checks auth (/api/auth/me) and redirects to
 *    /login if the cookie is gone, so serving a cached shell is safe.
 *  - Static assets (_next/static, icons, fonts): cache-first (content-hashed).
 *  - Everything under /api/* (auth, catalog JSON, streams, proxies): NEVER cached —
 *    always network. These are per-request / Cache-Control: no-store.
 *
 * Bump VERSION to force-evict all caches on the next deploy.
 */
const VERSION = "v7"; // v7 (2026-07-20): ship the navigation timeout below. The
// v6 bump is what EXPOSED that bug: evicting the shell cache meant every
// navigation depended on an unbounded fetch, so the TV hung on the wrapper's
// "Starting TVSpot…" splash — an app that had worked fine the day before, with
// no app-code change. Bumping again is safe now that the no-cache path is
// bounded and self-retrying.
//
// v6 (2026-07-20): evict shells cached across a night of
// four back-to-back deploys. A cached shell references that build's chunk
// HASHES; any chunk not already in ASSET_CACHE is then fetched from a server
// that no longer has that hash → 404 → ChunkLoadError → the app never hydrates
// and the TV sits on the "starting TVSpot" splash forever. Bumping evicts both
// caches on activate. The self-healing below stops it recurring.
//
// v5: evict chunks cached before the chunk-guard fix — cached unguarded chunks
// can evaluate ahead of the layout's inline polyfill on the TV (globalThis
// ReferenceError, page dead at eval), and a crashed page can never revalidate
// itself. The browser still updates sw.js on navigation, so this is the
// recovery path for a wedged TV. (see scripts/chunk-guard.mjs)
const SHELL_CACHE = `tvspot-shell-${VERSION}`;
const ASSET_CACHE = `tvspot-assets-${VERSION}`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/* How long a navigation may wait on the network before we hand back something
 * rather than nothing. This is THE fix for "stuck on Starting TVSpot…":
 * event.respondWith() holds the navigation until its promise settles, and a
 * navigation that never commits leaves the PREVIOUS document on screen — which,
 * launched from the .wgt, is the Tizen wrapper's own splash. So an unbounded
 * fetch() here didn't hang a page; it hung the app before any page existed,
 * somewhere the web app's own timeouts (lib/fetchDeadline) can never reach,
 * because a service worker is a separate script that imports none of them.
 *
 * It stayed hidden while a cached shell existed to return instantly. Bumping
 * VERSION evicts that shell, so the very next launch rides entirely on this
 * fetch — which is why a cache-eviction bump could turn a working TV into a
 * dead splash without any app code changing. */
const NAV_TIMEOUT_MS = 10000;

/* Race, never abort: the TV's Chromium 63 ignores fetch's `signal` entirely
 * (and tv-polyfills.js defines AbortController, so feature-detection lies), so
 * a timeout that only aborts is a no-op on the one device this protects. */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sw: navigation timed out")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/* Last resort when a navigation can't be served and there's no cached shell:
 * a real Response, so the navigation COMMITS and the wrapper splash is replaced
 * by something that says what's happening and retries itself. meta-refresh
 * rather than a script so no CSP or dead-JS condition can stop the retry —
 * the TV heals on its own instead of needing someone to walk to it. */
function reconnectingShell() {
  return new Response(
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
      '<meta http-equiv="refresh" content="5"><title>TVSpot</title>' +
      "<style>html,body{margin:0;height:100%;background:#0d1520;color:#8197a4;" +
      "font-family:sans-serif}div{display:flex;height:100%;align-items:center;" +
      "justify-content:center;font-size:28px}</style></head>" +
      "<body><div>Reconnecting to TVSpot…</div></body></html>",
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function isAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Same-origin only — never intercept stream CDNs, TMDB images, etc.
  if (url.origin !== self.location.origin) return;
  // Never touch API / auth / stream routes — always live.
  if (url.pathname.startsWith("/api/")) return;

  // Static assets: cache-first (immutable, content-hashed).
  if (isAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.ok) {
          cache.put(req, res.clone());
        } else if (res && res.status === 404 && url.pathname.startsWith("/_next/static/")) {
          // A content-hashed chunk that 404s means the SHELL that referenced it
          // is from a build that no longer exists on the server. The page is
          // already doomed (ChunkLoadError → no hydration → stuck on the splash),
          // and stale-while-revalidate alone can leave a TV wedged there across
          // relaunches. Drop the shell cache so the very next navigation is
          // forced to fetch fresh HTML with valid chunk hashes — the app
          // self-heals on relaunch instead of needing a VERSION bump + deploy.
          await caches.delete(SHELL_CACHE);
        }
        return res;
      }),
    );
    return;
  }

  // Navigations (HTML documents): stale-while-revalidate.
  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = withTimeout(fetch(req), NAV_TIMEOUT_MS)
          .then((res) => {
            // Don't cache redirects (e.g. an auth 302 → /login) under a protected
            // path key — that would pin the wrong page there.
            if (res && res.ok && !res.redirected) cache.put(req, res.clone());
            return res;
          })
          // Falling back to `cached` here is usually a no-op (if we had a cached
          // shell we already returned it below) — it matters only on the
          // revalidate path. reconnectingShell() is the one that saves the TV.
          .catch(() => cached || reconnectingShell());
        return cached || network;
      }),
    );
    return;
  }
});
