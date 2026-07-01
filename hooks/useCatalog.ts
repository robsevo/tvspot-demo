"use client";

import { useState, useEffect, useCallback } from "react";
import { proxyFetch } from "@/lib/api";
import { readCache, writeCache } from "@/lib/localCache";
import type { CatalogResponse, ServiceCatalogResponse, CatalogItem, CatalogSummaryEntry } from "@/lib/types";
import { curate } from "@/lib/discovery";

// Cache keys are versioned (_v2): bumping invalidates any stale/empty catalog
// a previous session cached during the dev churn, which would otherwise pin the
// VOD page to "no titles" until the tab is closed.
const CATALOG_CACHE_KEY = "tvspot_catalog_v2";
const SERVICE_CACHE_PREFIX = "tvspot_service_v2_";

/** Virtual services that aren't real backend providers */
const VIRTUAL_SERVICES = ["Classics", "Theater"] as const;

export function useCatalog() {
  const [services, setServices] = useState<string[]>([]);
  const [summary, setSummary] = useState<Record<string, CatalogSummaryEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCatalog = useCallback(async (background = false) => {
    try {
      if (!background) setLoading(true);
      setError(null);

      const data = await proxyFetch<CatalogResponse>("/api/lounge/vod/catalog");
      // Inject virtual services (guard against a malformed/empty backend response
      // so a bad payload can't throw and blank the whole picker).
      const realServices = Array.isArray(data.services) ? data.services : [];
      const allServices = [...realServices, ...VIRTUAL_SERVICES];
      const allSummary = {
        ...(data.summary || {}),
        "Classics": { movies_count: 30, series_count: 30, preview: "Classic movies and series before 2010" },
        "Theater": { movies_count: 30, series_count: 0, preview: "Now playing and upcoming in theaters" },
        // "Other" returns nothing from the backend (count 0) but useServiceCatalog
        // populates it from the trending corpus (~40 movies + 40 series). Override
        // the summary so the card's count matches what actually opens.
        ...(realServices.includes("Other") ? { "Other": { movies_count: 40, series_count: 40, preview: "Popular right now" } } : {}),
      };
      setServices(allServices);
      setSummary(allSummary);
      // Only cache a genuinely-populated catalog — caching an empty/failed
      // response would pin VOD to "no titles".
      if (realServices.length > 0) {
        writeCache(CATALOG_CACHE_KEY, { services: allServices, summary: allSummary });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Paint instantly from the last catalog (survives eviction), revalidate behind it.
    const cached = readCache<{ services: string[]; summary: Record<string, CatalogSummaryEntry> }>(CATALOG_CACHE_KEY);
    if (cached && cached.data.services?.length) {
      setServices(cached.data.services);
      setSummary(cached.data.summary);
      setLoading(false);
      fetchCatalog(true);
    } else {
      fetchCatalog(false);
    }
  }, [fetchCatalog]);

  return { services, summary, loading, error, refetch: () => fetchCatalog(false) };
}

export function useServiceCatalog(service: string | null) {
  const [movies, setMovies] = useState<CatalogItem[]>([]);
  const [series, setSeries] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<string>("");

  const fetchService = useCallback(async (background = false) => {
    if (!service) return;
    try {
      if (!background) {
        setLoading(true);
        setLabel("");
      }
      setError(null);

      const cacheKey = SERVICE_CACHE_PREFIX + service;

      if (service === "Classics") {
        const data = await proxyFetch<{ movies: any[]; series: any[] }>("/api/lounge/classics");
        const movies = curate((data.movies || []).map(normalizeItem));
        const series = curate((data.series || []).map(normalizeItem));
        setMovies(movies);
        setSeries(series);
        setLabel("Classic Movies & Series");
        if (movies.length + series.length > 0) {
          writeCache(cacheKey, { movies, series, label: "Classic Movies & Series" });
        }
        return;
      }

      if (service === "Theater") {
        const data = await proxyFetch<{ now_playing: any[]; upcoming: any[] }>("/api/lounge/theater");
        const all = curate([...(data.now_playing || []), ...(data.upcoming || [])].map(normalizeItem));
        setMovies(all);
        setSeries([]);
        setLabel("New & In Theaters");
        if (all.length > 0) {
          writeCache(cacheKey, { movies: all, series: [], label: "New & In Theaters" });
        }
        return;
      }

      if (service === "Other") {
        // Backend returns nothing for "Other" — populate it with a broad popular
        // mix from the merged trending corpus instead of an empty tab.
        const data = await proxyFetch<{ movies: CatalogItem[]; series: CatalogItem[] }>(
          "/api/lounge/catalog?trending=true"
        );
        const movies = curate(data.movies || []).slice(0, 40);
        const series = curate(data.series || []).slice(0, 40);
        setMovies(movies);
        setSeries(series);
        setLabel("Popular Right Now");
        if (movies.length + series.length > 0) {
          writeCache(cacheKey, { movies, series, label: "Popular Right Now" });
        }
        return;
      }

      // Regular service catalog
      const data = await proxyFetch<ServiceCatalogResponse>(
        `/api/lounge/catalog?service=${encodeURIComponent(service)}`
      );
      const svcMovies = curate(data.movies || []);
      const svcSeries = curate(data.series || []);
      setMovies(svcMovies);
      setSeries(svcSeries);
      setLabel(service);
      // Don't cache an empty result (a transient backend/auth hiccup) — it would
      // otherwise stick as "no titles".
      if (svcMovies.length + svcSeries.length > 0) {
        writeCache(cacheKey, { movies: svcMovies, series: svcSeries, label: service });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load service catalog");
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    if (!service) return;
    // Paint instantly from the cached service catalog, then revalidate behind it.
    const cached = readCache<{ movies: CatalogItem[]; series: CatalogItem[]; label: string }>(
      SERVICE_CACHE_PREFIX + service,
    );
    if (cached && (cached.data.movies?.length || cached.data.series?.length)) {
      setMovies(cached.data.movies);
      setSeries(cached.data.series);
      setLabel(cached.data.label || "");
      setLoading(false);
      fetchService(true);
    } else {
      fetchService(false);
    }
  }, [service, fetchService]);

  return { movies, series, loading, error, label, refetch: () => fetchService(false) };
}

function normalizeItem(item: any): CatalogItem {
  return {
    tmdb_id: item.tmdb_id || item.id,
    title: item.title || item.name || "",
    year: item.year || (item.release_date || "").slice(0, 4) || 0,
    rating: item.rating || item.vote_average || 0,
    poster: fixProxyImg(item.poster || item.poster_path || ""),
    backdrop: fixProxyImg(item.backdrop || item.backdrop_path || "", "w1280"),
    overview: item.overview || "",
    service: item.service || "",
    category: item.category || "movie",
    popularity: item.popularity || 0,
    vote_average: item.vote_average || item.rating || 0,
  };
}

function fixProxyImg(url: string, size: string = "w500"): string {
  if (!url) return "";
  if (url.startsWith("/api/images")) return url; // already proxied
  if (url.includes("image.tmdb.org")) return `/api/images?url=${encodeURIComponent(url)}`;
  if (url.includes("example.com")) return `/api/images?url=${encodeURIComponent(url)}`;
  if (url.startsWith("/")) return `/api/images?url=${encodeURIComponent(`https://image.tmdb.org/t/p/${size}${url}`)}`;
  return url;
}
