"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useTrendingCatalog } from "@/hooks/useTrendingCatalog";
import TvLandscapeCard from "@/components/tv/TvLandscapeCard";
import type { CatalogItem } from "@/lib/types";

const MAX = 32;

/** Global search across the trending corpus (movies + series). The box holds
 *  focus on entry so the on-screen keyboard is live immediately; results fill
 *  a fluid grid below. */
export default function TvSearchPage() {
  const { movies, series, loading } = useTrendingCatalog();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const match = (i: CatalogItem) => (i.title || "").toLowerCase().includes(q);
    return [
      ...movies.filter(match).map((m) => ({ ...m, kind: "movie" as const })),
      ...series.filter(match).map((s) => ({ ...s, kind: "series" as const })),
    ].slice(0, MAX);
  }, [query, movies, series]);

  return (
    <div className="px-16 pb-16">
      <h1 className="text-4xl font-bold text-white pt-2 mb-6">Search</h1>

      <input
        ref={inputRef}
        data-tv
        data-tv-autofocus
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search movies and shows…"
        className="w-[46rem] max-w-full bg-[#141d28] ring-1 ring-white/10 rounded-lg px-6 py-4 text-2xl text-white placeholder-[#5f7180] focus:outline-none focus:ring-white mb-8"
      />

      {query.trim() === "" ? (
        <p className="py-6 text-xl text-[#8197a4]">
          {loading ? "Loading catalog…" : "Type to search across movies and shows."}
        </p>
      ) : results.length === 0 ? (
        <p className="py-6 text-xl text-[#8197a4]">No titles match “{query}”.</p>
      ) : (
        <div className="grid grid-cols-4 gap-6">
          {results.map((item) => (
            <TvLandscapeCard
              key={`${item.kind}-${item.tmdb_id}`}
              tmdbId={item.tmdb_id}
              title={item.title}
              backdrop={item.backdrop}
              poster={item.poster}
              kind={item.kind}
              provider={item.service}
              fluid
            />
          ))}
        </div>
      )}
    </div>
  );
}
