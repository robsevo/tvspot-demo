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
  { key: "mls", name: "MLS", espnPath: "soccer/usa.1", logo: L("19"), channels: ["tsn", "rds"] },
  { key: "fifa-world", name: "FIFA World Cup", espnPath: "soccer/fifa.world", logo: L("4"), channels: ["ctv", "tsn", "rds"] },
  { key: "copa-america", name: "Copa América", espnPath: "soccer/conmebol.america", logo: L("83"), channels: ["tsn", "rds"] },
  { key: "uefa-euro", name: "UEFA Euro", espnPath: "soccer/uefa.euro", logo: L("2189"), channels: ["tsn", "rds"] },
  { key: "uefa-champions", name: "Champions League", espnPath: "soccer/uefa.champions", logo: L("2"), channels: ["tsn", "rds"] },
  { key: "serie-a", name: "Serie A", espnPath: "soccer/ita.1", logo: L("12"), channels: ["tsn", "rds"] },
  { key: "premier-league", name: "Premier League", espnPath: "soccer/eng.1", logo: L("23"), channels: ["sportsnet", "tsn"] },
  { key: "la-liga", name: "La Liga", espnPath: "soccer/esp.1", logo: L("15"), channels: ["tsn", "rds"] },
  { key: "ufc", name: "UFC", espnPath: "mma/ufc", logo: T("ufc"), channels: ["tsn", "sportsnet"] },
  { key: "bundesliga", name: "Bundesliga", espnPath: "soccer/ger.1", logo: L("10"), channels: ["sportsnet", "tsn"] },
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
 * Cross-reference a league to one of OUR channels that carries it. Matches by
 * channel-slug prefix (so any TSN1–5 / Sportsnet variant counts), preferring an
 * online channel but falling back to a known carrier even if currently offline
 * (the player runtime-verifies sources anyway). Returns null if we carry none.
 */
export function carrierForLeague(
  leagueKey: string,
  channels: CarrierChannel[],
  slugify: (name: string) => string,
): CarrierChannel | null {
  const lg = LEAGUES.find((l) => l.key === leagueKey);
  if (!lg) return null;
  const matches = channels.filter((c) => {
    const slug = slugify(c.name);
    return lg.channels.some((k) => slug.startsWith(k));
  });
  if (!matches.length) return null;
  return matches.find((c) => c.online) || matches[0];
}
