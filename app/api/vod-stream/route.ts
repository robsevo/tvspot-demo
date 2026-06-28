import { NextRequest, NextResponse } from "next/server";

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

const CHUNK = 8 * 1024 * 1024; // per-response byte cap for media segments/mp4
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

function rewriteUri(uri: string, base: string): string {
  let abs: string;
  try {
    abs = new URL(uri, base).href;
  } catch {
    return uri;
  }
  return SELF + encodeURIComponent(abs);
}

/** Rewrite every URI in an HLS playlist to route back through this proxy. */
function rewritePlaylist(text: string, base: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) { out.push(line); continue; }
    if (t.startsWith("#")) {
      // Rewrite URIs embedded in tags (EXT-X-KEY, EXT-X-MEDIA, EXT-X-MAP, …).
      out.push(line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${rewriteUri(u, base)}"`));
    } else {
      // A bare line = a segment or sub-playlist URI.
      out.push(rewriteUri(t, base));
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

  // Decide playlist vs byte stream. Playlists are small — fetch whole, no Range.
  if (M3U8_RE.test(target)) {
    let res: Response;
    try {
      res = await fetch(target, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    } catch {
      return new NextResponse("upstream fetch failed", { status: 502 });
    }
    if (!res.ok) return new NextResponse("upstream error", { status: 502 });
    const text = await res.text();
    if (looksLikeHls(target, res.headers.get("content-type")) || text.trimStart().startsWith("#EXTM3U")) {
      // res.url is the final URL after redirects — the correct base for relatives.
      const rewritten = rewritePlaylist(text, res.url || target);
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
    upstream = await fetch(target, {
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
