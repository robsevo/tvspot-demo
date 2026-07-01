import { NextRequest, NextResponse, after } from "next/server";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

/**
 * Globally-iconic non-US/CA titles that BYPASS the USA/Canada-only language gate.
 * The gate exists to drop the long tail of foreign (K/J/Thai/Indian) dramas the
 * backend service catalogs inject, but a handful of megahits (Squid Game, Money
 * Heist, Parasite, …) should still surface. TMDB ids, verified. Kept regardless
 * of original_language/origin, and injected into trending so they always appear.
 */
const BYPASS_TV_IDS = [93405, 71446, 70523, 110316, 99966, 96648, 210905, 96677];
const BYPASS_MOVIE_IDS = [496243, 396535, 670];
const BYPASS_IDS = new Set<number>([...BYPASS_TV_IDS, ...BYPASS_MOVIE_IDS]);

/** Normalize backend items: backend uses `name` not `title`, `rating` not `vote_average` */
function fixImageUrl(url: string | undefined | null, size: string = "w500"): string {
  if (!url) return "";
  if (url.startsWith("/api/images")) return url; // already proxied
  if (url.startsWith("http")) {
    // Rewrite TMDB URLs through our proxy
    if (url.includes("image.tmdb.org")) {
      return `/api/images?url=${encodeURIComponent(url)}`;
    }
    // Rewrite example.com URLs through our proxy (needs auth cookies)
    if (url.includes("example.com")) {
      return `/api/images?url=${encodeURIComponent(url)}`;
    }
    return url;
  }
  if (url.startsWith("/")) return `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/${size}${url}`)}`;
  return url;
}

function normalizeItems(items: any[]): any[] {
  return items.map((item: any) => ({
    ...item,
    title: item.title || item.name || "",
    vote_average: (item.vote_average ?? Number(item.rating)) || 0,
    poster: fixImageUrl(item.poster || item.poster_path),
    backdrop: fixImageUrl(item.backdrop || item.backdrop_path, "w1280"),
  }));
}

// Pages of TMDB US/CA popular titles to pull per region (≈20 titles/page). At 3
// pages only ~60 titles/region got a real popularity score, so most of the
// (thousands-strong) catalog fell back to rating-only ordering — trending didn't
// feel "current". 18 pages (~360/region, ~720 US+CA) covers far more of the
// catalog's popular titles. Discover is cheap and this route response is cached.
const TMDB_PAGES = 18;

/**
 * US/CA, English-only TMDB signal for a kind. Returns two things from ONE cached
 * discover crawl:
 *  - `scores`: a recency/popularity rank from US+CA `discover` (drives ordering).
 *  - `allow`:  the set of tmdb_ids TMDB positively confirms are US/CA-origin and
 *              English. This is the USA/CANADA-ONLY gate: the backend service
 *              catalogs (Netflix, Crave, …) mix in Korean/Japanese/Thai/Indian
 *              dramas whose romanized titles pass a script check, so ranking
 *              alone never removes them — the caller DROPS anything not in `allow`.
 *
 * Both axes (popularity AND vote_average) are crawled so the allowlist covers
 * currently-trending *and* acclaimed US/CA titles — "Top Rated" pulls the latter,
 * which a popularity-only crawl misses. Responses are cached (revalidate) so this
 * doesn't re-hit TMDB every request.
 */
async function fetchRegionData(
  kind: "movie" | "tv",
): Promise<{ scores: Map<number, number>; allow: Set<number> }> {
  const tmdbToken = process.env.TMDB_ACCESS_TOKEN;
  const scores = new Map<number, number>();
  const allow = new Set<number>();
  if (!tmdbToken) return { scores, allow };

  // US is weighted slightly above CA: a CA placement is penalized by ~half a page
  // of ranks, so US wins ties and a US-only title edges out a same-rank CA-only
  // title, while a strongly-popular CA title still beats a weak US one.
  const REGION_PENALTY: Record<string, number> = { US: 0, CA: 30 };

  // Pin origin to US/CA (not just watch_region) so a foreign-origin title that
  // merely streams in the US can't sneak in. Two sort axes build the allowlist.
  const SORTS = ["popularity.desc", "vote_average.desc"];
  const reqs: { region: string; sort: string; page: number; p: Promise<{ results?: { id: number }[] }> }[] = [];
  for (const region of ["US", "CA"]) {
    for (const sort of SORTS) {
      for (let page = 1; page <= TMDB_PAGES; page++) {
        // Lift the vote floor for the rating crawl so a 10-vote fluke can't be
        // "top rated"; keep it low for the popularity crawl to cover breadth.
        const voteFloor = sort === "vote_average.desc" ? 200 : 50;
        const url =
          `https://api.themoviedb.org/3/discover/${kind}` +
          `?language=en-US&watch_region=${region}&with_original_language=en&with_origin_country=US%7CCA` +
          `&sort_by=${sort}&vote_count.gte=${voteFloor}&page=${page}`;
        reqs.push({
          region,
          sort,
          page,
          p: fetch(url, { headers: { Authorization: `Bearer ${tmdbToken}` }, next: { revalidate: 3600 } })
            .then((r) => r.json())
            .catch(() => ({ results: [] })),
        });
      }
    }
  }

  try {
    const settled = await Promise.all(reqs.map((r) => r.p));
    settled.forEach((pageData, idx) => {
      const { region, sort, page } = reqs[idx];
      for (const [i, r] of (pageData.results || []).entries()) {
        allow.add(r.id); // both crawls feed the US/CA-en allowlist
        if (sort === "popularity.desc") {
          const rank = (page - 1) * 20 + i; // 0 = most popular in region
          const score = 100000 - rank - REGION_PENALTY[region];
          scores.set(r.id, Math.max(scores.get(r.id) || 0, score));
        }
      }
    });
  } catch {}

  return { scores, allow };
}

