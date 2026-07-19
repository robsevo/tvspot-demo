"use client";

import { useMemo } from "react";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import { trendingNow, topRated } from "@/lib/discovery";
import TvBrowseScreen, { type TvBrowseItem, type TvBrowseRail } from "@/components/tv/TvBrowseScreen";
import type { CatalogItem } from "@/lib/types";

/** Per-provider rails shown under Trending/Top rated (largest first). */
const SERVICE_RAILS = 4;
const RAIL_MAX = 18;

/** The Movies / TV Shows header tabs: one kind of the trending catalog as a
 *  Prime browse screen — Trending, Top rated, then a rail per provider. */
export default function TvCatalogTabPage({ kind }: { kind: "movie" | "series" }) {
  const { movies, series, loading } = useTrendingCatalog();
  const catalog = kind === "movie" ? movies : series;

  const rails = useMemo<TvBrowseRail[]>(() => {
    const toItem = (it: CatalogItem, badge?: string): TvBrowseItem => ({
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
      provider: it.service,
    });

    const byService = new Map<string, CatalogItem[]>();
    for (const it of catalog) {
      if (!it.service) continue;
      const list = byService.get(it.service) ?? [];
      list.push(it);
      byService.set(it.service, list);
    }
    const serviceRails = Array.from(byService.entries())
      .filter(([, list]) => list.length >= 6)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, SERVICE_RAILS)
      .map(
        ([svc, list]): TvBrowseRail => ({
          title: svc,
          items: list.slice(0, RAIL_MAX).map((it) => toItem(it)),
        }),
      );

    return [
      {
        title: kind === "movie" ? "Trending movies" : "Trending TV shows",
        items: trendingNow(catalog).slice(0, RAIL_MAX).map((it) => toItem(it, "TRENDING")),
      },
      {
        title: "Top rated",
        items: topRated(catalog)
          .slice(0, RAIL_MAX)
          .map((it, i) => toItem(it, i < 10 ? "TOP 10" : undefined)),
      },
      ...serviceRails,
    ];
  }, [catalog, kind]);

  return (
    <TvBrowseScreen
      rails={rails}
      loading={loading && catalog.length === 0}
      loadingText="Loading catalog…"
    />
  );
}
