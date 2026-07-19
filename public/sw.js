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
const VERSION = "v3"; // v3: evict shells/assets cached before the legacy-engine (TV) pass
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
        if (res && res.ok) cache.put(req, res.clone());
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
        const network = fetch(req)
          .then((res) => {
            // Don't cache redirects (e.g. an auth 302 → /login) under a protected
            // path key — that would pin the wrong page there.
            if (res && res.ok && !res.redirected) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }
});