/**
 * USA/CANADA ONLY gate. Keep a catalog item only if TMDB confirms it's US/CA-en
 * (in `allow`), OR it's one of our own TMDB-discover supplements (those are
 * US/CA-en by construction — see fetchDiscover). Everything else — the foreign
 * dramas the backend service catalogs inject — is dropped.
 */
function isUsCa(item: any, allow: Set<number>): boolean {
  if (item.service === "Popular Movies" || item.service === "Popular Series") return true;
  if (BYPASS_IDS.has(item.tmdb_id)) return true; // global megahit (Squid Game, …)
  return allow.has(item.tmdb_id);
}

/**
 * Write the US/CA popularity score onto each item's `popularity` field and sort
 * by it (then rating). Writing it back is essential: the home/VOD clients re-rank
 * by `popularity`, so the region signal must travel on the item, not just in the
 * route's sort order.
 */
function applyRegionScores(items: any[], scores: Map<number, number>): any[] {
  for (const it of items) {
    const s = scores.get(it.tmdb_id);
    if (s !== undefined) it.popularity = s;
  }
  return items.sort((a, b) => {
    const as = scores.get(a.tmdb_id) || 0;
    const bs = scores.get(b.tmdb_id) || 0;
    if (as !== bs) return bs - as;
    return (b.vote_average || 0) - (a.vote_average || 0);
  });
}

/**
 * Supplement the (narrow, ~200/service) backend catalog with broader American/
 * Canadian content straight from TMDB discover — so the home rails surface far
 * more popular movies + series, plus adult-animation shows (Family Guy, Rick &
 * Morty, …) that the backend catalog doesn't carry. These link to the normal
 * detail pages, which resolve metadata (example.com details work for ANY tmdb) and
 * streams (IPTV + provider-a) regardless of catalog membership. Each item carries
 * genre_ids so the client's genre/adult-animation rails pick it up.
 */
