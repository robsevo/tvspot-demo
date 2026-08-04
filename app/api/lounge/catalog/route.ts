import { NextRequest, NextResponse, after } from "next/server";
import { ALWAYS_INCLUDE_MOVIE_PICKS } from "@/lib/classic-picks";

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

/**
 * Process-wide stale-while-revalidate memo.
 *
 * WHY THIS EXISTS: nothing this route computes depends on WHO is asking. The
 * TMDB region crawl, the per-title US/CA verdicts and the assembled per-service
 * payload are all identical for every user — yet the route is dynamic (it reads
 * searchParams + the cookie), so every single request used to rebuild all of it.
 * Measured on production before this change:
 *
 *     /api/lounge/catalog?service=Netflix   11.06s cold, 1.88s warm
 *     …the backend call inside it            0.16s
 *
 * The other ~11s was 603 TMDB round trips: 256 for the region crawl (~2.9s) and
 * ~347 per-title confirmations run in sequential batches of 24 (~10.3s). The
 * proof that the per-title pass is the bulk of it: Crunchyroll is in
 * ORIGIN_GATE_EXEMPT and therefore skips it entirely — it answered in 1.4s while
 * every other provider took 6.4-11.1s.
 *
 * `next: { revalidate }` on the individual fetches was not enough. It dedupes
 * the NETWORK, not the fan-out: a warm request still performs 603 cache lookups,
 * ~15 of them in a sequential chain, which is the residual 1.9s.
 *
 * Semantics: a fresh entry returns instantly; a stale one returns instantly AND
 * refreshes behind the response; a cold one waits for the build. Concurrent
 * misses coalesce onto one build so a cold burst can't stampede TMDB. `accept`
 * gates what's worth remembering — an empty result is a failed build, not a
 * legitimately empty catalog, and caching it would pin the UI to "no titles".
 */
