import { NextRequest, NextResponse } from "next/server";
import { usingDemoCatalog } from "@/lib/demoCatalog";
import type { EpgProgram } from "@/lib/types";

/**
 * Electronic programme guide.
 *
 * Shadows the generic proxy at `app/api/lounge/[...path]/route.ts` for this one
 * path (a static segment wins over a catch-all), so that a deployment with no
 * upstream still has a guide to draw. With `BACKEND_API_URL` set this forwards
 * to the real service and changes nothing.
 *
 * The generated schedule is deterministic: the same channel and the same slot
 * always produce the same programme. That matters more than it sounds — the
 * guide refetches in the background every 15 minutes, and a random schedule
 * would reshuffle every row under the viewer mid-scroll.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

/** Programme length. Real guides are ragged; a uniform grid looks synthetic. */
const SLOT_MINUTES = [30, 60, 60, 90, 45];

const TITLES = [
  "Open Movie Showcase",
  "Short Film Hour",
  "Behind the Render",
  "Animation Retrospective",
  "Creative Commons Cinema",
  "The Blender Sessions",
  "Frame by Frame",
  "Studio Notes",
  "Late Night Shorts",
  "Encore Presentation",
];

/**
 * A small deterministic hash. Not cryptographic and not trying to be — it only
 * has to turn (channel, slot index) into a stable, well-spread number so two
 * adjacent channels do not show the same title at the same time.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Build a day of programming around `now`, starting from the most recent
 * half-hour boundary so the guide's "now" marker always lands inside a
 * programme rather than in a gap.
 */
function scheduleFor(channel: string, now: Date): EpgProgram[] {
  const out: EpgProgram[] = [];

  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() < 30 ? 0 : 30);
  // Begin a few hours back so scrolling left shows history, not emptiness.
  start.setHours(start.getHours() - 3);

  let cursor = start.getTime();
  const end = cursor + 24 * 60 * 60 * 1000;

  for (let slot = 0; cursor < end; slot++) {
    const seed = hash(`${channel}:${slot}`);
    const minutes = SLOT_MINUTES[seed % SLOT_MINUTES.length];
    const stop = cursor + minutes * 60_000;

    out.push({
      title: TITLES[seed % TITLES.length],
      start_utc: new Date(cursor).toISOString(),
      stop_utc: new Date(stop).toISOString(),
    });
    cursor = stop;
  }

  return out;
}

export async function GET(request: NextRequest) {
  const channelsParam = request.nextUrl.searchParams.get("channels") || "";

  if (usingDemoCatalog()) {
    const names = channelsParam
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);

    const now = new Date();
    const programmes: Record<string, EpgProgram[]> = {};
    for (const name of names) programmes[name] = scheduleFor(name, now);

    return NextResponse.json(
      { programmes },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          // Matches the upstream proxy's caching for this path: the guide is
          // identical for every viewer and slow-moving.
          "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=86400",
        },
      },
    );
  }

  const qs = request.nextUrl.searchParams.toString();
  const res = await fetch(`${BACKEND}/lounge/epg${qs ? `?${qs}` : ""}`, {
    headers: { Cookie: request.headers.get("cookie") || "" },
  });
  const body = await res.text();
  const response = new NextResponse(body, { status: res.status, statusText: res.statusText });
  response.headers.set("Access-Control-Allow-Origin", "*");
  const ct = res.headers.get("content-type");
  if (ct) response.headers.set("Content-Type", ct);
  if (res.ok) {
    response.headers.set(
      "Cache-Control",
      "public, max-age=0, s-maxage=900, stale-while-revalidate=86400",
    );
  }
  return response;
}
