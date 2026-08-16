/**
 * Leagues surfaced on the Events page, with their ESPN scoreboard path, a stable
 * logo, and the OUR-channel slug prefixes that typically carry the league in
 * Canada (used to cross-reference a live game to a watchable channel).
 *
 * Data comes from ESPN's public scoreboard API:
 *   site.api.espn.com/apis/site/v2/sports/{espnPath}/scoreboard?dates=YYYYMMDD
 * which returns events with competitors, status (pre|in|post), and broadcasts.
 * Logos here are static fallbacks; the API route prefers the logo ESPN returns
 * for the league that day so it's always correct.
 */

export interface LeagueConfig {
  key: string;
  /** Display name shown as the group header. */
  name: string;
  /** ESPN sport/league path segment. */
  espnPath: string;
  /** Stable league logo (fallback if the API response has none). */
  logo: string;
  /** OUR channel-slug prefixes that carry this league (channelSlug startsWith). */
  channels: string[];
}

const L = (id: string) => `https://a.espncdn.com/i/leaguelogos/soccer/500/${id}.png`;
const T = (x: string) => `https://a.espncdn.com/i/teamlogos/leagues/500/${x}.png`;

/** Order here is the display order on the Events page. */
export const LEAGUES: LeagueConfig[] = [
  { key: "nhl", name: "NHL", espnPath: "hockey/nhl", logo: T("nhl"), channels: ["sportsnet", "cbc", "tsn", "rds"] },
  { key: "nfl", name: "NFL", espnPath: "football/nfl", logo: T("nfl"), channels: ["ctv", "tsn", "rds", "citytv", "nfl-network"] },
  { key: "nba", name: "NBA", espnPath: "basketball/nba", logo: T("nba"), channels: ["tsn", "rds", "sportsnet"] },
  { key: "mls", name: "MLS", espnPath: "soccer/usa.1", logo: L("19"), channels: ["tsn", "rds", "fox-sports", "fs1", "fs2"] },
  { key: "fifa-world", name: "FIFA World Cup", espnPath: "soccer/fifa.world", logo: L("4"), channels: ["ctv", "tsn", "rds", "fox-sports", "fs1", "fs2"] },
  { key: "copa-america", name: "Copa América", espnPath: "soccer/conmebol.america", logo: L("83"), channels: ["tsn", "rds", "fox-sports", "fs1", "fs2"] },
  { key: "uefa-euro", name: "UEFA Euro", espnPath: "soccer/uefa.euro", logo: L("2189"), channels: ["tsn", "rds", "fox-sports", "fs1", "fs2"] },
  { key: "uefa-champions", name: "Champions League", espnPath: "soccer/uefa.champions", logo: L("2"), channels: ["tsn", "rds", "fox-sports", "fs1", "fs2"] },
  { key: "serie-a", name: "Serie A", espnPath: "soccer/ita.1", logo: L("12"), channels: ["tsn", "rds", "fox-sports", "fs1", "fs2"] },
  { key: "premier-league", name: "Premier League", espnPath: "soccer/eng.1", logo: L("23"), channels: ["sportsnet", "tsn", "fox-sports", "fs1", "fs2"] },
  { key: "la-liga", name: "La Liga", espnPath: "soccer/esp.1", logo: L("15"), channels: ["tsn", "rds", "fox-sports", "fs1", "fs2"] },
  { key: "ufc", name: "UFC", espnPath: "mma/ufc", logo: T("ufc"), channels: ["tsn", "sportsnet"] },
  { key: "bundesliga", name: "Bundesliga", espnPath: "soccer/ger.1", logo: L("10"), channels: ["sportsnet", "tsn", "fox-sports", "fs1", "fs2"] },
];

export interface EventTeam {
  name: string;
  abbrev?: string;
  logo?: string;
  score?: string;
}

export interface GameEvent {
  id: string;
  shortName: string;
  home: EventTeam;
  away: EventTeam;
  dateUtc: string;
  /** ESPN status state. */
  state: "pre" | "in" | "post";
  /** Human status, e.g. "7:00 PM", "2nd 12:30", "Final". */
  detail: string;
  /** Broadcast networks (US/intl), best-effort. */
  broadcasts: string[];
}

