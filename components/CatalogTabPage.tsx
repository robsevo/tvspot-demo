"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import PosterRail from "@/components/PosterRail";
import { PageSkeleton } from "@/components/LoadingSkeleton";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import { curate, trendingNow, topRated, hasGenre } from "@/lib/discovery";
import type { CatalogItem } from "@/lib/types";

/** Per-provider rails shown under Trending/Top rated (largest first) — same
 *  shape and caps as the TV's TvCatalogTabPage, so both clients present a
 *  provider's catalog the same way. */
const SERVICE_RAILS = 4;
const RAIL_MAX = 18;
/** Below this a provider rail looks broken rather than sparse. */
const MIN_FOR_RAIL = 6;

const MOVIE_GENRES = [
  { title: "Action", id: 28 },
  { title: "Comedy", id: 35 },
  { title: "Drama", id: 18 },
] as const;

/**
 * The Movies / TV Shows tabs for web+mobile, mirroring the TV's
 * TvCatalogTabPage: Trending, Top rated, then a rail per provider with a
 * "See all" into that provider's full catalog.
 *
 * This replaces "pick a provider before you can see anything" as the way into
 * VOD — the old /vod service picker is still reachable (and is where "See all"
 * lands), but browsing now starts with actual titles, as it does on the TV.
 */
export default function CatalogTabPage({ kind }: { kind: "movie" | "series" }) {
  const router = useRouter();
  const { movies, series, loading } = useTrendingCatalog();

  // Same curation as the home rails: current US/CA popularity, English,
  // no holiday filler.
  const catalog = useMemo(
    () => curate(kind === "movie" ? movies : series),
    [kind, movies, series],
  );

  const trending = useMemo(() => trendingNow(catalog).slice(0, RAIL_MAX), [catalog]);
  const rated = useMemo(() => topRated(catalog).slice(0, RAIL_MAX), [catalog]);

  const serviceRails = useMemo(() => {
    const byService = new Map<string, CatalogItem[]>();
    for (const it of catalog) {
      if (!it.service) continue;
      const list = byService.get(it.service) ?? [];
      list.push(it);
      byService.set(it.service, list);
    }
    return Array.from(byService.entries())
      .filter(([, list]) => list.length >= MIN_FOR_RAIL)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, SERVICE_RAILS)
      .map(([svc, list]) => ({ svc, items: list.slice(0, RAIL_MAX) }));
  }, [catalog]);

  const genreRails = useMemo(
    () =>
      kind === "movie"
        ? MOVIE_GENRES.map(({ title, id }) => ({
            title,
            items: catalog.filter((m) => hasGenre(m, title, id)).slice(0, RAIL_MAX),
          })).filter((r) => r.items.length >= 3)
        : [],
    [kind, catalog],
  );

  if (loading && catalog.length === 0) return <PageSkeleton />;

  const label = kind === "movie" ? "Movies" : "TV Shows";

  return (
    <div className="hud-grid-bg pt-14 min-h-screen pb-20 animate-page-rise">
      <h1 className="text-white text-lg font-bold px-4 mb-3">{label}</h1>

      <PosterRail
        title={kind === "movie" ? "Trending Movies" : "Trending TV Shows"}
        items={trending}
        kind={kind}
      />
      <PosterRail title="Top Rated" items={rated} kind={kind} />

      {serviceRails.map(({ svc, items }) => (
        <PosterRail
          key={svc}
          title={svc}
          items={items}
          kind={kind}
          // A provider rail maps exactly onto that provider's full catalog,
          // which is what the existing /vod browser already renders.
          onSeeAll={() => router.push(`/vod?service=${encodeURIComponent(svc)}`)}
        />
      ))}

      {genreRails.map(({ title, items }) => (
        <PosterRail key={title} title={title} items={items} kind={kind} />
      ))}
    </div>
  );
}
