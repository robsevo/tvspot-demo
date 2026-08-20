/**
 * Shape of `data/vod-index.json` — the on-demand catalogue, keyed by TMDB id.
 *
 * Read server-side by `lib/vod-resolve.ts`. Deliberately holds nothing but
 * absolute, directly-playable URLs: no accounts, no credentials, no per-user
 * state. Anything that needs a secret to play does not belong in a file that
 * ships with the repository.
 *
 * Keying by TMDB id (rather than by title) means the catalogue joins cleanly to
 * artwork and metadata without any fuzzy title matching, and two entries for the
 * same film cannot drift apart.
 */

/** One playable source for a title. Several per title is the normal case — that
 *  is what gives the player something to fail over to. */
export interface VodStream {
  /** Absolute http(s) URL to an mp4 or an HLS playlist. */
  url: string;
  /** Human label shown in the source picker, e.g. "1080p" or "mirror 2". */
  label?: string;
  /** Container hint. `hls` is treated as a playlist, anything else as progressive. */
  kind?: "mp4" | "hls";
}

/** `"s1e2"` — season/episode key used for series entries. */
export type EpisodeKey = `s${number}e${number}`;

export interface VodIndex {
  generated_utc: string;
  /** tmdb id → sources for the film. */
  movies: Record<string, VodStream[]>;
  /** tmdb id → episode key → sources for that episode. */
  series: Record<string, Partial<Record<EpisodeKey, VodStream[]>>>;
}

/** Build the episode key used throughout the index. */
export function episodeKey(season: number, episode: number): EpisodeKey {
  return `s${season}e${episode}`;
}
