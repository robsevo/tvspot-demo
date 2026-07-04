"use client";

import { useEffect, useMemo, useState } from "react";
import { proxyFetch } from "@/lib/api";
import HeroBanner, { type HeroEvent } from "@/components/HeroBanner";
import PosterRail from "@/components/PosterRail";
import { PageSkeleton } from "@/components/LoadingSkeleton";
import { useEvents } from "@/hooks/useEvents";
import { useChannels } from "@/hooks/useChannels";
import { channelSlug } from "@/lib/sources";
import { broadcastersForLeague } from "@/lib/leagues";
import { curate, trendingScore, trendingNow, topRated, adultAnimation } from "@/lib/discovery";
import { prewarmVod } from "@/lib/vodPrewarm";
import { readCache, writeCache } from "@/lib/localCache";
import type { CatalogItem } from "@/lib/types";

// Last-known trending rails. The home page was the ONE screen without a
// localStorage fallback: when the SSR catalog fetch bails (cold lambda /
// slow backend — ~20s+ rebuild vs its 5s abort) the client refetch used to
// leave the whole page on <PageSkeleton /> until that slow call returned.
// On mobile every eviction/deploy re-entry reloads the app, so users saw
// "nothing but a skeleton" for the whole refetch. Cap what we store so the
// write stays well inside mobile localStorage quota (rails only show ~20
// items each; 300 keeps every derived row populated).
const TRENDING_CACHE_KEY = "tvspot_trending_v1";
const TRENDING_CACHE_MAX = 300;
const cacheTrending = (movies: CatalogItem[], series: CatalogItem[]) =>
  writeCache(TRENDING_CACHE_KEY, {
    movies: movies.slice(0, TRENDING_CACHE_MAX),
    series: series.slice(0, TRENDING_CACHE_MAX),
  });

/** Check whether a catalog item belongs to a genre by name or TMDB genre_id. */
function hasGenre(item: CatalogItem, name: string, id: number): boolean {
  if (item.genre_ids?.includes(id)) return true;
  if (item.genres?.includes(name)) return true;
  return false;
}

/**
 * Interactive Home. The catalog is fetched on the SERVER (see page.tsx) and passed
 * in as initial props, so the rails render straight from the streamed HTML — no
 * client /api/lounge/catalog round-trip. Events/channels stay client-side (small,
 * cached) to power the hero's live-game "Watch" links.
 */
