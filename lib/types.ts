export interface CatalogItem {
  tmdb_id: number;
  title: string;
  name?: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
  year?: string;
  rating?: string;
  vote_average?: number;
  service: string;
  category?: string;
  genres?: string[];
  genre_ids?: number[];
  media_type?: string;
  popularity?: number;
}

export interface CatalogPreviewItem {
  tmdb_id?: number;
  name?: string;
  poster?: string;
  backdrop?: string;
}

export interface CatalogSummaryEntry {
  movies_count: number;
  series_count: number;
  /** Backend sends an array of sample items; virtual services use a description string. */
  preview: CatalogPreviewItem[] | string;
}

export interface CatalogResponse {
  services: string[];
  summary: Record<string, CatalogSummaryEntry>;
  /** Virtual sections (Classics/Theater) the server can actually populate.
   *  Absent from older/real backends — the client then assumes all of them. */
  virtual_services?: string[];
}

export interface ServiceCatalogResponse {
  movies: CatalogItem[];
  series: CatalogItem[];
}

export interface EpgResponse {
  programmes: Record<string, EpgProgram[]>;
}

export interface EpgProgram {
  title: string;
  start_utc: string;
  stop_utc: string;
}

export interface Channel {
  name: string;
  online: boolean;
  category?: string;
  channel_number?: number;
  logo?: string;
  logo_url?: string;
  primary_url?: string;
  backup_urls?: string[];
  /**
   * Nightly-verified stream URLs, best-first, attached by our own
   * /api/lounge/live-channels route (NOT by the backend) — see
   * lib/channelSources.ts. Absent when the channel has no verified links.
   */
  verified_sources?: string[];
  /**
   * Best nightly bufferScore among those verified sources (0-100), attached by
   * the same route. A LOW value is advance warning that this channel's links are
   * thin — measured 2026-08-05, the only two channels whose first source failed
   * carried the lowest scores in the sample (25 and 23, vs 50-80 for the rest).
   * The player uses it to pull the waiting bench up front instead of waiting for
   * a full probe pass to come up short.
   */
  source_confidence?: number;
  /** Sports game-guide entries the backend attaches per channel on live-channels. */
  programs?: EpgProgram[];
}

export interface VodDetail {
  tmdb_id: number;
  title: string;
  backdrop?: string;
  overview?: string;
  year?: string;
  rating?: string;
  vote_average?: number;
  service: string;
  embed_urls?: string[];
  stream_urls?: string[];
}

export interface Episode {
  episode_number: number;
  title: string;
  overview?: string;
  still_url?: string;
  embed_urls?: string[];
  stream_urls?: string[];
}

export interface Season {
  season_number: number;
  episodes: Episode[];
}

export interface SeriesDetail {
  tmdb_id: number;
  title: string;
  poster?: string;
  overview?: string;
  year?: string;
  rating?: string;
  service: string;
  seasons: Season[];
}

export interface MyListItem {
  tmdbId: number;
  title: string;
  poster?: string;
  kind: "movie" | "series";
  service?: string;
  addedAt: number;
}

export interface ContinueWatchingItem {
  tmdbId: number;
  title: string;
  poster?: string;
  kind: "movie" | "series";
  season?: number;
  episode?: number;
  progress: number; // 0-100
  duration: number; // seconds
  updatedAt: number;
}

export interface ChannelsResponse {
  channels: Channel[];
}

export interface Service {
  name: string;
  count?: number;
}

/** Genre taxonomy for filtering */
export const MOVIE_GENRES = [
  "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary",
  "Drama", "Family", "Fantasy", "History", "Horror", "Music",
  "Mystery", "Romance", "Science Fiction", "Thriller", "War", "Western",
];

export const TV_GENRES = [
  "Action & Adventure", "Animation", "Comedy", "Crime", "Documentary",
  "Drama", "Family", "Kids", "Mystery", "Reality", "Sci-Fi & Fantasy",
  "Soap", "Talk", "War & Politics", "Western",
];

export function detectGenre(title: string, overview: string, existing?: string[]): string[] {
  if (existing && existing.length > 0) return existing;
  const text = `${title} ${overview}`.toLowerCase();

  const genreKeywords: Record<string, string[]> = {
    "Action": ["action", "explosion", "fight", "battle", "war", "weapon", "killer", "assassin", "agent", "mission", "rescue", "escape"],
    "Comedy": ["comedy", "funny", "hilarious", "laugh", "humor", "satire", "parody", "sitcom", "stand-up"],
    "Drama": ["drama", "love", "heart", "family", "relationship", "divorce", "affair", "tragedy", "loss", "grief"],
    "Horror": ["horror", "scary", "haunted", "ghost", "demon", "terror", "nightmare", "blood", "gore", "slasher", "scream"],
    "Romance": ["romance", "love", "romantic", "kiss", "passion", "heart", "dating", "wedding", "marriage"],
    "Thriller": ["thriller", "suspense", "mystery", "twist", "conspiracy", "hunt", "fugitive", "revenge"],
    "Science Fiction": ["sci-fi", "science fiction", "space", "alien", "robot", "cyber", "futur", "time travel", "dimension", "galaxy", "mars"],
    "Fantasy": ["fantasy", "magic", "dragon", "sword", "myth", "legend", "kingdom", "wizard", "witch", "fairy"],
    "Documentary": ["documentary", "document", "real story", "true story", "expose", "investigat", "nature", "history", "science"],
    "Crime": ["crime", "detective", "police", "murder", "gang", "mafia", "investigation", "mystery", "criminal"],
    "Mystery": ["mystery", "detective", "investigation", "clue", "whodunit", "puzzle", "solving", "enigma"],
    "Animation": ["animation", "animated", "cartoon", "anime", "pixar", "disney", "dreamworks"],
    "Family": ["family", "children", "kid", "parent", "home", "school", "growing up", "coming of age"],
    "Adventure": ["adventure", "quest", "treasure", "journey", "explore", "discovery", "voyage", "expedition"],
    "War": ["war", "soldier", "battle", "military", "army", "navy", "marine", "veteran", "front line"],
    "Western": ["western", "cowboy", "outlaw", "sheriff", "wild west", "frontier", "ranch", "desert"],
    "History": ["history", "historic", "medieval", "ancient", "empire", "kingdom", "century", "biography", "biopic"],
    "Music": ["music", "band", "singer", "concert", "rock", "pop", "musical", "orchestra", "song"],
  };

  const matched: string[] = [];
  for (const [genre, keywords] of Object.entries(genreKeywords)) {
    if (keywords.some(k => text.includes(k))) {
      matched.push(genre);
      if (matched.length >= 3) break;
    }
  }
  return matched.length > 0 ? matched : ["Drama"];
}

/** Detect genre from genre_ids (TMDB) */
export const GENRE_MAP: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};