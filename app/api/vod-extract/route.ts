import { NextRequest, NextResponse } from "next/server";
import { resolveVodStreams } from "@/lib/vod-resolve";

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
    const stream_urls = await resolveVodStreams({ tmdbId: tmdb, type, season, episode });
    return NextResponse.json(
      { stream_urls },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ stream_urls: [] });
  }
}