export default function HomeClient({
  initialMovies,
  initialSeries,
}: {
  initialMovies: CatalogItem[];
  initialSeries: CatalogItem[];
}) {
  const [rawMovies, setRawMovies] = useState<CatalogItem[]>(initialMovies);
  const [rawSeries, setRawSeries] = useState<CatalogItem[]>(initialSeries);
  // Only "loading" when the server gave us nothing (cold-cache fallback below).
  const [loading, setLoading] = useState(initialMovies.length === 0);

  // Cold-cache fallback: if the server's short-timeout catalog fetch bailed (the
  // endpoint is ~20s+ cold), paint instantly from the last-known rails (survives
  // eviction) and refetch client-side behind them. On the warm path the server
  // already provided the rails — just keep the reload cache fresh.
  useEffect(() => {
    if (initialMovies.length > 0) {
      cacheTrending(initialMovies, initialSeries);
      return;
    }
    const cached = readCache<{ movies: CatalogItem[]; series: CatalogItem[] }>(TRENDING_CACHE_KEY);
    if (cached && (cached.data.movies?.length ?? 0) > 0) {
      setRawMovies(cached.data.movies);
      setRawSeries(cached.data.series || []);
      setLoading(false);
    }
    let cancelled = false;
    proxyFetch<{ movies: CatalogItem[]; series: CatalogItem[] }>(
      "/api/lounge/catalog?trending=true",
    )
      .then((data) => {
        if (cancelled) return;
        const movies = data.movies || [];
        const series = data.series || [];
        // A failed/empty refetch must not blank rails painted from the cache.
        if (movies.length > 0) {
          setRawMovies(movies);
          setRawSeries(series);
          cacheTrending(movies, series);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialMovies, initialSeries]);

  // Curate (drop holiday/non-English, sort by "watching now") — was applied in the
  // old client fetch handler; keep it here so ordering/filtering is unchanged.
  const movies = useMemo(() => curate(rawMovies || []), [rawMovies]);
  const series = useMemo(() => curate(rawSeries || []), [rawSeries]);

  const { data: eventsData } = useEvents();
  const { channels } = useChannels();

  // ── derived rows ──────────────────────────────────────────────────────

  // Hero: best-of mix (movies + series) with a usable backdrop, most-trending first.
  const heroItems = useMemo(
    () =>
      [
        ...movies.map((m) => ({ ...m, category: "movie" as const })),
        ...series.map((s) => ({ ...s, category: "series" as const })),
      ]
        .filter((it) => it.backdrop)
        .sort((a, b) => trendingScore(b) - trendingScore(a))
        .slice(0, 8),
    [movies, series],
  );

  // Hero events: up to 2 of today's games, live first then soonest upcoming, each
  // cross-referenced to one of our channels for a direct "Watch" link.
  const heroEvents: HeroEvent[] = useMemo(() => {
    const all = (eventsData?.leagues || []).flatMap((lg) => lg.games.map((g) => ({ lg, g })));
    const rank = (s: string) => (s === "in" ? 0 : s === "pre" ? 1 : 2);
    all.sort(
      (a, b) =>
        rank(a.g.state) - rank(b.g.state) ||
        new Date(a.g.dateUtc).getTime() - new Date(b.g.dateUtc).getTime(),
    );
    return all.slice(0, 2).map(({ lg, g }) => {
      // All OUR channels carrying this league (brand-deduped, online first), so
      // the hero surfaces every channel that features the game, not just one.
      const carriers = broadcastersForLeague(lg.key, channels, channelSlug, 4);
      return {
        id: g.id,
        leagueName: lg.name,
        leagueLogo: lg.logo,
        home: g.home,
        away: g.away,
        dateUtc: g.dateUtc,
        state: g.state,
        detail: g.detail,
        carriers: carriers.map((c) => ({ slug: channelSlug(c.name), name: c.name })),
      };
    });
  }, [eventsData, channels]);

  // Trending = real US/CA current popularity first (movies/series already curated).
  const trendingMovies = useMemo(() => trendingNow(movies).slice(0, 18), [movies]);
  const trendingSeries = useMemo(() => trendingNow(series).slice(0, 18), [series]);

  // Prewarm the clean-stream resolve for the top few trending titles so the first
  // tap is instant. Bounded (top 4 each) + throttled + 30min-deduped in vodPrewarm,
  // so it can't fan out into sustained background load on the 2GB box.
  useEffect(() => {
    trendingMovies.slice(0, 4).forEach((m) => prewarmVod("movie", m.tmdb_id));
    trendingSeries.slice(0, 4).forEach((s) => prewarmVod("series", s.tmdb_id));
  }, [trendingMovies, trendingSeries]);

  // Top Rated = acclaimed AND recent (not 40-year-old classics).
  const topRatedMovies = useMemo(() => topRated(movies).slice(0, 18), [movies]);
  const topRatedSeries = useMemo(() => topRated(series).slice(0, 18), [series]);

  // Adult animation (Family Guy, American Dad, Rick and Morty, …) — matched by a
  // curated title set since the catalog has no maturity sub-genre. These are all
  // series, so the row routes as series.
  const adultCartoons = useMemo(() => adultAnimation(series).slice(0, 18), [series]);

  const actionMovies = useMemo(
    () => movies.filter((m) => hasGenre(m, "Action", 28)).slice(0, 18),
    [movies],
  );
  const comedyMovies = useMemo(
    () => movies.filter((m) => hasGenre(m, "Comedy", 35)).slice(0, 18),
    [movies],
  );
  const dramaMovies = useMemo(
    () => movies.filter((m) => hasGenre(m, "Drama", 18)).slice(0, 18),
    [movies],
  );

  // ── render ────────────────────────────────────────────────────────────

  if (loading) return <PageSkeleton />;

  return (
    <div className="hud-grid-bg min-h-screen pb-4 animate-page-rise">
      <HeroBanner items={heroItems} events={heroEvents} />

      {trendingMovies.length > 0 && (
        <PosterRail title="Trending Movies" items={trendingMovies} kind="movie" />
      )}
      {trendingSeries.length > 0 && (
        <PosterRail title="Trending Series" items={trendingSeries} kind="series" />
      )}

      {adultCartoons.length > 0 && (
        <PosterRail title="Adult Animation" items={adultCartoons} kind="series" />
      )}

      {topRatedMovies.length > 0 && (
        <PosterRail title="Top Rated Movies" items={topRatedMovies} kind="movie" />
      )}
      {topRatedSeries.length > 0 && (
        <PosterRail title="Top Rated Series" items={topRatedSeries} kind="series" />
      )}

      {actionMovies.length >= 3 && (
        <PosterRail title="Action" items={actionMovies} kind="movie" />
      )}
      {comedyMovies.length >= 3 && (
        <PosterRail title="Comedy" items={comedyMovies} kind="movie" />
      )}
      {dramaMovies.length >= 3 && (
        <PosterRail title="Drama" items={dramaMovies} kind="movie" />
      )}
    </div>
  );
}