async function fetchDiscover(
  kind: "movie" | "tv",
  extra: string,
  pages: number,
): Promise<any[]> {
  const tmdbToken = process.env.TMDB_ACCESS_TOKEN;
  if (!tmdbToken) return [];
  const reqs: Promise<any>[] = [];
  for (let page = 1; page <= pages; page++) {
    // USA + Canada content ONLY: origin country US or CA, English-language.
    const url =
      `https://api.themoviedb.org/3/discover/${kind}` +
      `?language=en-US&watch_region=US&with_original_language=en&with_origin_country=US%7CCA` +
      `&sort_by=popularity.desc&vote_count.gte=50&page=${page}${extra}`;
    reqs.push(
      fetch(url, { headers: { Authorization: `Bearer ${tmdbToken}` }, next: { revalidate: 3600 } })
        .then((r) => r.json())
        .catch(() => ({ results: [] })),
    );
  }
  const pagesData = await Promise.all(reqs);
  const items: any[] = [];
  for (const pd of pagesData) {
    for (const m of pd.results || []) {
      items.push({
        tmdb_id: m.id,
        title: m.title || m.name || "",
        name: m.title || m.name || "",
        year: (m.release_date || m.first_air_date || "").slice(0, 4),
        rating: m.vote_average || 0,
        vote_average: m.vote_average || 0,
        poster: m.poster_path ? `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/w500${m.poster_path}`)}` : "",
        backdrop: m.backdrop_path ? `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/w1280${m.backdrop_path}`)}` : "",
        overview: m.overview || "",
        service: kind === "movie" ? "Popular Movies" : "Popular Series",
        category: kind === "movie" ? "movie" : "series",
        genre_ids: m.genre_ids || [],
        popularity: m.popularity || 0,
      });
    }
  }
  return items;
}

/**
 * Fetch specific TMDB titles by id (the BYPASS megahits) and map them to our item
 * shape so they can be injected into the trending corpus even if no backend
 * service catalog carries them. Tagged "Popular …" so they survive the US/CA gate.
 */
async function fetchTmdbByIds(kind: "movie" | "tv", ids: number[]): Promise<any[]> {
  const tmdbToken = process.env.TMDB_ACCESS_TOKEN;
  if (!tmdbToken) return [];
  const out = await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`https://api.themoviedb.org/3/${kind}/${id}?language=en-US`, {
          headers: { Authorization: `Bearer ${tmdbToken}` },
          next: { revalidate: 86400 },
        });
        if (!r.ok) return null;
        const m = await r.json();
        return {
          tmdb_id: m.id,
          title: m.title || m.name || "",
          name: m.title || m.name || "",
          year: (m.release_date || m.first_air_date || "").slice(0, 4),
          rating: m.vote_average || 0,
          vote_average: m.vote_average || 0,
          poster: m.poster_path ? `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/w500${m.poster_path}`)}` : "",
          backdrop: m.backdrop_path ? `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/w1280${m.backdrop_path}`)}` : "",
          overview: m.overview || "",
          service: kind === "movie" ? "Popular Movies" : "Popular Series",
          category: kind === "movie" ? "movie" : "series",
          genre_ids: (m.genres || []).map((g: any) => g.id),
          popularity: m.popularity || 0,
        };
      } catch {
        return null;
      }
    }),
  );
  return out.filter(Boolean);
}

/**
 * Per-title US/CA-English check via TMDB details (cached 24h). The discover
 * allowlist only covers the ~top popular/top-rated titles, so genuine but
 * lower-profile US/CA English titles get wrongly dropped. The backend catalog
 * items carry NO language/country metadata, so we resolve it from TMDB by id:
 * keep original_language === "en" AND origin/production country in {US, CA}.
 */
async function fetchTitleUsCaEn(kind: "movie" | "tv", id: number): Promise<boolean> {
  const tmdbToken = process.env.TMDB_ACCESS_TOKEN;
  if (!tmdbToken || !id) return false;
  try {
    const r = await fetch(`https://api.themoviedb.org/3/${kind}/${id}?language=en-US`, {
      headers: { Authorization: `Bearer ${tmdbToken}` },
      next: { revalidate: 86400 },
    });
    if (!r.ok) return false;
    const d = await r.json();
    if (d.original_language !== "en") return false;
    const countries: string[] = [
      ...(d.origin_country || []),
      ...((d.production_countries || []).map((c: any) => c.iso_3166_1)),
    ];
    return countries.includes("US") || countries.includes("CA");
  } catch {
    return false;
  }
}

