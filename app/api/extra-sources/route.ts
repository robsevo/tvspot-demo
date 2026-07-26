import { NextRequest, NextResponse } from "next/server";
import { channelSlug } from "@/lib/sources";
import { loadVerifiedSources } from "@/lib/linkData";

// Reads the verified-sources data at request time — not at build time — so it
// always reflects the latest nightly run without a redeploy. The data now comes
// from the Blob store rather than the deployed file, so "latest nightly run"
// is true even when that run shipped no deployment at all (see lib/linkData.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cap on extra URLs returned per request. */
const MAX_EXTRA = 16;

/**
 * POST { slug: string; exclude: string[] } -> { urls: string[] }
 *
 * Returns verified source URLs for a channel that are NOT in the caller's
 * current pool (the exclude list). Used by the ChannelPlayer to expand its
 * probe set when the initial sources come up mostly dead.
 */
export async function POST(request: NextRequest) {
  let slug: string;
  let exclude: string[];
  try {
    const body = await request.json();
    if (typeof body?.slug !== "string" || !Array.isArray(body?.exclude)) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    slug = channelSlug(body.slug);
    exclude = body.exclude.filter((u: unknown): u is string => typeof u === "string");
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const data = await loadVerifiedSources();
    const entry = data.channels?.[slug];
    if (!entry) {
      return NextResponse.json({ urls: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const excludeSet = new Set(exclude);
    const active: string[] = (entry.sources || []).map((s) => s.url);
    const waiting: string[] = (entry.waiting || []).map((s) => s.url);
    const extra = [...new Set([...active, ...waiting])]
      .filter((u) => !excludeSet.has(u))
      .slice(0, MAX_EXTRA);

    return NextResponse.json({ urls: extra }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ urls: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
