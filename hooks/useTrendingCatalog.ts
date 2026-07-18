"use client";

import { useEffect, useMemo, useState } from "react";
import { proxyFetch } from "@/lib/api";
import { readCache, writeCache } from "@/lib/localCache";
import { curate } from "@/lib/discovery";
import type { CatalogItem } from "@/lib/types";

// Same cache key/shape as HomeClient + DailySplash, so the TV pages paint from
// (and keep warm) the exact rails the splash prewarms.
const TRENDING_CACHE_KEY = "tvspot_trending_v1";
const TRENDING_CACHE_MAX = 300;

/**
 * Client-fetched trending catalog with the shared localStorage fallback —
 * the TV shell's equivalent of HomeClient's cold-cache path (the /tv pages are
 * fully client-rendered, so there's no SSR catalog to inherit). Paints from the
 * last-known rails instantly, refetches behind them, and never lets a failed
 * refetch blank rails that already painted.
 */
export function useTrendingCatalog() {
  const [rawMovies, setRawMovies] = useState<CatalogItem[]>([]);
  const [rawSeries, setRawSeries] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = readCache<{ movies: CatalogItem[]; series: CatalogItem[] }>(
      TRENDING_CACHE_KEY,
    );
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
        if (movies.length > 0) {
          setRawMovies(movies);
          setRawSeries(series);
          writeCache(TRENDING_CACHE_KEY, {
            movies: movies.slice(0, TRENDING_CACHE_MAX),
            series: series.slice(0, TRENDING_CACHE_MAX),
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const movies = useMemo(() => curate(rawMovies), [rawMovies]);
  const series = useMemo(() => curate(rawSeries), [rawSeries]);

  return { movies, series, loading };
}