/** Keep US/CA-English titles: fast-path the discover allowlist, then confirm the
 *  rest individually against TMDB (so we don't drop non-hit US/CA English titles).
 *  Bounded concurrency keeps the cold-cache TMDB burst civil. */
async function filterUsCaEn(items: any[], kind: "movie" | "tv", allow: Set<number>): Promise<any[]> {
  const out: any[] = [];
  const toCheck: any[] = [];
  for (const it of items) {
    if (it.service === "Popular Movies" || it.service === "Popular Series" || allow.has(it.tmdb_id) || BYPASS_IDS.has(it.tmdb_id)) out.push(it);
    else toCheck.push(it);
  }
  const CONC = 24;
  for (let i = 0; i < toCheck.length; i += CONC) {
    const batch = toCheck.slice(i, i + CONC);
    const ok = await Promise.all(batch.map((it) => fetchTitleUsCaEn(kind, it.tmdb_id)));
    batch.forEach((it, j) => { if (ok[j]) out.push(it); });
  }
  return out;
}

/** The heavy trending build: 9 backend service catalogs + TMDB discover/enrich/
 *  rank + US/CA gate. Result is user-independent, so it's cached below. */
async function computeTrending(cookie: string): Promise<{ movies: any[]; series: any[] }> {
  const services = ["Netflix", "Disney+", "HBO Max", "Prime Video", "Paramount+", "Apple TV+", "Hulu", "Crave", "Peacock"];
  const allMovies: any[] = [];
  const allSeries: any[] = [];
  const seenIds = new Set<number>();

  await Promise.all(
    services.map(async (svc) => {
      try {
        const res = await fetch(
          `${BACKEND}/lounge/vod/catalog?service=${encodeURIComponent(svc)}`,
          { headers: { Cookie: cookie } }
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const m of normalizeItems(data.movies || [])) {
          if (!seenIds.has(m.tmdb_id)) { seenIds.add(m.tmdb_id); allMovies.push(m); }
        }
        for (const s of normalizeItems(data.series || [])) {
          if (!seenIds.has(s.tmdb_id)) { seenIds.add(s.tmdb_id); allSeries.push(s); }
        }
      } catch {}
    })
  );

  // Supplement with broader US/CA TMDB content the backend catalog lacks:
  // more popular movies + series, plus a dedicated animation pass (genre 16)
  // so adult-animation shows appear. Dedupe against what the backend returned.
  const [supMovies, supSeries, supAnimation] = await Promise.all([
    fetchDiscover("movie", "", 5),
    fetchDiscover("tv", "", 5),
    fetchDiscover("tv", "&with_genres=16", 3), // animation (Family Guy, Rick & Morty, …)
  ]);
  for (const m of supMovies) {
    if (!seenIds.has(m.tmdb_id)) { seenIds.add(m.tmdb_id); allMovies.push(m); }
  }
  for (const s of [...supSeries, ...supAnimation]) {
    if (!seenIds.has(s.tmdb_id)) { seenIds.add(s.tmdb_id); allSeries.push(s); }
  }

  // Inject the global-megahit bypass titles (Squid Game, …) so they appear even
  // if no backend service catalog carries them. Deduped against the above.
  const [bypassMovies, bypassSeries] = await Promise.all([
    fetchTmdbByIds("movie", BYPASS_MOVIE_IDS),
    fetchTmdbByIds("tv", BYPASS_TV_IDS),
  ]);
  for (const m of bypassMovies) {
    if (!seenIds.has(m.tmdb_id)) { seenIds.add(m.tmdb_id); allMovies.push(m); }
  }
  for (const s of bypassSeries) {
    if (!seenIds.has(s.tmdb_id)) { seenIds.add(s.tmdb_id); allSeries.push(s); }
  }

  // Enrich + rank by US/CA popularity (writes score onto item.popularity).
  const [movieRegion, seriesRegion] = await Promise.all([
    fetchRegionData("movie"),
    fetchRegionData("tv"),
  ]);
  applyRegionScores(allMovies, movieRegion.scores);
  applyRegionScores(allSeries, seriesRegion.scores);

  // USA/CANADA ONLY: the backend service catalogs mix in foreign dramas (K/J/
  // Thai/Indian) whose romanized titles pass a script check; drop anything TMDB
  // doesn't confirm as US/CA-origin English. Our own discover supplements are
  // US/CA-en by construction and always kept (see isUsCa).
  const usCaMovies = allMovies.filter((m) => isUsCa(m, movieRegion.allow));
  const usCaSeries = allSeries.filter((s) => isUsCa(s, seriesRegion.allow));
  return { movies: usCaMovies, series: usCaSeries };
}

