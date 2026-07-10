/**
 * Runtime stream verification for live-TV sources.
 *
 * Live channels arrive with a primary_url + several backup_urls (shown in the UI
 * as "Source 1..N"). Many of those backups are dead at any given moment — they
 * 401, return an empty playlist, or time out — so the player would otherwise
 * present sources that silently fail when tapped. This probes each HLS playlist
 * server-side (no browser CORS/auth limits) and reports which actually work, so
 * the UI can badge dead sources and auto-pick a working one.
 *
 * This is a lean Tier-1/Tier-2 check (reachable + valid playlist + has at least
 * one segment) — the deeper 4-tier offline pipeline lives in
 * scripts/link-freshness/verifier.ts and is not appropriate for a per-request
 * runtime path.
 */

export interface StreamCheck {
  url: string;
  ok: boolean;
  /** HTTP status; 0 means the request never completed (timeout / unreachable). */
  status: number;
  latencyMs: number;
  /** Short human-readable outcome, e.g. "ok", "timeout", "401 unauthorized". */
  reason: string;
  /**
   * The source isn't dead — it's temporarily BUSY (shared IPTV account at its
   * connection limit: HTTP 456/429). Distinct from `ok:false` "dead" so the UI
   * doesn't hide it: it plays fine once the shared slot frees up.
   */
  busy?: boolean;
}

const DEFAULT_TIMEOUT_MS = 6000;
/** Playlists are a few KB; anything large is not a playlist we should buffer. */
const MAX_PLAYLIST_BYTES = 2_000_000;

function httpReason(status: number): string {
  if (status === 401 || status === 403) return `${status} unauthorized`;
  if (status === 404) return "404 not found";
  if (status >= 500) return `${status} server error`;
  return `http ${status}`;
}

/** True if the content-type looks like an HLS playlist (and not html/json). */
function isHlsContentType(ct: string): boolean {
  const lower = ct.toLowerCase();
  if (lower.includes("html") || lower.includes("json")) return false;
  return lower.includes("mpegurl");
}

/** Playlist has at least one media segment or child playlist reference. */
function hasSegments(playlist: string): boolean {
  for (const raw of playlist.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) return true;
    if (!line.startsWith("#") && (/\.m3u8(\?|$)/i.test(line) || /\.ts(\?|$)/i.test(line))) {
      return true;
    }
  }
  return false;
}

/**
 * Probe a single HLS source URL. Resolves (never rejects) with a verdict.
 */
export async function checkStream(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<StreamCheck> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "tvspot-stream-check/1.0" },
      cache: "no-store",
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      // 456 (upstream "connection limit reached") / 429 (rate limit) mean the source
      // is BUSY, not dead — a shared IPTV account whose one slot is momentarily in
      // use. Flag it so the UI keeps it as a candidate instead of badging it dead.
      const busy = res.status === 456 || res.status === 429;
      return {
        url,
        ok: false,
        busy,
        status: res.status,
        latencyMs,
        reason: busy ? "busy (connection limit)" : httpReason(res.status),
      };
    }

    const ct = res.headers.get("content-type") || "";
    if (!isHlsContentType(ct)) {
      return { url, ok: false, status: res.status, latencyMs, reason: "not a stream" };
    }

    const len = Number(res.headers.get("content-length") || "0");
    if (len > MAX_PLAYLIST_BYTES) {
      return { url, ok: false, status: res.status, latencyMs, reason: "not a stream" };
    }

    const body = (await res.text()).trimStart();
    if (!body.startsWith("#EXTM3U")) {
      return { url, ok: false, status: res.status, latencyMs, reason: "invalid playlist" };
    }
    if (!hasSegments(body)) {
      return { url, ok: false, status: res.status, latencyMs, reason: "empty stream" };
    }

    return { url, ok: true, status: res.status, latencyMs, reason: "ok" };
  } catch {
    const latencyMs = Date.now() - start;
    return {
      url,
      ok: false,
      status: 0,
      latencyMs,
      reason: ctrl.signal.aborted ? "timeout" : "unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe many sources concurrently. Order of results matches input order. */
export async function checkStreams(urls: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<StreamCheck[]> {
  return Promise.all(urls.map((u) => checkStream(u, timeoutMs)));
}

/** VOD probes wait longer: a cold relay remux / double-proxied file can take
 *  several seconds to answer its first byte and that's still a good source. */
const VOD_TIMEOUT_MS = 10_000;

/**
 * Probe a single VOD source. VOD candidates aren't all HLS playlists — they're
 * progressive MP4/MKV (often via the same-origin /api/vod-stream range proxy),
 * relay remux URLs, and embed PAGES (vidlink & co). So the live playlist
 * validation doesn't apply; reachability is the signal.
 *
 * Same-origin URLs ("/api/vod-stream?…") need two things externals must not
 * get:
 *   • the requester's Cookie — these routes sit behind the auth middleware,
 *     and a cookie-less probe 401s on EVERY source, badging dead what plays
 *     fine in the browser (the "0 online but it plays" bug). The cookie is
 *     never sent to external hosts.
 *   • a 1-byte range GET instead of HEAD — /api/vod-stream treats a request
 *     with no Range as "fetch the WHOLE upstream file and sniff it", so a
 *     HEAD probe would trigger a full movie download upstream.
 * External hosts keep HEAD-first (cheap), with a range-GET retry on 405/501.
 * `origin` resolves same-origin relative URLs since this runs server-side.
 */
export async function checkVodSource(url: string, origin: string, cookie = ""): Promise<StreamCheck> {
  const start = Date.now();
  const sameOrigin = url.startsWith("/") || url.startsWith(`${origin}/`);
  const abs = url.startsWith("/") ? `${origin}${url}` : url;
  const probe = async (method: "HEAD" | "GET"): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VOD_TIMEOUT_MS);
    try {
      return await fetch(abs, {
        method,
        signal: ctrl.signal,
        headers: {
          "User-Agent": "tvspot-stream-check/1.0",
          ...(method === "GET" ? { Range: "bytes=0-0" } : {}),
          ...(sameOrigin && cookie ? { Cookie: cookie } : {}),
        },
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let res = await probe(sameOrigin ? "GET" : "HEAD");
    if (!sameOrigin && (res.status === 405 || res.status === 501)) res = await probe("GET");
    // Drain nothing: a range GET body is ≤1 byte; HEAD has none.
    const latencyMs = Date.now() - start;
    if (res.ok || res.status === 206) {
      return { url, ok: true, status: res.status, latencyMs, reason: "ok" };
    }
    const busy = res.status === 456 || res.status === 429 || res.status === 509;
    return {
      url,
      ok: false,
      busy,
      status: res.status,
      latencyMs,
      reason: busy ? "busy (connection limit)" : httpReason(res.status),
    };
  } catch {
    return { url, ok: false, status: 0, latencyMs: Date.now() - start, reason: "unreachable" };
  }
}

/** Probe many VOD sources concurrently. Order of results matches input order. */
export async function checkVodSources(urls: string[], origin: string, cookie = ""): Promise<StreamCheck[]> {
  return Promise.all(urls.map((u) => checkVodSource(u, origin, cookie)));
}
