import { NextRequest, NextResponse } from "next/server";
import { mintStreamToken, verifyStreamToken } from "@/lib/streamToken";
import { verifyToken } from "@/lib/auth";

// Same-origin VOD media proxy — handles BOTH:
//  • HLS playlists (.m3u8): fetched, every inner URI (variant playlists, segments,
//    keys) rewritten to route back through this same route, served with CORS so
//    hls.js can play them. The provider-a CDNs (tik/vip/their CDN hosts) send NO CORS and
//    api.example.com/stream-proxy is flaky per-host, so we proxy them ourselves.
//  • Byte streams (mp4/ts/segments): Range forwarded to the origin (IPTV panels
//    are HTTP-only + send 206), capped per response so a function invocation stays
//    short. Same-origin HTTPS → no mixed-content, seekable <video>.
//
// Auth-gated by middleware (only our logged-in users reach /api/*). We still block
// SSRF to private/loopback addresses.

export const dynamic = "force-dynamic";
/** Must exceed FULL_FETCH_TIMEOUT_MS below, or the platform kills the function
 *  before our own timeout can fire and the caller gets an opaque failure instead
 *  of a clean 502 — the cold-remux wait is legitimately ~26s. */
export const maxDuration = 60;

const CHUNK = 8 * 1024 * 1024; // per-response byte cap for media segments/mp4
/** Patience for a whole-resource fetch (playlists, full segments).
 *  Generous because the relay's remux spawns ffmpeg ON DEMAND and a COLD start
 *  measured ~26s — the previous 15s cut that off and surfaced as "upstream fetch
 *  failed" at 15.2s, making a perfectly good AAC fallback look dead. Byte-range
 *  reads keep their own short timeouts; only this path waits on a cold encoder. */
const FULL_FETCH_TIMEOUT_MS = 45_000;
const UA = "VLC/3.0.20 LibVLC/3.0.20";
const SELF = "/api/vod-stream?url=";

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

function wrapUri(abs: string, token: string, ref?: string): string {
  const wrapped = `${SELF}${encodeURIComponent(abs)}&st=${encodeURIComponent(token)}`;
  // Propagate the Referer to every child (variant playlists, segments, keys) —
  // the referer-gated CDN 403s each hop without it.
  return ref ? `${wrapped}&ref=${encodeURIComponent(ref)}` : wrapped;
}

/**
 * Rewrite every URI in an HLS playlist to route back through this proxy.
 *
 * Async because each child now carries its OWN signature. Segment and key
 * requests are made by the media stack exactly like the master, so on the TV
 * they arrive without a cookie too — an unsigned child URI would 401 partway
 * into playback, which is worse than failing up front.
 */
async function rewritePlaylist(text: string, base: string, ref?: string): Promise<string> {
  const lines = text.split(/\r?\n/);

  // 1. Collect every URI needing a wrap, so they can all be signed at once
  //    rather than serially per line (a playlist can carry hundreds).
  const uris = new Set<string>();
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) {
      for (const m of t.matchAll(/URI="([^"]+)"/g)) uris.add(m[1]);
    } else {
      uris.add(t);
    }
  }

  // 2. Sign in parallel.
  const wrapped = new Map<string, string>();
  await Promise.all(
    [...uris].map(async (u) => {
      let abs: string;
      try {
        abs = new URL(u, base).href;
      } catch {
        wrapped.set(u, u); // unparseable → leave exactly as-is
        return;
      }
      wrapped.set(u, wrapUri(abs, await mintStreamToken(abs), ref));
    }),
  );

  // 3. Substitute.
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { out.push(line); continue; }
    if (t.startsWith("#")) {
      // Rewrite URIs embedded in tags (EXT-X-KEY, EXT-X-MEDIA, EXT-X-MAP, …).
      out.push(line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${wrapped.get(u) ?? u}"`));
    } else {
      // A bare line = a segment or sub-playlist URI.
      out.push(wrapped.get(t) ?? t);
    }
  }
  return out.join("\n");
}

const M3U8_RE = /\.m3u8(\?|$)/i;
function looksLikeHls(url: string, contentType: string | null): boolean {
  if (M3U8_RE.test(url)) return true;
  const ct = (contentType || "").toLowerCase();
  return ct.includes("mpegurl");
}

