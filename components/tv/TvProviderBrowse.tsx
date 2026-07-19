"use client";

import { useMemo } from "react";
import { useServiceCatalog } from "@/hooks/useCatalog";
import { trendingNow } from "@/lib/discovery";
import TvBrowseScreen, { type TvBrowseItem, type TvBrowseRail } from "@/components/tv/TvBrowseScreen";
import type { CatalogItem } from "@/lib/types";

const RAIL_MAX = 24;

/** Inside-a-provider browse: the same Prime hero+rails chassis as Home, seeded
 *  with one service's catalog (Featured, Movies, Series). Reached from the
 *  header's provider quick links and the VOD picker. */
export default function TvProviderBrowse({ service }: { service: string }) {
  const { movies, series, loading, label } = useServiceCatalog(service);

  const rails = useMemo<TvBrowseRail[]>(() => {
    const toItem = (it: CatalogItem, kind: "movie" | "series", badge?: string): TvBrowseItem => ({
      key: `${kind}-${it.tmdb_id}`,
      title: it.title,
      kind,
      tmdbId: it.tmdb_id,
      backdrop: it.backdrop,
      poster: it.poster,
      overview: it.overview,
      metaLine: [it.year, it.rating, kind === "movie" ? "Movie" : "Series"]
        .filter(Boolean)
        .join(" · "),
      badge,
      provider: it.service || label || service,
    });

    const featured = [
      ...trendingNow(movies).slice(0, 6).map((m) => toItem(m, "movie", "FEATURED")),
      ...trendingNow(series).slice(0, 6).map((s) => toItem(s, "series", "FEATURED")),
    ].slice(0, 12);

    return [
      { title: "Featured", items: featured },
      { title: "Movies", items: movies.slice(0, RAIL_MAX).map((m) => toItem(m, "movie")) },
      { title: "Series", items: series.slice(0, RAIL_MAX).map((s) => toItem(s, "series")) },
    ];
  }, [movies, series, label, service]);

  return (
    <TvBrowseScreen
      rails={rails}
      loading={loading && movies.length === 0 && series.length === 0}
      loadingText={`Loading ${label || service}…`}
    />
  );
}
