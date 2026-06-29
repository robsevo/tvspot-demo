"use client";

import { useState, useEffect, useMemo } from "react";
import { proxyFetch } from "@/lib/api";
import HeroBanner, { type HeroEvent } from "@/components/HeroBanner";
import PosterRail from "@/components/PosterRail";
import { PageSkeleton } from "@/components/LoadingSkeleton";
import { useEvents } from "@/hooks/useEvents";
import { useChannels } from "@/hooks/useChannels";
import { channelSlug } from "@/lib/sources";
import { carrierForLeague } from "@/lib/leagues";
import { curate, trendingScore, trendingNow, topRated, adultAnimation } from "@/lib/discovery";
import type { CatalogItem } from "@/lib/types";

/** Check whether a catalog item belongs to a genre by name or TMDB genre_id. */
function hasGenre(item: CatalogItem, name: string, id: number): boolean {
  if (item.genre_ids?.includes(id)) return true;
  if (item.genres?.includes(name)) return true;
  return false;
}

export default function HomePage() {
  const [movies, setMovies] = useState<CatalogItem[]>([]);
  const [series, setSeries] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { data: eventsData } = useEvents();
  const { channels } = useChannels();

  useEffect(() => {
    proxyFetch<{ movies: CatalogItem[]; series: CatalogItem[] }>(
      "/api/lounge/catalog?trending=true",
    )
      .then((data) => {
        // Curate: drop holiday/Christmas + non-English, sort by "watching now".
        setMovies(curate(data.movies || []));
        setSeries(curate(data.series || []));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      const carrier = carrierForLeague(lg.key, channels, channelSlug);
      return {
        id: g.id,
        leagueName: lg.name,
        leagueLogo: lg.logo,
        home: g.home,
        away: g.away,
        dateUtc: g.dateUtc,
        state: g.state,
        detail: g.detail,
        watchSlug: carrier ? channelSlug(carrier.name) : null,
        watchName: carrier ? carrier.name : null,
      };
    });
  }, [eventsData, channels]);

  // Trending = real US/CA current popularity first (movies/series already curated).
  const trendingMovies = useMemo(() => trendingNow(movies).slice(0, 18), [movies]);
  const trendingSeries = useMemo(() => trendingNow(series).slice(0, 18), [series]);

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