// The trending catalog is identical for every user, so cache the built result
// process-wide and serve it stale-while-revalidating: a stale hit returns
// instantly and refreshes in the background (after()), so the ~20s+ cold rebuild
// (dozens of TMDB calls) never stalls a request after the first.
type Trending = { movies: any[]; series: any[] };
const TRENDING_FRESH_MS = 15 * 60 * 1000;
let trendingCache: { data: Trending; ts: number } | null = null;
let trendingInFlight: Promise<Trending> | null = null;

function refreshTrending(cookie: string): Promise<Trending> {
  if (trendingInFlight) return trendingInFlight; // coalesce concurrent rebuilds
  trendingInFlight = (async () => {
    try {
      const data = await computeTrending(cookie);
      if (data.movies.length + data.series.length > 0) {
        trendingCache = { data, ts: Date.now() };
      }
      return data;
    } finally {
      trendingInFlight = null;
    }
  })();
  return trendingInFlight;
}

async function getTrending(cookie: string): Promise<Trending> {
  if (trendingCache && Date.now() - trendingCache.ts < TRENDING_FRESH_MS) {
    return trendingCache.data; // fresh
  }
  if (trendingCache) {
    after(() => refreshTrending(cookie).catch(() => {})); // stale → SWR in background
    return trendingCache.data;
  }
  return refreshTrending(cookie); // cold — compute once for this process
}

export async function GET(request: NextRequest) {
  const service = request.nextUrl.searchParams.get("service");
  const trending = request.nextUrl.searchParams.get("trending");

  if (trending === "true") {
    const data = await getTrending(request.headers.get("cookie") || "");
    return NextResponse.json({ ...data, sorted_by: "tmdb_popularity_us_ca" });
  }

  if (service) {
    const url = `${BACKEND}/lounge/vod/catalog?service=${encodeURIComponent(service)}`;
    const res = await fetch(url, {
      headers: { Cookie: request.headers.get("cookie") || "" },
    });
    const data = await res.json();
    const normalized = {
      ...data,
      movies: normalizeItems(data.movies || []),
      series: normalizeItems(data.series || []),
    };

    // Enrich + rank this service's titles by US/CA popularity, then drop non-US/CA
    // titles so a service page is USA/Canada-only too (matches the home rails).
    const [movieRegion, seriesRegion] = await Promise.all([
      fetchRegionData("movie"),
      fetchRegionData("tv"),
    ]);
    applyRegionScores(normalized.movies || [], movieRegion.scores);
    applyRegionScores(normalized.series || [], seriesRegion.scores);
    // Keep ALL US/CA-English titles (not just the popularity allowlist): confirm
    // the long tail against TMDB by id. This is what lifts a service from ~67 to
    // the full set of its genuine US/CA English titles.
    [normalized.movies, normalized.series] = await Promise.all([
      filterUsCaEn(normalized.movies || [], "movie", movieRegion.allow),
      filterUsCaEn(normalized.series || [], "tv", seriesRegion.allow),
    ]);

    return NextResponse.json(normalized);
  }

  // Raw catalog with TMDB enrichment
  const url = `${BACKEND}/lounge/vod/catalog`;
  const res = await fetch(url, {
    headers: { Cookie: request.headers.get("cookie") || "" },
  });
  const data = await res.json();
  return NextResponse.json(data);
}