import { NextRequest, NextResponse } from "next/server";
import { resolveVodStreams } from "@/lib/vod-resolve";
import { mintStreamToken } from "@/lib/streamToken";

// Resolution does live network calls to provider-a at request time — never static.
export const dynamic = "force-dynamic";

/**
 * On-demand clean-stream resolver for VOD.
 *   GET /api/vod-extract?type=movie&tmdb=614945
 *   GET /api/vod-extract?type=tv&tmdb=286360&s=1&e=1
 * Returns { stream_urls: string[] } — browser-playable (stream-proxy-wrapped)
 * direct HLS URLs, or [] if none. Auth is enforced by middleware.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const tmdb = Number(sp.get("tmdb"));
  const type = sp.get("type") === "tv" ? "tv" : "movie";
  const season = sp.get("s") ? Number(sp.get("s")) : undefined;
  const episode = sp.get("e") ? Number(sp.get("e")) : undefined;

  if (!tmdb || Number.isNaN(tmdb)) {
    return NextResponse.json({ stream_urls: [] }, { status: 400 });
  }

  try {
    const resolved = await resolveVodStreams({ tmdbId: tmdb, type, season, episode });
    // Sign every same-origin proxy URL before it leaves this (authenticated)
    // request. The client that plays them — the TV's <video> — cannot send a
    // cookie, so the authority has to travel in the URL itself.
    const stream_urls = await Promise.all(
      resolved.map(async (u) => {
        if (!u.startsWith("/api/vod-stream?url=")) return u;
        const target = new URLSearchParams(u.slice(u.indexOf("?") + 1)).get("url");
        if (!target) return u;
        return `${u}&st=${encodeURIComponent(await mintStreamToken(target))}`;
      }),
    );
    return NextResponse.json(
      { stream_urls },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ stream_urls: [] });
  }
}
