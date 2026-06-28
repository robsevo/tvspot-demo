import { NextRequest, NextResponse } from "next/server";
import vodIndexJson from "@/data/vod-index.json";
import type { VodIndex } from "@/scripts/link-freshness/vod-index-types";

// Streaming range-proxy for IPTV VOD/series MP4s.
//
// The scraped upstream panels are HTTP-only (mixed-content blocked on our HTTPS
// site) and the backend's open stream-proxy ignores Range (no seeking on multi-GB
// files). This same-origin route bridges that: it forwards the browser's Range to
// the IPTV server (which DOES honour 206), caps each response to a chunk so a
// single function invocation stays short, and streams the bytes straight back
// (no buffering). Same-origin → no CORS or mixed-content problem; the <video>
// element seeks by issuing successive ranged requests here.

export const dynamic = "force-dynamic";

// Per-response cap. The browser re-requests the next range as it plays/seeks, so
// each invocation streams at most this much and finishes quickly (well within
// serverless duration limits). 8 MiB ≈ a few seconds of HD.
const CHUNK = 8 * 1024 * 1024;
const UA = "VLC/3.0.20 LibVLC/3.0.20"; // panels serve players, not browsers

// Only proxy the IPTV hosts we actually index — never an open proxy.
const ALLOWED_HOSTS = new Set(
  ((vodIndexJson as unknown as VodIndex).accounts || []).map((a) => {
    try { return new URL(a.server).host.toLowerCase(); } catch { return ""; }
  }).filter(Boolean),
);

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    return new NextResponse("bad url", { status: 400 });
  }
  let host: string;
  try { host = new URL(target).host.toLowerCase(); } catch { return new NextResponse("bad url", { status: 400 }); }
  if (!ALLOWED_HOSTS.has(host)) {
    return new NextResponse("host not allowed", { status: 403 });
  }

  // Parse the requested range; cap the served length.
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
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return new NextResponse("upstream fetch failed", { status: 502 });
  }

  if (upstream.status >= 400 || !upstream.body) {
    return new NextResponse("upstream error", { status: 502 });
  }

  const headers = new Headers();
  const ct = upstream.headers.get("content-type") || "video/mp4";
  headers.set("content-type", ct);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "no-store");
  const cr = upstream.headers.get("content-range");
  if (cr) headers.set("content-range", cr);
  const cl = upstream.headers.get("content-length");
  if (cl) headers.set("content-length", cl);

  // Mirror 206 when the upstream honoured the range (it does); else pass through.
  const status = upstream.status === 206 || cr ? 206 : upstream.status;
  return new NextResponse(upstream.body, { status, headers });
}
