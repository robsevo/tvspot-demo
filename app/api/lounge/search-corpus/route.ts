import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";

/**
 * The full searchable universe for the Search page — everything a user can SEE
 * anywhere in the app, not just the trending slice:
 *
 *   - the 9 backend service catalogs, RAW (no US/CA gate: if a title shows on a
 *     service row, search must find it)
 *   - /api/lounge/classics (incl. the force-kept CLASSIC_MOVIE_PICKS — Rush Hour,
 *     Get Over It, … — which live OUTSIDE the trending catalog and were invisible
 *     to search before this route existed)
 *   - /api/lounge/catalog?trending=true (TMDB-injected megahits that no backend
 *     service catalog carries)
 *
 * Items are stripped to the light fields search results render (no overview/
 * backdrop — they dominate payload size and the detail page refetches them).
 * Result is user-independent → same process-wide SWR cache pattern as trending.
 */

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";
const SERVICES = ["Netflix", "Disney+", "HBO Max", "Prime Video", "Paramount+", "Apple TV+", "Hulu", "Crave", "Peacock"];

function fixImageUrl(url: string | undefined | null, size = "w500"): string {
  if (!url) return "";
  if (url.startsWith("/api/images")) return url;
  if (url.startsWith("http")) {
    if (url.includes("image.tmdb.org") || url.includes("example.com")) {
      return `/api/images?url=${encodeURIComponent(url)}`;
    }
    return url;
  }
  if (url.startsWith("/")) return `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/${size}${url}`)}`;
  return url;
}

type LightItem = {
  tmdb_id: number;
  title: string;
  year: string;
  vote_average: number;
  poster: string;
  service: string;
  category: "movie" | "series";
};

function lightItem(it: any, kind: "movie" | "series"): LightItem | null {
  const tmdb_id = it.tmdb_id || it.id;
  const title = (it.title || it.name || "").trim();
  if (!tmdb_id || !title) return null;
  return {
    tmdb_id,
    title,
    year: (it.year || it.release_date || it.first_air_date || "").toString().slice(0, 4),
    vote_average: (it.vote_average ?? Number(it.rating)) || 0,
    poster: fixImageUrl(it.poster || it.poster_path),
    service: it.service || "",
    category: kind,
  };
}

type Corpus = { movies: LightItem[]; series: LightItem[] };

async function computeCorpus(cookie: string, origin: string): Promise<Corpus> {
  const seen = { movie: new Set<number>(), series: new Set<number>() };
  const movies: LightItem[] = [];
  const series: LightItem[] = [];

  const add = (items: any[], kind: "movie" | "series") => {
    for (const raw of items || []) {
      const it = lightItem(raw, kind);
      if (it && !seen[it.category].has(it.tmdb_id)) {
        seen[it.category].add(it.tmdb_id);
        (it.category === "movie" ? movies : series).push(it);
      }
    }
  };

  const getJson = (url: string, timeoutMs: number) =>
    fetch(url, { headers: { Cookie: cookie }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

  // Every source is best-effort: a slow/failed leg drops its titles from THIS
  // build only — the SWR refresh picks them up next round. The internal trending
  // fetch gets a short box so a cold trending cache can never stall search.
  const [classics, trending, ...perService] = await Promise.all([
    getJson(`${origin}/api/lounge/classics`, 8000),
    getJson(`${origin}/api/lounge/catalog?trending=true`, 4000),
    ...SERVICES.map((svc) => getJson(`${BACKEND}/lounge/vod/catalog?service=${encodeURIComponent(svc)}`, 8000)),
  ]);

  for (const data of perService) {
    if (!data) continue;
    add(data.movies, "movie");
    add(data.series, "series");
  }
  if (classics) {
    add(classics.movies, "movie");
    add(classics.series, "series");
  }
  if (trending) {
    add(trending.movies, "movie");
    add(trending.series, "series");
  }

  return { movies, series };
}

const CORPUS_FRESH_MS = 15 * 60 * 1000;
let corpusCache: { data: Corpus; ts: number } | null = null;
let corpusInFlight: Promise<Corpus> | null = null;

function refreshCorpus(cookie: string, origin: string): Promise<Corpus> {
  if (corpusInFlight) return corpusInFlight; // coalesce concurrent rebuilds
  corpusInFlight = (async () => {
    try {
      const data = await computeCorpus(cookie, origin);
      if (data.movies.length + data.series.length > 0) {
        corpusCache = { data, ts: Date.now() };
      }
      return data;
    } finally {
      corpusInFlight = null;
    }
  })();
  return corpusInFlight;
}

async function getCorpus(cookie: string, origin: string): Promise<Corpus> {
  if (corpusCache && Date.now() - corpusCache.ts < CORPUS_FRESH_MS) {
    return corpusCache.data; // fresh
  }
  if (corpusCache) {
    after(() => refreshCorpus(cookie, origin).catch(() => {})); // stale → SWR in background
    return corpusCache.data;
  }
  return refreshCorpus(cookie, origin); // cold — compute once for this process
}

export async function GET(request: NextRequest) {
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || "";
  const origin = `${proto}://${host}`;
  const data = await getCorpus(request.headers.get("cookie") || "", origin);
  return NextResponse.json(data);
}