function swrMemo<K, V>(freshMs: number, accept: (v: V) => boolean = () => true) {
  const cache = new Map<K, { data: V; ts: number }>();
  const inflight = new Map<K, Promise<V>>();

  function refresh(key: K, build: () => Promise<V>): Promise<V> {
    const running = inflight.get(key);
    if (running) return running;
    const p = (async () => {
      try {
        const data = await build();
        if (accept(data)) cache.set(key, { data, ts: Date.now() });
        return data;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  return async function get(key: K, build: () => Promise<V>): Promise<V> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < freshMs) return hit.data;
    if (hit) {
      // Stale — serve it now, refresh behind the response. after() keeps the
      // work alive past the response on Vercel instead of being frozen.
      //
      // Guarded because these memos nest (a service build asks for region data,
      // which may itself be stale) and after() throws when there is no request
      // scope to attach to. A background refresh failing to schedule must never
      // turn a cache HIT into a 500 — losing the refresh just means the next
      // request rebuilds instead.
      try {
        after(() => refresh(key, build).catch(() => {}));
      } catch {
        void refresh(key, build).catch(() => {});
      }
      return hit.data;
    }
    return refresh(key, build);
  };
}

/** Services whose content is foreign-origin BY DESIGN, so the US/CA-origin gate
 *  must not apply (it would drop nearly everything). Crunchyroll = anime. */
const ORIGIN_GATE_EXEMPT = new Set<string>(["Crunchyroll"]);

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

// Pages of TMDB US/CA popular titles to pull per region (≈20 titles/page). This
// is the US/CA allowlist AND the popularity-score source, so its depth directly
// bounds how many of the backend's ~5k-per-service titles survive the isUsCa
// gate and get a real "current" rank. 18 pages (~360/region) was dropping recent
// popular shows that sit just past it; 32 (~640/region, ~1280 US+CA) surfaces
// far more of them. Discover is cheap and this route response is cached.
const TMDB_PAGES = 32;

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
type RegionData = { scores: Map<number, number>; allow: Set<number> };

/** The region crawl is global — same answer for every service and every user —
 *  so it is built at most once an hour per process instead of 256 TMDB calls
 *  (~2.9s measured) on every request. A build that returns nothing (no token,
 *  TMDB down) is not cached, so we retry rather than pinning an empty allowlist
 *  that would gate every title out. */
const regionMemo = swrMemo<"movie" | "tv", RegionData>(
  60 * 60 * 1000,
  (r) => r.allow.size > 0,
);

function fetchRegionData(kind: "movie" | "tv"): Promise<RegionData> {
  return regionMemo(kind, () => buildRegionData(kind));
}

async function buildRegionData(kind: "movie" | "tv"): Promise<RegionData> {
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
  sort = "popularity.desc",
  voteFloor = 50,
): Promise<any[]> {
  const tmdbToken = process.env.TMDB_ACCESS_TOKEN;
  if (!tmdbToken) return [];
  const reqs: Promise<any>[] = [];
  for (let page = 1; page <= pages; page++) {
    // USA + Canada content ONLY: origin country US or CA, English-language.
    const url =
      `https://api.themoviedb.org/3/discover/${kind}` +
      `?language=en-US&watch_region=US&with_original_language=en&with_origin_country=US%7CCA` +
      `&sort_by=${sort}&vote_count.gte=${voteFloor}&page=${page}${extra}`;
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

  // A title's origin country and original language never change, so the verdict
  // is memoised for the life of the process — this is the single biggest win in
  // the route. Providers overlap heavily (the same title sits in several service
  // catalogs, and every service re-checks the same long tail), so after the
  // first build most lookups are answered without touching TMDB at all.
  const key = `${kind}:${id}`;
  const hit = titleUsCa.get(key);
  if (hit !== undefined) return hit;
  const running = titleUsCaInflight.get(key);
  if (running) return running; // two services asking at once → one request

  const p = (async () => {
    try {
      const r = await fetch(`https://api.themoviedb.org/3/${kind}/${id}?language=en-US`, {
        headers: { Authorization: `Bearer ${tmdbToken}` },
        next: { revalidate: 86400 },
      });
      // Only a real answer is worth remembering. A 429/5xx means "ask again",
      // and caching it as `false` would silently delete the title from every
      // catalog until this process recycled.
      if (!r.ok) return false;
      const d = await r.json();
      const countries: string[] = [
        ...(d.origin_country || []),
        ...((d.production_countries || []).map((c: any) => c.iso_3166_1)),
      ];
      const ok =
        d.original_language === "en" &&
        (countries.includes("US") || countries.includes("CA"));
      titleUsCa.set(key, ok);
      return ok;
    } catch {
      return false;
    } finally {
      titleUsCaInflight.delete(key);
    }
  })();
  titleUsCaInflight.set(key, p);
  return p;
}

/** Memoised per-title US/CA-English verdicts, keyed "movie:123" / "tv:456". */
const titleUsCa = new Map<string, boolean>();
const titleUsCaInflight = new Map<string, Promise<boolean>>();

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
  // 24 meant ~15 sequential round trips for a 400-title service — measured at
  // 10.3s, the bulk of the route's latency. This only ever runs on a genuinely
  // cold cache now (fetchTitleUsCaEn memoises per title), so a wider batch pays
  // once per process rather than once per request, and TMDB has no documented
  // request-rate cap to trip.
  const CONC = 64;
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
  // These come straight from TMDB's US/CA popularity ranking (clean, English,
  // bypass isUsCa by construction) and their detail pages resolve streams even
  // when no backend catalog carries them — so widening them is the most direct
  // way to surface more CURRENT popular titles. Two dedicated recency passes
  // (date-sorted, capped at today so unreleased future rows don't leak) catch
  // new hits that haven't yet climbed the all-time popularity board.
  const today = new Date().toISOString().slice(0, 10);
  const [supMovies, supSeries, supAnimation, recentMovies, recentSeries] = await Promise.all([
    fetchDiscover("movie", "", 12),
    fetchDiscover("tv", "", 15),
    fetchDiscover("tv", "&with_genres=16", 4), // animation (Family Guy, Rick & Morty, …)
    fetchDiscover("movie", `&primary_release_date.lte=${today}`, 4, "primary_release_date.desc", 40),
    fetchDiscover("tv", `&first_air_date.lte=${today}`, 5, "first_air_date.desc", 25),
  ]);
  for (const m of [...supMovies, ...recentMovies]) {
    if (!seenIds.has(m.tmdb_id)) { seenIds.add(m.tmdb_id); allMovies.push(m); }
  }
  for (const s of [...supSeries, ...supAnimation, ...recentSeries]) {
    if (!seenIds.has(s.tmdb_id)) { seenIds.add(s.tmdb_id); allSeries.push(s); }
  }
  // The recency passes are date-sorted, so their titles often lack an all-time
  // popularity score and would sink to the bottom. Remember them so we can float
  // them into a "recent" band below the evergreen top after scoring.
  const recentIds = new Set([...recentMovies, ...recentSeries].map((x) => x.tmdb_id));

  // Inject the global-megahit bypass titles (Squid Game, …) so they appear even
  // if no backend service catalog carries them. Deduped against the above.
  //
  // ALWAYS_INCLUDE_MOVIE_PICKS rides the same injection for a different reason:
  // not a language-gate bypass, but titles the panels DO carry which fall outside
  // every service's 200-title catalog slice, so nothing else would ever surface
  // them (see lib/classic-picks). fetchTmdbByIds tags them "Popular Movies",
  // which is also what carries them past isUsCa().
  const [bypassMovies, bypassSeries] = await Promise.all([
    fetchTmdbByIds("movie", [...BYPASS_MOVIE_IDS, ...ALWAYS_INCLUDE_MOVIE_PICKS]),
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

  // Float recent releases into a band just under the all-time top: a new hit
  // that hasn't climbed the popularity board yet still surfaces, without
  // displacing the evergreen leaders (~99k) or getting buried by them. Items
  // already scored above the band (a recent title that's ALSO a top hit) keep
  // their real rank. The client re-sorts by `popularity`, so setting the value
  // is enough. `n` preserves the date order within the band.
  const RECENT_BAND = 82000;
  const bandRecent = (items: any[]) => {
    let n = 0;
    for (const it of items) {
      if (recentIds.has(it.tmdb_id) && (Number(it.popularity) || 0) < RECENT_BAND) {
        it.popularity = RECENT_BAND - n++;
      }
    }
    items.sort((a, b) => (Number(b.popularity) || 0) - (Number(a.popularity) || 0));
  };
  bandRecent(allMovies);
  bandRecent(allSeries);

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

/** Build one provider's US/CA-ranked catalog. Same output as before; the caller
 *  is what changed — see serviceMemo. */
async function computeService(service: string, cookie: string): Promise<any> {
  const url = `${BACKEND}/lounge/vod/catalog?service=${encodeURIComponent(service)}`;
  const res = await fetch(url, { headers: { Cookie: cookie } });
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
  // The US/CA-origin gate drops everything not US/CA-origin — right for the
  // mainstream services (it removes the foreign dramas the backend mixes in),
  // but it would gut a foreign-BY-NATURE service. Crunchyroll is ~100%
  // Japanese-origin anime, so the gate left ~10 of ~500. Services in
  // ORIGIN_GATE_EXEMPT keep all their titles (still English-metadata'd by the
  // backend's language=en-US discover) and are only re-ranked by popularity.
  if (!ORIGIN_GATE_EXEMPT.has(service)) {
    // Keep ALL US/CA-English titles (not just the popularity allowlist):
    // confirm the long tail against TMDB by id. Lifts a service from ~67 to
    // the full set of its genuine US/CA English titles.
    [normalized.movies, normalized.series] = await Promise.all([
      filterUsCaEn(normalized.movies || [], "movie", movieRegion.allow),
      filterUsCaEn(normalized.series || [], "tv", seriesRegion.allow),
    ]);
  }

  return normalized;
}

/**
 * Assembled per-provider payload, memoised per process.
 *
 * 15 minutes matches the trending cache — the backend's own catalog is rebuilt
 * nightly, so a quarter hour is far inside the window in which this can change,
 * and the stale path refreshes behind the response anyway. An empty build is
 * rejected: that means the backend was mid-bounce, and caching it would show
 * "no titles" for the next 15 minutes.
 */
const serviceMemo = swrMemo<string, any>(
  15 * 60 * 1000,
  (d) => (d?.movies?.length || 0) + (d?.series?.length || 0) > 0,
);

export async function GET(request: NextRequest) {
  const service = request.nextUrl.searchParams.get("service");
  const trending = request.nextUrl.searchParams.get("trending");
  const cookie = request.headers.get("cookie") || "";

  if (trending === "true") {
    const data = await getTrending(cookie);
    return NextResponse.json({ ...data, sorted_by: "tmdb_popularity_us_ca" });
  }

  if (service) {
    const data = await serviceMemo(service, () => computeService(service, cookie));
    return NextResponse.json(data);
  }

  // Raw catalog with TMDB enrichment
  const url = `${BACKEND}/lounge/vod/catalog`;
  const res = await fetch(url, { headers: { Cookie: cookie } });
  const data = await res.json();
  return NextResponse.json(data);
}