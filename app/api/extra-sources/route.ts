import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { channelSlug } from "@/lib/sources";

// Reads the verified-sources file at request time — not at build time — so it
// always reflects the latest nightly run without a redeploy.
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
    const filePath = join(process.cwd(), "data", "verified-sources.json");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const entry = data.channels?.[slug];
    if (!entry) {
      return NextResponse.json({ urls: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const excludeSet = new Set(exclude);
    const active: string[] = (entry.sources || []).map((s: { url: string }) => s.url);
    const waiting: string[] = (entry.waiting || []).map((s: { url: string }) => s.url);
    const extra = [...new Set([...active, ...waiting])]
      .filter((u) => !excludeSet.has(u))
      .slice(0, MAX_EXTRA);

    return NextResponse.json({ urls: extra }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ urls: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
