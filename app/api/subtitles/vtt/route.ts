import { NextRequest, NextResponse } from "next/server";
import { decodeSubtitle, srtToVtt } from "@/lib/subtitles";

/**
 * Fetch a provider subtitle file and serve it as same-origin WebVTT.
 *
 *   GET /api/subtitles/vtt?u=<encoded provider url>
 *
 * Exists because a <track> can't consume the provider's file directly: it's
 * SubRip (browsers only parse WebVTT) served cross-origin from a host that
 * sends no CORS headers. This converts and re-serves it from our own origin.
 *
 * `u` is attacker-controllable in principle, so the host is checked against an
 * allowlist — an unrestricted fetch-and-return here would be an SSRF hole.
 */

/** Only hosts the discovery route can legitimately hand us. */
const ALLOWED_HOSTS = [/^(?:[a-z0-9-]+\.)*strem\.io$/i, /^(?:[a-z0-9-]+\.)*opensubtitles\.org$/i];

/** Subtitle files are ~100-200KB; anything far past that isn't a subtitle. */
const MAX_BYTES = 4 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("u");
  if (!raw) return NextResponse.json({ error: "missing u" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return NextResponse.json({ error: "bad scheme" }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  try {
    const res = await fetch(target.toString(), {
      headers: { "User-Agent": "tvspot/1.0", Accept: "*/*" },
      next: { revalidate: 60 * 60 * 24 },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `provider ${res.status}` }, { status: 502 });
    }

    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_BYTES) {
      return NextResponse.json({ error: "too large" }, { status: 502 });
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "too large" }, { status: 502 });
    }

    const vtt = srtToVtt(decodeSubtitle(buf));
    // A header-only body means every cue failed to parse — serving it would
    // show an enabled CC track that silently renders nothing.
    if (!/-->/.test(vtt)) {
      return NextResponse.json({ error: "no cues" }, { status: 502 });
    }

    return new NextResponse(vtt, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
