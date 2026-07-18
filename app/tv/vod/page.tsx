"use client";

import { useMemo } from "react";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import { trendingNow } from "@/lib/discovery";
import TvRail from "@/components/tv/TvRail";
import TvPosterCard from "@/components/tv/TvPosterCard";
import type { CatalogItem } from "@/lib/types";

const PER_RAIL = 18;

/** Rails per streaming service, movies and series interleaved by popularity —
 *  the TV take on mobile's service picker, browsable with Left/Right only. */
export default function TvVodPage() {
  const { movies, series, loading } = useTrendingCatalog();

  const all = useMemo(
    () => [
      ...movies.map((m) => ({ ...m, kind: "movie" as const })),
      ...series.map((s) => ({ ...s, kind: "series" as const })),
    ],
    [movies, series],
  );

  const rails = useMemo(() => {
    const byService = new Map<string, Array<CatalogItem & { kind: "movie" | "series" }>>();
    for (const item of all) {
      const svc = item.service || "Other";
      const bucket = byService.get(svc) ?? [];
      bucket.push(item);
      byService.set(svc, bucket);
    }
    // Biggest catalogs first; items within a rail by current popularity.
    return Array.from(byService.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([svc, items]) => ({
        service: svc,
        items: trendingNow(items).slice(0, PER_RAIL) as Array<
          CatalogItem & { kind: "movie" | "series" }
        >,
      }))
      .filter((r) => r.items.length >= 3);
  }, [all]);

  return (
    <div className="pb-16">
      <h1 className="px-16 text-3xl font-bold text-white mb-2">Movies &amp; Shows</h1>

      {loading && all.length === 0 && (
        <p className="px-16 py-10 text-xl text-text-muted">Loading catalog…</p>
      )}

      {rails.map((rail) => (
        <TvRail key={rail.service} title={rail.service}>
          {rail.items.map((item) => (
            <TvPosterCard
              key={`${item.kind}-${item.tmdb_id}`}
              tmdbId={item.tmdb_id}
              title={item.title}
              poster={item.poster}
              kind={item.kind}
            />
          ))}
        </TvRail>
      ))}
    </div>
  );
}
