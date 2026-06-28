import { NextRequest, NextResponse } from "next/server";

const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN;
const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

// Services to scan when deriving classics from the backend catalog (no token).
const SCAN_SERVICES = ["Netflix", "HBO Max", "Prime Video", "Disney+", "Paramount+"];

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

/** Derive classics (pre-2010) from the backend catalog when no TMDB token. */
async function fromBackend(request: NextRequest) {
  const cookie = request.headers.get("cookie") || "";
  const movies: any[] = [];
  const series: any[] = [];
  const seen = new Set<number>();

  await Promise.all(
    SCAN_SERVICES.map(async (svc) => {
      try {
        const res = await fetch(`${BACKEND}/lounge/vod/catalog?service=${encodeURIComponent(svc)}`, {
          headers: { Cookie: cookie },
        });
        if (!res.ok) return;
        const data = await res.json();
        const take = (arr: any[], kind: "movie" | "series", bucket: any[]) => {
          for (const it of arr || []) {
            const year = parseInt((it.year || "").toString().slice(0, 4), 10);
            const id = it.tmdb_id || it.id;
            if (year && year <= 2009 && id && !seen.has(id)) {
              seen.add(id);
              bucket.push({
                tmdb_id: id,
                title: it.title || it.name || "",
                year: it.year,
                rating: it.rating || it.vote_average || 0,
                vote_average: it.vote_average || Number(it.rating) || 0,
                poster: fixImageUrl(it.poster || it.poster_path),
                backdrop: fixImageUrl(it.backdrop || it.backdrop_path, "w1280"),
                overview: it.overview || "",
                service: kind === "movie" ? "Classic Movies" : "Classic Series",
                category: kind,
                popularity: it.popularity || 0,
              });
            }
          }
        };
        take(data.movies, "movie", movies);
        take(data.series, "series", series);
      } catch {}
    }),
  );

  const byRating = (a: any, b: any) => (b.vote_average || 0) - (a.vote_average || 0);
  return NextResponse.json({
    movies: movies.sort(byRating).slice(0, 40),
    series: series.sort(byRating).slice(0, 40),
    source: "backend",
  });
}

export async function GET(request: NextRequest) {
  if (!TMDB_TOKEN) {
    // No token → derive real classics from the backend catalog instead of 404ing.
    return fromBackend(request);
  }

  try {
    const [classicMovies, classicTv] = await Promise.all([
      fetch(
        "https://api.themoviedb.org/3/discover/movie?language=en-US&with_original_language=en&sort_by=vote_count.desc&vote_count.gte=2000&release_date.lte=2009-12-31&page=1",
        { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } },
      ).then((r) => r.json()).catch(() => ({ results: [] })),
      fetch(
        "https://api.themoviedb.org/3/discover/tv?language=en-US&with_original_language=en&sort_by=vote_count.desc&vote_count.gte=500&first_air_date.lte=2009-12-31&page=1",
        { headers: { Authorization: `Bearer ${TMDB_TOKEN}` } },
      ).then((r) => r.json()).catch(() => ({ results: [] })),
    ]);

    const mapItem = (m: any, kind: "movie" | "series") => ({
      tmdb_id: m.id,
      title: m.title || m.name,
      year: (m.release_date || m.first_air_date || "").slice(0, 4),
      rating: m.vote_average,
      vote_average: m.vote_average,
      poster: m.poster_path ? `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/w500${m.poster_path}`)}` : "",
      backdrop: m.backdrop_path ? `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/w1280${m.backdrop_path}`)}` : "",
      overview: m.overview || "",
      service: kind === "movie" ? "Classic Movies" : "Classic Series",
      category: kind,
      popularity: m.popularity,
    });

    return NextResponse.json({
      movies: (classicMovies.results || []).slice(0, 30).map((m: any) => mapItem(m, "movie")),
      series: (classicTv.results || []).slice(0, 30).map((s: any) => mapItem(s, "series")),
      source: "tmdb",
    });
  } catch {
    return fromBackend(request);
  }
}
