"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Tv } from "lucide-react";
import { useChannels } from "@/hooks/useChannels";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import { trendingNow, topRated } from "@/lib/discovery";
import TvRail from "@/components/tv/TvRail";
import TvPosterCard from "@/components/tv/TvPosterCard";
import TvChannelCard from "@/components/tv/TvChannelCard";

const CHANNELS_ON_HOME = 12;

/** TV home: a live-channels rail on top (this is a TV first), then the same
 *  curated trending/top-rated rails the mobile home derives. */
export default function TvHomePage() {
  const { channels } = useChannels();
  const { movies, series, loading } = useTrendingCatalog();

  const homeChannels = useMemo(() => {
    const online = channels.filter((c) => c.online);
    return (online.length > 0 ? online : channels).slice(0, CHANNELS_ON_HOME);
  }, [channels]);

  const trendingMovies = useMemo(() => trendingNow(movies).slice(0, 18), [movies]);
  const trendingSeries = useMemo(() => trendingNow(series).slice(0, 18), [series]);
  const topRatedMovies = useMemo(() => topRated(movies).slice(0, 18), [movies]);
  const topRatedSeries = useMemo(() => topRated(series).slice(0, 18), [series]);

  return (
    <div className="pb-16">
      {homeChannels.length > 0 && (
        <TvRail title="Live TV">
          {homeChannels.map((c) => (
            <TvChannelCard key={c.name} channel={c} />
          ))}
          <Link
            href="/tv/live"
            data-tv
            className="w-52 h-28 shrink-0 rounded-xl bg-card ring-1 ring-white/5 flex flex-col items-center justify-center gap-2 text-text-secondary focus:outline-none"
          >
            <Tv className="w-8 h-8" />
            <span className="text-base font-medium">All channels</span>
          </Link>
        </TvRail>
      )}

      {trendingMovies.length > 0 && (
        <TvRail title="Trending Movies">
          {trendingMovies.map((m) => (
            <TvPosterCard key={m.tmdb_id} tmdbId={m.tmdb_id} title={m.title} poster={m.poster} kind="movie" />
          ))}
        </TvRail>
      )}

      {trendingSeries.length > 0 && (
        <TvRail title="Trending Series">
          {trendingSeries.map((s) => (
            <TvPosterCard key={s.tmdb_id} tmdbId={s.tmdb_id} title={s.title} poster={s.poster} kind="series" />
          ))}
        </TvRail>
      )}

      {topRatedMovies.length > 0 && (
        <TvRail title="Top Rated Movies">
          {topRatedMovies.map((m) => (
            <TvPosterCard key={m.tmdb_id} tmdbId={m.tmdb_id} title={m.title} poster={m.poster} kind="movie" />
          ))}
        </TvRail>
      )}

      {topRatedSeries.length > 0 && (
        <TvRail title="Top Rated Series">
          {topRatedSeries.map((s) => (
            <TvPosterCard key={s.tmdb_id} tmdbId={s.tmdb_id} title={s.title} poster={s.poster} kind="series" />
          ))}
        </TvRail>
      )}

      {loading && movies.length === 0 && (
        <p className="px-16 py-10 text-xl text-text-muted">Loading catalog…</p>
      )}
    </div>
  );
}