// Some provider-a CDNs (e.g. a provider CDN host) obfuscate HLS segments by prepending a
// fake image header (a 1x1 PNG) before the real MPEG-TS / fMP4 bytes, so a vanilla
// hls.js can't demux them. We detect that and strip the prefix to the real media
// start. Only safe on a FULL segment fetch (no Range) — and IPTV mp4 (which uses
// Range for seeking) is never obfuscated, so the two paths never collide.
function stripObfuscation(buf: Buffer): Buffer {
  // Fake-image magic (PNG / JPEG / GIF) at the very start = obfuscated.
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  const gif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
  if (!png && !jpg && !gif) return buf;

  const scan = Math.min(buf.length - 376, 65536);
  // MPEG-TS: 0x47 sync repeating every 188 bytes (check 3 in a row to be sure).
  for (let i = 0; i < scan; i++) {
    if (buf[i] === 0x47 && buf[i + 188] === 0x47 && buf[i + 376] === 0x47) {
      return i === 0 ? buf : buf.subarray(i);
    }
  }
  // fMP4: an ISO box (ftyp / styp / moof / moov / sidx) — 4-byte size then type.
  const BOXES = ["ftyp", "styp", "moof", "moov", "sidx"];
  for (let i = 0; i < Math.min(buf.length - 8, 65536); i++) {
    const tag = buf.toString("ascii", i + 4, i + 8);
    if (BOXES.includes(tag)) return i === 0 ? buf : buf.subarray(i);
  }
  return buf; // couldn't locate media — return untouched
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    return new NextResponse("bad url", { status: 400 });
  }
  let host: string;
  try { host = new URL(target).host; } catch { return new NextResponse("bad url", { status: 400 }); }
  if (isBlockedHost(host)) return new NextResponse("blocked host", { status: 403 });

  // AUTH LIVES HERE, not in middleware. The TV's <video> element does not send
  // our cookie on media requests (proved on-device: the same MP4 errors while
  // auth-gated and plays when public), so a cookie-only gate 401s every stream
  // this box asks for — which is precisely why VOD worked on the phone and never
  // on the TV. Accept either: a normal session cookie, or a signature bound to
  // this exact target that the (authenticated) resolver minted earlier.
  const cookie = request.cookies.get("tvspot_session")?.value ?? null;
  const authed =
    (cookie ? Boolean(await verifyToken(cookie)) : false) ||
    (await verifyStreamToken(target, request.nextUrl.searchParams.get("st")));
  if (!authed) return new NextResponse("unauthorized", { status: 401 });

  // The relay's remux accepts &start=<sec> to begin ffmpeg mid-file — that's how
  // resume works on a stream you can't seek. It has to be forwarded rather than
  // baked into `url`, because the signature is bound to the EXACT target: editing
  // the inner URL to add a start offset would invalidate it. Numeric-only, so
  // this can't be used to graft arbitrary query onto the upstream.
  const startParam = request.nextUrl.searchParams.get("start");
  const startSec = startParam && /^\d{1,7}$/.test(startParam) ? startParam : null;
  const upstreamUrl = startSec
    ? `${target}${target.includes("?") ? "&" : "?"}start=${startSec}`
    : target;

  // Referer-gated CDN family (Provider B): the origin 403s every hop without a
  // Referer, and the whole playlist tree is extension-obfuscated (.txt master +
  // variants, .woff/.woff2 fMP4 segments) so the URL tells us nothing. Inject the
  // Referer, content-sniff playlist vs media, and propagate `ref` to child URIs.
  const ref = request.nextUrl.searchParams.get("ref") || undefined;
  if (ref) {
    const range = request.headers.get("range");
    const base: Record<string, string> = { "User-Agent": UA, Referer: ref };

    // No client Range → a playlist OR a full segment. Fetch whole, sniff #EXTM3U.
    if (!range) {
      let res: Response;
      try {
        res = await fetch(upstreamUrl, { headers: base, redirect: "follow", signal: AbortSignal.timeout(FULL_FETCH_TIMEOUT_MS) });
      } catch {
        return new NextResponse("upstream fetch failed", { status: 502 });
      }
      if (!res.ok) return new NextResponse("upstream error", { status: 502 });
      const buf = Buffer.from(await res.arrayBuffer());
      const isHls =
        looksLikeHls(target, res.headers.get("content-type")) ||
        buf.subarray(0, 16).toString("latin1").trimStart().startsWith("#EXTM3U");
      if (isHls) {
        const rewritten = await rewritePlaylist(buf.toString("utf8"), res.url || target, ref);
        return new NextResponse(rewritten, {
          status: 200,
          headers: {
            "content-type": "application/vnd.apple.mpegurl",
            "access-control-allow-origin": "*",
            "cache-control": "no-store",
          },
        });
      }
      const clean = stripObfuscation(buf);
      return new NextResponse(new Uint8Array(clean), {
        status: 200,
        headers: {
          "content-type": res.headers.get("content-type") || "video/mp4",
          "accept-ranges": "bytes",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
          "content-length": String(clean.length),
        },
      });
    }

    // Client Range (seek) → byte passthrough with the Referer, capped per response.
    let start = 0;
    let reqEnd: number | undefined;
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      start = parseInt(m[1], 10) || 0;
      if (m[2]) reqEnd = parseInt(m[2], 10);
    }
    const end = Math.min(reqEnd ?? start + CHUNK - 1, start + CHUNK - 1);
    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        headers: { ...base, Range: `bytes=${start}-${end}` },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      return new NextResponse("upstream fetch failed", { status: 502 });
    }
    if (upstream.status >= 400 || !upstream.body) {
      return new NextResponse("upstream error", { status: 502 });
    }
    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") || "video/mp4");
    headers.set("accept-ranges", "bytes");
    headers.set("access-control-allow-origin", "*");
    headers.set("cache-control", "no-store");
    const cr = upstream.headers.get("content-range");
    if (cr) headers.set("content-range", cr);
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("content-length", cl);
    const status = upstream.status === 206 || cr ? 206 : upstream.status;
    return new NextResponse(upstream.body, { status, headers });
  }

  // Decide playlist vs byte stream. Playlists are small — fetch whole, no Range.
  if (M3U8_RE.test(target)) {
    let res: Response;
    try {
      res = await fetch(upstreamUrl, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(FULL_FETCH_TIMEOUT_MS) });
    } catch {
      return new NextResponse("upstream fetch failed", { status: 502 });
    }
    if (!res.ok) return new NextResponse("upstream error", { status: 502 });
    const text = await res.text();
    if (looksLikeHls(target, res.headers.get("content-type")) || text.trimStart().startsWith("#EXTM3U")) {
      // res.url is the final URL after redirects — the correct base for relatives.
      const rewritten = await rewritePlaylist(text, res.url || target);
      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    }
    // Not actually a playlist — fall through to byte passthrough below.
  }

  // Byte stream (segment / mp4): forward Range, cap the served length.
  let start = 0;
  let reqEnd: number | undefined;
  const range = request.headers.get("range");
  const m = range && /bytes=(\d+)-(\d*)/.exec(range);
  if (m) {
    start = parseInt(m[1], 10) || 0;
    if (m[2]) reqEnd = parseInt(m[2], 10);
  }
  const end = Math.min(reqEnd ?? start + CHUNK - 1, start + CHUNK - 1);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: { "User-Agent": UA, Range: `bytes=${start}-${end}` },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return new NextResponse("upstream fetch failed", { status: 502 });
  }
  if (upstream.status >= 400 || !upstream.body) {
    return new NextResponse("upstream error", { status: 502 });
  }

  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") || "video/mp4");
  headers.set("accept-ranges", "bytes");
  headers.set("access-control-allow-origin", "*");
  headers.set("cache-control", "no-store");

  // No client Range = a full segment fetch (HLS). Buffer it so we can strip any
  // fake-image obfuscation prefix before handing clean media to hls.js. Segments
  // are small (≤ a few MB); IPTV mp4 (large, seeked) always sends Range and skips
  // this path.
  if (!range) {
    const raw = Buffer.from(await upstream.arrayBuffer());
    const clean = stripObfuscation(raw);
    headers.set("content-length", String(clean.length));
    return new NextResponse(new Uint8Array(clean), { status: 200, headers });
  }

  const cr = upstream.headers.get("content-range");
  if (cr) headers.set("content-range", cr);
  const cl = upstream.headers.get("content-length");
  if (cl) headers.set("content-length", cl);
  const status = upstream.status === 206 || cr ? 206 : upstream.status;
  return new NextResponse(upstream.body, { status, headers });
}
