/**
 * Today's games for the leagues we track, from ESPN's public scoreboard API.
 * Fetches every league in parallel, normalizes to our shape, and returns only
 * leagues that actually have games on the requested date (empty leagues are
 * dropped — the Events page never shows an empty league).
 *
 * Query: ?date=YYYYMMDD (the client passes its LOCAL date; defaults to UTC today).
 */

import { NextResponse } from "next/server";
import { LEAGUES, type GameEvent, type LeagueEvents } from "@/lib/leagues";

const UA = "Mozilla/5.0 (compatible; tvspot/1.0)";
// ESPN scoreboard is public + fast; refetch at most every 60s per date.
export const revalidate = 60;

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  team?: { displayName?: string; shortDisplayName?: string; abbreviation?: string; logo?: string };
}

function pickBroadcasts(comp: any): string[] {
  const out = new Set<string>();
  for (const b of comp?.broadcasts || []) {
    for (const n of b?.names || []) out.add(n);
  }
  for (const b of comp?.geoBroadcasts || []) {
    const n = b?.media?.shortName;
    if (n) out.add(n);
  }
  return [...out];
}

function team(c: EspnCompetitor | undefined) {
  return {
    name: c?.team?.shortDisplayName || c?.team?.displayName || "TBD",
    abbrev: c?.team?.abbreviation,
    logo: c?.team?.logo,
    score: c?.score,
  };
}

async function fetchLeague(date: string, espnPath: string): Promise<{ logo?: string; games: GameEvent[] } | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${date}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json();
    const leagueLogo = data?.leagues?.[0]?.logos?.[0]?.href as string | undefined;
    const games: GameEvent[] = [];
    for (const ev of data?.events || []) {
      const comp = (ev.competitions || [])[0] || {};
      const competitors: EspnCompetitor[] = comp.competitors || [];
      const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
      const away = competitors.find((c) => c.homeAway === "away") || competitors[1];
      const st = ev?.status?.type || {};
      games.push({
        id: String(ev.id),
        shortName: ev.shortName || ev.name || "",
        home: team(home),
        away: team(away),
        dateUtc: ev.date,
        state: (st.state as GameEvent["state"]) || "pre",
        detail: st.shortDetail || st.detail || "",
        broadcasts: pickBroadcasts(comp),
      });
    }
    return { logo: leagueLogo, games };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  let date = (searchParams.get("date") || "").replace(/[^0-9]/g, "");
  if (date.length !== 8) {
    const now = new Date();
    date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  }

  const results = await Promise.allSettled(
    LEAGUES.map(async (lg) => ({ lg, data: await fetchLeague(date, lg.espnPath) })),
  );

  const leagues: LeagueEvents[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value.data) continue;
    const { lg, data } = r.value;
    if (!data.games.length) continue; // drop empty leagues
    leagues.push({ key: lg.key, name: lg.name, logo: data.logo || lg.logo, games: data.games });
  }

  return NextResponse.json(
    { date, leagues },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
