"use client";

import { useMemo } from "react";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import type { CatalogItem } from "@/lib/types";

/**
 * The catalog's copy of a title, for backfilling detail pages: the backend's
 * per-title details record is EMPTY (no title/art/streams) for many current
 * trending titles even though the catalog row is fully populated and the
 * vod-extract resolver can still find streams. Without this fallback those
 * pages rendered a nameless header while the resolver worked.
 */
export function useCatalogItem(
  kind: "movie" | "series",
  tmdbId: number | string,
): CatalogItem | null {
  const { movies, series } = useTrendingCatalog();
  const id = Number(tmdbId);
  return useMemo(
    () => (kind === "movie" ? movies : series).find((i) => i.tmdb_id === id) ?? null,
    [kind, id, movies, series],
  );
}
