import { NextRequest, NextResponse } from "next/server";
import { checkStreams, checkVodSources } from "@/lib/stream-verify";

// Probes are outbound fetches that must run fresh on every request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cap per request so a malformed payload can't fan out unbounded fetches. */
const MAX_URLS = 12;

/**
 * POST { urls: string[], mode?: "live" | "vod" } -> { results: StreamCheck[] }
 *
 * Verifies source URLs server-side and reports which actually play.
 * Done server-side so dead sources that 401 or hang don't trip browser CORS,
 * and so the verdict is consistent regardless of the client's network.
 *
 * mode "live" (default) validates HLS playlists; "vod" is a reachability
 * probe (HEAD / 1-byte range GET) because VOD candidates are progressive
 * files, remux URLs, and embed pages — not playlists.
 */
export async function POST(request: NextRequest) {
  let urls: string[] = [];
  let mode: "live" | "vod" = "live";
  try {
    const body = await request.json();
    if (Array.isArray(body?.urls)) {
      urls = body.urls.filter((u: unknown): u is string => typeof u === "string" && u.length > 0);
    }
    if (body?.mode === "vod") mode = "vod";
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (urls.length === 0) {
    return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const capped = urls.slice(0, MAX_URLS);
  // Forward the requester's cookie so same-origin proxy URLs (/api/vod-stream…)
  // clear the auth middleware; checkVodSource only attaches it same-origin.
  const results =
    mode === "vod"
      ? await checkVodSources(capped, request.nextUrl.origin, request.headers.get("cookie") ?? "")
      : await checkStreams(capped);
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
