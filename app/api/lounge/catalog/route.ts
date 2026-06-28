import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

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
 * Popularity scored by what's actually popular in the US + Canada, English-only.
 * Uses TMDB discover with watch_region=US and CA (sort by popularity), so titles
 * trending for US/CA viewers rank first site-wide. A title popular in either
 * region scores high (we take the max), and earlier ranks score higher. Titles
 * absent from US/CA results aren't in the map → the caller falls back to rating.
 * Responses are cached (revalidate) so this doesn't re-hit TMDB every request.
 */
async function fetchRegionPopularity(kind: "movie" | "tv"): Promise<Map<number, number>> {
  const tmdbToken = process.env.TMDB_ACCESS_TOKEN;
  if (!tmdbToken) return new Map();

  const scores = new Map<number, number>();
  const reqs: Promise<{ results?: { id: number }[] }>[] = [];
  for (const region of ["US", "CA"]) {
    for (let page = 1; page <= TMDB_PAGES; page++) {
      const url =
        `https://api.themoviedb.org/3/discover/${kind}` +
        `?language=en-US&watch_region=${region}&with_original_language=en` +
        `&sort_by=popularity.desc&vote_count.gte=50&page=${page}`;
      reqs.push(
        fetch(url, {
          headers: { Authorization: `Bearer ${tmdbToken}` },
          next: { revalidate: 3600 },
        })
          .then((r) => r.json())
          .catch(() => ({ results: [] })),
      );
    }
  }

  // US is weighted slightly above CA: a CA placement is penalized by ~half a page
  // of ranks, so US wins ties and a US-only title edges out a same-rank CA-only
  // title, while a strongly-popular CA title still beats a weak US one.
  const REGION_PENALTY: Record<string, number> = { US: 0, CA: 30 };

  try {
    const pages = await Promise.all(reqs);
    pages.forEach((pageData, idx) => {
      const region = idx < TMDB_PAGES ? "US" : "CA"; // first TMDB_PAGES reqs are US
      const pageNum = idx % TMDB_PAGES; // 0-based page within a region
      for (const [i, r] of (pageData.results || []).entries()) {
        const rank = pageNum * 20 + i; // global rank within region, 0 = most popular
        const score = 100000 - rank - REGION_PENALTY[region];
        scores.set(r.id, Math.max(scores.get(r.id) || 0, score));
      }
    });
  } catch {}

  return scores;
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

export async function GET(request: NextRequest) {
  const service = request.nextUrl.searchParams.get("service");
  const trending = request.nextUrl.searchParams.get("trending");

  if (trending === "true") {
    const services = ["Netflix", "Disney+", "HBO Max", "Prime Video", "Paramount+", "Apple TV+", "Hulu", "Crave", "Peacock"];
    const allMovies: any[] = [];
    const allSeries: any[] = [];
    const seenIds = new Set<number>();

    await Promise.all(
      services.map(async (svc) => {
        try {
          const res = await fetch(
            `${BACKEND}/lounge/vod/catalog?service=${encodeURIComponent(svc)}`,
            { headers: { Cookie: request.headers.get("cookie") || "" } }
          );
          if (!res.ok) return;
          const data = await res.json();
          for (const m of normalizeItems(data.movies || [])) {
            if (!seenIds.has(m.tmdb_id)) {
              seenIds.add(m.tmdb_id);
              allMovies.push(m);
            }
          }
          for (const s of normalizeItems(data.series || [])) {
            if (!seenIds.has(s.tmdb_id)) {
              seenIds.add(s.tmdb_id);
              allSeries.push(s);
            }
          }
        } catch {}
      })
    );

    // Enrich + rank by US/CA popularity (writes score onto item.popularity).
    const [movieScores, seriesScores] = await Promise.all([
      fetchRegionPopularity("movie"),
      fetchRegionPopularity("tv"),
    ]);
    applyRegionScores(allMovies, movieScores);
    applyRegionScores(allSeries, seriesScores);

    return NextResponse.json({ movies: allMovies, series: allSeries, sorted_by: "tmdb_popularity_us_ca" });
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

    // Enrich + rank this service's titles by US/CA popularity (writes score onto
    // item.popularity so the client keeps the region order).
    const [movieScores, seriesScores] = await Promise.all([
      fetchRegionPopularity("movie"),
      fetchRegionPopularity("tv"),
    ]);
    applyRegionScores(normalized.movies || [], movieScores);
    applyRegionScores(normalized.series || [], seriesScores);

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