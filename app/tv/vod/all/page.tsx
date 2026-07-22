"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useServiceCatalog } from "@/hooks/useCatalog";
import { useTvBack } from "@/components/tv/TvNav";
import TvLandscapeCard from "@/components/tv/TvLandscapeCard";

/** Cards painted on the first frame, then how many to add per step and how long
 *  to leave the renderer alone between steps. Same reasoning as the browse
 *  chassis's staggered rails: a grid of a few hundred cards built in one go is
 *  exactly the concurrent layout+decode burst that takes the 2019 Samsung's
 *  renderer down. Everything still arrives, just not in one blocking chunk. */
const GRID_FIRST_PAINT = 16;
const GRID_PER_STEP = 16;
const GRID_STEP_MS = 350;
/** Hard ceiling on a single grid — a provider can carry many hundreds of
 *  titles, and decoded image memory is the binding constraint on the TV. */
const GRID_MAX = 120;

function TvVodAllInner() {
  const router = useRouter();
  const params = useSearchParams();
  const service = params.get("service");
  const kind = params.get("kind") === "series" ? "series" : "movie";
  const { movies, series, loading, label } = useServiceCatalog(service);

  const items = useMemo(
    () => (kind === "movie" ? movies : series).slice(0, GRID_MAX),
    [kind, movies, series],
  );

  const [budget, setBudget] = useState(GRID_FIRST_PAINT);
  useEffect(() => {
    if (budget >= items.length) return;
    const t = setTimeout(() => setBudget((n) => n + GRID_PER_STEP), GRID_STEP_MS);
    return () => clearTimeout(t);
  }, [budget, items.length]);

  // Back returns to the provider's browse screen, not the whole way out.
  const back = useCallback(() => {
    router.push(service ? `/tv/vod?service=${encodeURIComponent(service)}` : "/tv/vod");
  }, [router, service]);
  useTvBack(back);

  const heading = `${label || service || "Catalog"} · ${kind === "movie" ? "Movies" : "Series"}`;

  return (
    <div className="px-16 pb-16">
      <h1 className="text-4xl font-bold text-white pt-2 mb-2">{heading}</h1>
      <p className="text-lg text-[#8197a4] mb-8">
        {items.length > 0 ? `${items.length} titles` : ""}
      </p>

      {items.length === 0 ? (
        <p className="py-6 text-xl text-[#8197a4]">
          {loading ? "Loading catalog…" : "No titles in this category."}
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-6">
          {items.slice(0, budget).map((item, i) => (
            <TvLandscapeCard
              key={`${kind}-${item.tmdb_id}`}
              tmdbId={item.tmdb_id}
              title={item.title}
              backdrop={item.backdrop}
              poster={item.poster}
              kind={kind}
              provider={item.service}
              showTitle
              fluid
              tvAutoFocus={i === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Full-grid view of one provider's movies or series — the target of a rail's
 *  "See all", mirroring the website's per-rail See-all → full catalog grid. */
export default function TvVodAllPage() {
  return (
    <Suspense fallback={<p className="px-16 py-10 text-xl text-[#8197a4]">Loading…</p>}>
      <TvVodAllInner />
    </Suspense>
  );
}
