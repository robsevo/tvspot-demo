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
export function carriersForLeague<T extends CarrierChannel>(
  leagueKey: string,
  channels: T[],
  slugify: (name: string) => string,
): T[] {
  const lg = LEAGUES.find((l) => l.key === leagueKey);
  if (!lg) return [];
  const matches = channels.filter((c) => {
    const slug = slugify(c.name);
    return lg.channels.some((k) => slug.startsWith(k));
  });
  // Online first, otherwise preserve lineup order (the player runtime-verifies
  // sources anyway, so an offline-flagged carrier is still worth offering).
  return [...matches].sort((a, b) => Number(b.online) - Number(a.online));
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
    const brand = lg.channels.find((k) => slug.startsWith(k)) || slug;
    if (seen.has(brand)) continue;
    seen.add(brand);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
