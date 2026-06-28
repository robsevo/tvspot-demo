import { NextRequest, NextResponse } from "next/server";

const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN;
const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

const SCAN_SERVICES = ["Netflix", "HBO Max", "Prime Video", "Disney+", "Paramount+", "Apple TV+"];

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

/** Derive "new & notable" (2025+) from the backend catalog when no TMDB token. */
async function fromBackend(request: NextRequest) {
  const cookie = request.headers.get("cookie") || "";
  const recent: any[] = [];
  const seen = new Set<number>();

  await Promise.all(
    SCAN_SERVICES.map(async (svc) => {
      try {
        const res = await fetch(`${BACKEND}/lounge/vod/catalog?service=${encodeURIComponent(svc)}`, {
          headers: { Cookie: cookie },
        });
        if (!res.ok) return;
        const data = await res.json();
        for (const it of data.movies || []) {
          const year = parseInt((it.year || "").toString().slice(0, 4), 10);
          const id = it.tmdb_id || it.id;
          if (year && year >= 2025 && id && !seen.has(id)) {
            seen.add(id);
            recent.push({
              tmdb_id: id,
              title: it.title || it.name || "",
              year: it.year,
              rating: it.rating || it.vote_average || 0,
              vote_average: it.vote_average || Number(it.rating) || 0,
              poster: fixImageUrl(it.poster || it.poster_path),
              backdrop: fixImageUrl(it.backdrop || it.backdrop_path, "w1280"),
              overview: it.overview || "",
              service: "New Releases",
              category: "movie",
              popularity: it.popularity || 0,
            });
          }
        }
      } catch {}
    }),
  );

  recent.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  // Split the recent set into two rows the hook expects.
  return NextResponse.json({
    now_playing: recent.slice(0, 25),
    upcoming: recent.slice(25, 50),
    source: "backend",
  });
}

export async function GET(request: NextRequest) {
  if (!TMDB_TOKEN) {
    return fromBackend(request);
  }

  try {
    const [nowPlaying, upcoming] = await Promise.all([
      fetch("https://api.themoviedb.org/3/movie/now_playing?language=en-US&region=CA&page=1", {
        headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
      }).then((r) => r.json()),
      fetch("https://api.themoviedb.org/3/movie/upcoming?language=en-US&region=CA&page=1", {
        headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
      }).then((r) => r.json()),
    ]);

    const mapMovie = (m: any) => ({
      tmdb_id: m.id,
      title: m.title,
      year: (m.release_date || "").slice(0, 4),
      rating: m.vote_average,
      vote_average: m.vote_average,
      poster: m.poster_path ? `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/w500${m.poster_path}`)}` : "",
      backdrop: m.backdrop_path ? `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/w1280${m.backdrop_path}`)}` : "",
      overview: m.overview || "",
      service: "Theatrical",
      category: "movie",
      popularity: m.popularity,
    });

    return NextResponse.json({
      now_playing: (nowPlaying.results || []).slice(0, 30).map(mapMovie),
      upcoming: (upcoming.results || []).slice(0, 30).map(mapMovie),
      source: "tmdb",
    });
  } catch {
    return fromBackend(request);
  }
}