/** Kickoff time in Eastern, e.g. "7:00 PM ET". Shared by the web hero and the
 *  10-foot hero so a game reads the same on both. */
export function etTime(iso: string): string {
  try {
    return (
      new Date(iso).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
      }) + " ET"
    );
  } catch {
    return "";
  }
}

export interface LeagueEvents {
  key: string;
  name: string;
  logo: string;
  games: GameEvent[];
}

export interface EventsResponse {
  date: string;
  leagues: LeagueEvents[];
}

/** Minimal channel shape needed for cross-referencing (matches lib/types Channel). */
interface CarrierChannel {
  name: string;
  online: boolean;
}

/**
 * All of OUR channels that carry a league, matched by channel-slug prefix (so
 * every TSN1–5 / Sportsnet variant counts), online channels first. Used to show
 * the Canadian broadcaster(s) for a game and to filter the Live grid to "what's
 * carrying this game". Returns [] if we carry none.
 */
/**
 * Does `slug` name a FEED of the brand `key`, rather than a different channel
 * that merely starts with the same letters?
 *
 * `slug.startsWith(key)` alone is the defect that made MTV serve MTV Lebanon and
 * TSN serve ESPN8 on the backend (fixed there 2026-07-28 via feed-qualifier
 * tokens). The same bare prefix test was still here, and measured against the
 * live 126-channel lineup it handed sports leagues their NEWS siblings:
 *   cbc -> CBC News Network            (NHL)
 *   ctv -> CTV News, CTV News Network  (NFL, FIFA World Cup)
 *   rds -> RDS INFO                    (nine leagues)
 * So the Events "Watch" deep-link could send a viewer to a news channel.
 *
 * The tail after the brand must be feed qualifiers ONLY. Numbered and regional
 * feeds are deliberately KEPT: Canadian networks carry the same event across
 * TSN1-5 and Sportsnet East/West/Ontario/Pacific, and dropping them would leave
 * real carriers unlisted — the opposite failure.
 */
const FEED_QUALIFIER_TOKENS = new Set([
  // numbered feeds
  "1", "2", "3", "4", "5", "6", "one", "two", "360",
  // regional feeds
  "east", "west", "ontario", "pacific", "atlantic", "central", "national",
  // quality/format flags
  "hd", "sd", "fhd", "uhd", "4k", "plus",
]);

export function isFeedOfBrand(slug: string, key: string): boolean {
  if (!slug.startsWith(key)) return false;
  const tail = slug.slice(key.length).replace(/^-+/, "");
  if (tail === "") return true; // exact brand match
  return tail.split("-").every((t) => FEED_QUALIFIER_TOKENS.has(t));
}

export function carriersForLeague<T extends CarrierChannel>(
  leagueKey: string,
  channels: T[],
  slugify: (name: string) => string,
): T[] {
  const lg = LEAGUES.find((l) => l.key === leagueKey);
  if (!lg) return [];
  const matches = channels.filter((c) => {
    const slug = slugify(c.name);
    return lg.channels.some((k) => isFeedOfBrand(slug, k));
  });
  // Online first, otherwise preserve lineup order (the player runtime-verifies
  // sources anyway, so an offline-flagged carrier is still worth offering).
  return [...matches].sort((a, b) => Number(b.online) - Number(a.online));
}

/**
 * ESPN reports the broadcaster it knows about — a US feed name — which is not
 * always what the same service is called in a Canadian IPTV lineup. This maps
 * the gap. Keys are matched case-insensitively against ESPN's `broadcasts`
 * strings; values are brand keys resolved against the lineup with the same
 * feed-qualifier rules as everything else here.
 *
 * Measured 2026-08-16 against the live lineup: every MLS game that day reported
 * `Apple TV` (MLS Season Pass), and the lineup carries that as the channel
 * named `MLS`. La Liga reported `ESPN+`, which the lineup already has verbatim
 * and so needs no entry.
 */
const BROADCAST_ALIASES: Record<string, string[]> = {
  "apple tv": ["mls"],
  "apple tv+": ["mls"],
  "mls season pass": ["mls"],
  "espn deportes": ["espn"],
  "tsn+": ["tsn"],
  "sportsnet+": ["sportsnet"],
};

