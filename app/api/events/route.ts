/**
 * Today's games for the leagues we track, from ESPN's public scoreboard API.
 * Fetches every league in parallel, normalizes to our shape, and returns only
 * leagues that actually have games on the requested date (empty leagues are
 * dropped — the Events page never shows an empty league).
 *
 * Query: ?date=YYYYMMDD (the client passes its LOCAL date; defaults to UTC today).
 */

import { NextRequest, NextResponse } from "next/server";
import { LEAGUES, type GameEvent, type LeagueEvents } from "@/lib/leagues";
import { verifyToken, SESSION_COOKIE } from "@/lib/auth";

// DO NOT "fix" this to a branded or browser-like string. ESPN's edge 403s every
// User-Agent except `curl/*`, and a 403 here is INVISIBLE: fetchLeague returns
// null, the caller drops the league, and the response is a perfectly valid
// `{ date, leagues: [] }` with HTTP 200 — which the UI renders as "no games".
// That is how this endpoint served an empty events tab for days while ESPN was
// returning a full schedule.
//
// Measured 2026-08-16, same IP, back-to-back, 2-3 requests each:
//   curl/8.5.0 · curl/7.68.0 · curl/1.0 ............... 200  (any version works)
//   Mozilla/5.0 (compatible; tvspot/1.0) .............. 403  ← what we had
//   Chrome 120 UA, even with Accept/Accept-Language ... 403
//   Mozilla/5.0 · tvspot/1.0 · tvspot-curl/1.0 ........ 403
//   Wget/1.21 · PostmanRuntime/7.36.0 · node .......... 403
// So it is an allowlist on the literal `curl/` prefix, not a bot heuristic and
// not rate limiting. Verify with:
//   curl -s -o /dev/null -w '%{http_code}' -H 'User-Agent: <candidate>' \
//     'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard?dates=YYYYMMDD'
const UA = "curl/8.5.0";
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

/* ── MMA / UFC ────────────────────────────────────────────────────────────
 * MMA is shaped differently from every other league we track, and reading it
 * with the team code above is what produced "TBA vs TBA" cards wearing the UFC
 * league logo:
 *   - competitors carry `athlete`, and `team` is null — so team() fell through
 *     to its "TBD" default and to no logo.
 *   - ONE ESPN event is a whole fight card: `competitions` held 13 bouts for
 *     UFC Fight Night: Ankalaev vs. Guskov. Reading competitions[0] showed a
 *     curtain-jerker prelim, never the fight the card is named after.
 * Verified against the live scoreboard on 2026-07-22.
 */

/** Bouts are listed prelims-first with the MAIN EVENT LAST (confirmed: the last
 *  competition matched the event's own "… : Ankalaev vs. Guskov" title). */
function mainEventLast<T>(comps: T[]): T | undefined {
  return comps[comps.length - 1];
}

/** The bout's weight class — the only division/gender signal in the payload
 *  (there is no gender field on the athlete, and `type.text` is always null;
 *  `type.abbreviation` is what's actually populated). */
function weightClass(comp: any): string {
  return String(comp?.type?.abbreviation || comp?.type?.text || "");
}

/** Women's divisions come through abbreviated as "W Strawweight" /
 *  "W Bantamweight" / "W Flyweight" — NOT "Women's …" (verified across all 23
 *  UFC cards in 2026). Matching on a leading "W " token is what actually works;
 *  it can't catch "Welterweight", which has no space after the W. */
function isWomensBout(comp: any): boolean {
  return /^w\s|women/i.test(weightClass(comp));
}

/** "W Strawweight" → "Women's Strawweight" for display; other classes as-is. */
function weightClassLabel(comp: any): string {
  const wc = weightClass(comp);
  return /^w\s/i.test(wc) ? `Women's ${wc.slice(2)}` : wc;
}

/** ESPN athlete id, recovered from the fighter's player-card link — the
 *  scoreboard payload has no id field of its own. */
function athleteId(a: any): string | null {
  for (const l of a?.links || []) {
    const m = /\/id\/(\d+)\//.exec(String(l?.href || ""));
    if (m) return m[1];
  }
  return null;
}

/** Fighters go by surname on a fight card ("Ankalaev vs Guskov"). The payload
 *  has fullName/displayName/shortName but no lastName, so take the last token. */
function lastName(full?: string): string {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "TBD";
}

/** A fighter as an EventTeam: surname + headshot instead of club + crest. The
 *  headshot CDN is keyed by the athlete id (verified 200/real images; an
 *  unknown id returns an empty file, which just renders as no portrait). */
function fighter(c: any) {
  const a = c?.athlete || {};
  const id = athleteId(a);
  return {
    name: lastName(a.fullName || a.displayName),
    abbrev: a.shortName as string | undefined,
    logo: id ? `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png` : undefined,
    score: c?.score as string | undefined,
  };
}

/**
 * A fight card reduced to the fights people tune in for: the main event, plus
 * the women's main event when the card has one. Each is emitted as its OWN
 * GameEvent so it gets its own card and its own hero, rather than the whole
 * card collapsing into a single row. Undercard and prelims are dropped.
 */
function mmaGames(ev: any): GameEvent[] {
  const comps: any[] = ev?.competitions || [];
  if (!comps.length) return [];

  const main = mainEventLast(comps);
  // The co-main women's bout, if any — skipped when the main event already is
  // one, so a women's headliner isn't listed twice.
  const womensMain = [...comps].reverse().find((c) => isWomensBout(c) && c !== main);

  return [main, ...(womensMain ? [womensMain] : [])]
    .filter(Boolean)
    .map((comp: any) => {
      const cs: any[] = comp.competitors || [];
      const a = fighter(cs[0]);
      const b = fighter(cs[1]);
      const st = comp?.status?.type || ev?.status?.type || {};
      const weight = weightClassLabel(comp);
      const status = st.shortDetail || st.detail || "";
      return {
        id: String(comp.id || ev.id),
        shortName: `${a.name} vs ${b.name}`,
        // No home/away in a cage; competitor order is ESPN's billing order.
        home: a,
        away: b,
        dateUtc: comp.date || ev.date,
        state: (st.state as GameEvent["state"]) || "pre",
        detail: [weight, status].filter(Boolean).join(" · "),
        broadcasts: pickBroadcasts(comp),
      };
    });
}

async function fetchLeague(date: string, espnPath: string): Promise<{ logo?: string; games: GameEvent[] } | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${date}`;
  const isMma = espnPath.startsWith("mma/");
  console.log("[fetchLeague] Fetching:", url);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      console.log("[fetchLeague] Request failed for", url, res.status, res.statusText);
      return null;
    }
    const data = await res.json();
    console.log("[fetchLeague] Response for", url, JSON.stringify(data));
    console.log("[fetchLeague] Response for", url, "has events:", !!data?.events?.length);
    const leagueLogo = data?.leagues?.[0]?.logos?.[0]?.href as string | undefined;
    const games: GameEvent[] = [];
    for (const ev of data?.events || []) {
      // A fight card is one event holding every bout — normalized separately to
      // the headline fights (see mmaGames).
      if (isMma) {
        games.push(...mmaGames(ev));
        continue;
      }
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
  } catch (e) {
    console.error("[fetchLeague] Error fetching", url, e);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;

  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
