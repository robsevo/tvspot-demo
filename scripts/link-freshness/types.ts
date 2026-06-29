/** Pipeline-specific types for the link-freshness tool. */

export interface CredentialSet {
  source: string; // where the creds came from (post ID or URL)
  server: string;
  username: string;
  password: string;
}

export interface M3uEntry {
  channelName: string;
  streamUrl: string;
  credentialSource: string;
  /** Original #EXTINF line attributes (tvg-id, tvg-name, group-title, etc.) */
  attrs: Record<string, string>;
}

export interface MatchResult {
  channelName: string; // example.com channel name
  channelSlug: string; // slugified for JSON key
  candidates: M3uEntry[]; // all M3U entries that matched this channel
}

export interface VerifiedSource {
  /** Playable URL (browser-ready: relay-wrapped or stream-proxy-wrapped). */
  url: string;
  tier: number; // 1-4
  latencyMs: number;
  /** Last time this URL was tested OK (ISO). */
  verifiedUtc: string;
  /** First time this URL ever passed (ISO) — preserved across nightly runs. */
  firstSeenUtc?: string;
  /** Where the link came from: the backend channel list, a specific source adapter,
   *  or carried over from a previous run's store. */
  origin?: "iptv_org" | "github" | "reddit" | "backend" | "store";
  /** Passed the liveness check (edge advanced over time) on the last run. Used to
   *  RANK (live-first) — NOT to delete: a flaky 9s snapshot must not drop a
   *  loadable link, or we'd remove currently-working channels. */
  live?: boolean;
}

/** A candidate link to test: verify one URL, store another (raw vs wrapped). */
export interface Candidate {
  /** URL to fetch when testing (raw upstream is fastest from Node). */
  verifyUrl: string;
  /** Browser-playable URL to persist if the test passes. */
  storeUrl: string;
  origin: "iptv_org" | "github" | "reddit" | "backend" | "store";
  /** Carried forward from a prior run, if this URL was already in the store. */
  firstSeenUtc?: string;
}

export interface VerifiedChannel {
  name: string;
  /** Active set shown on the site — up to 5, sticky (working ones not replaced),
   *  live-verified first. */
  sources: VerifiedSource[];
  /** Reserve bench — all other loadable links (unbounded), promoted into the
   *  active set when an active one dies on a later run. */
  waiting?: VerifiedSource[];
}

export interface VerifiedMovie {
  tmdb_id: number;
  title: string;
  embed_urls: string[];
  stream_urls: string[];
}

export interface PipelineMeta {
  generated_utc: string;
  pipeline_version: number;
  /** Per-source breakdown: N entries ingested, N matched to channels, status. */
  sources: Record<string, { entries: number; status: "ok" | "failed" }>;
  streams_verified: number;
  vod_verified: number;
  /** ISO timestamp of the last VOD scrape run (for incremental scoping). */
  last_vod_scrape_utc?: string;
}

export interface VerifiedVodSource {
  url: string;
  provider: string;
  tier: number;
  latencyMs: number;
  verifiedUtc: string;
  firstSeenUtc: string;
  quality?: string;
  subtitles?: { url: string; lang: string }[];
}

export interface VerifiedVodItem {
  tmdb_id: number;
  title: string;
  type: "movie" | "tv";
  season?: number;
  episode?: number;
  sources: VerifiedVodSource[];
}

export interface VerifiedSources {
  meta: PipelineMeta;
  channels: Record<string, VerifiedChannel>;
  vod?: {
    movies: Record<string, VerifiedMovie>;
    /** Keyed by "tmdbId-sS-eE" for episodes, "tmdbId" for series-level entries. */
    scraped?: Record<string, VerifiedVodItem>;
  };
}

/** Input shape for VOD provider extractors. */
export interface VodExtractorInput {
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  season?: number;
  episode?: number;
}

export interface VodExtractedSource {
  url: string;
  provider: string;
  quality?: string;
  subtitles?: { url: string; lang: string }[];
  headers?: Record<string, string>;
}

// Re-exported for convenience
export interface Channel {
  name: string;
  online: boolean;
  category?: string;
  logo?: string;
  logo_url?: string;
  primary_url?: string;
  backup_urls?: string[];
}

export interface ChannelsResponse {
  channels: (Channel & { programs?: unknown[] })[];
}