/**
 * Channels that are actually airing THIS GAME, preferred over the league's
 * static brand list.
 *
 * WHY THIS EXISTS. `carriersForLeague` answers "which channels carry this
 * league", which is not the same question as "where is this game on right now",
 * and presenting the first as the second is a fabrication. Measured against live
 * data on 2026-08-16: every MLS game was on Apple TV and every La Liga game on
 * ESPN+, while the league lists offered `tsn, rds, fox-sports, fs1, fs2` — so the
 * Watch button sent a viewer to TSN1, which was showing something else entirely.
 * Both ESPN+ and MLS were sitting in the lineup unused, because neither appears
 * in any league's `channels`.
 *
 * So: match the game's OWN broadcasters against the lineup first. Only when none
 * of them resolve do we fall back to the league brand list — and callers should
 * present that fallback as "carries this league", never as "showing this game".
 */
export function carriersForGame<T extends CarrierChannel>(
  leagueKey: string,
  broadcasts: string[],
  channels: T[],
  slugify: (name: string) => string,
): { carriers: T[]; exact: boolean } {
  // Two separate sets, deliberately. `names` is what an exact match may use —
  // the broadcaster strings themselves plus any alias TARGETS. `wanted` is for
  // slug/feed expansion only. Mixing them is a real bug: slugify("ESPN+") is
  // "espn", so a slug in the exact-name set makes an ESPN+ broadcast match the
  // ESPN channel, which is the wrong-channel problem this function exists to fix.
  const names: string[] = [];
  const wanted: string[] = [];
  for (const b of broadcasts || []) {
    const norm = (b || "").trim().toLowerCase();
    if (!norm) continue;
    names.push(norm);
    wanted.push(slugify(b));
    for (const alias of BROADCAST_ALIASES[norm] || []) {
      names.push(alias);
      wanted.push(alias);
    }
  }

  if (wanted.length) {
    // EXACT NAME FIRST. slugify() strips punctuation, so "ESPN+" and "ESPN"
    // both become "espn" — matching by slug alone linked an ESPN+ match to
    // ESPN and ESPN2 as well, which is the same wrong-channel bug one level
    // down. An exact, case-insensitive name hit is unambiguous, so it wins
    // outright; feed expansion (TSN -> TSN1..5) only runs when nothing matched.
    const exactNames = new Set(names);
    const byName = channels.filter((c) => exactNames.has((c.name || "").trim().toLowerCase()));
    if (byName.length) {
      return {
        carriers: [...byName].sort((a, b) => Number(b.online) - Number(a.online)),
        exact: true,
      };
    }
    const hits = channels.filter((c) => {
      const slug = slugify(c.name);
      return wanted.some((w) => isFeedOfBrand(slug, w));
    });
    if (hits.length) {
      return {
        carriers: [...hits].sort((a, b) => Number(b.online) - Number(a.online)),
        exact: true,
      };
    }
  }
  return { carriers: carriersForLeague(leagueKey, channels, slugify), exact: false };
}

/**
 * One representative carrier channel for a league (online preferred). Thin
 * wrapper over carriersForLeague for the Events page "Watch" deep-link.
 */
export function carrierForLeague(
  leagueKey: string,
  channels: CarrierChannel[],
  slugify: (name: string) => string,
): CarrierChannel | null {
  return carriersForLeague(leagueKey, channels, slugify)[0] || null;
}

/**
 * Distinct Canadian broadcaster channels for a league — deduped to one channel
 * per brand (TSN1+TSN5 → just TSN1) so the per-game broadcaster list reads
 * "TSN1 · Sportsnet · CTV" instead of repeating the same brand five times.
 */
export function broadcastersForLeague<T extends CarrierChannel>(
  leagueKey: string,
  channels: T[],
  slugify: (name: string) => string,
  max = 4,
): T[] {
  const lg = LEAGUES.find((l) => l.key === leagueKey);
  if (!lg) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of carriersForLeague(leagueKey, channels, slugify)) {
    const slug = slugify(c.name);
    const brand = lg.channels.find((k) => isFeedOfBrand(slug, k)) || slug;
    if (seen.has(brand)) continue;
    seen.add(brand);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
