import { NextRequest, NextResponse } from "next/server";
import { checkStreams } from "@/lib/stream-verify";

// Probes are outbound fetches that must run fresh on every request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cap per request so a malformed payload can't fan out unbounded fetches. */
const MAX_URLS = 12;

/**
 * POST { urls: string[] } -> { results: StreamCheck[] }
 *
 * Verifies live-TV source URLs server-side and reports which actually play.
 * Done server-side so dead sources that 401 or hang don't trip browser CORS,
 * and so the verdict is consistent regardless of the client's network.
 */
export async function POST(request: NextRequest) {
  let urls: string[] = [];
  try {
    const body = await request.json();
    if (Array.isArray(body?.urls)) {
      urls = body.urls.filter((u: unknown): u is string => typeof u === "string" && u.length > 0);
    }
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (urls.length === 0) {
    return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const results = await checkStreams(urls.slice(0, MAX_URLS));
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
