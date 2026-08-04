"use client";

import { useState, useMemo } from "react";
import PosterCard from "./PosterCard";
import { ChevronLeft, Search, X, ArrowDownWideNarrow } from "lucide-react";
import type { CatalogItem } from "@/lib/types";

/** Case/diacritic-insensitive normalize for title search. */
function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

type SortKey = "popular" | "rating" | "year" | "az";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "popular", label: "Popular" },
  { key: "rating", label: "Rating" },
  { key: "year", label: "Newest" },
  { key: "az", label: "A–Z" },
];

interface Props {
  items: CatalogItem[];
  kind: "movie" | "series";
  /** Provider label, e.g. "Netflix". */
  serviceLabel: string;
  onBack: () => void;
}

/**
 * Full provider catalog for one kind (movies OR series), with title search and
 * sort. Opened from the VOD service view's "See all" button. The incoming items
 * are already curated (popularity order), so "Popular" keeps that order.
 */
export default function CatalogBrowser({ items, kind, serviceLabel, onBack }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("popular");

  const shown = useMemo(() => {
    const q = norm(query.trim());
    const filtered = q ? items.filter((it) => norm(it.title).includes(q)) : items;
    // "popular" preserves the incoming curated order; others sort a copy.
    if (sort === "popular") return filtered;
    const arr = [...filtered];
    if (sort === "rating") {
      arr.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    } else if (sort === "year") {
      arr.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
    } else if (sort === "az") {
      arr.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    }
    return arr;
  }, [items, query, sort]);

  const kindLabel = kind === "movie" ? "Movies" : "Series";

  return (
    <div className="animate-fade-in">
      {/* Header: back + title + count */}
      <div className="px-4 mb-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-xl glass-card flex items-center justify-center transition-colors flex-shrink-0"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5 text-white" />
        </button>
        <div className="min-w-0">
          <h1 className="text-white text-lg font-bold truncate">
            {serviceLabel} {kindLabel}
          </h1>
          <p className="text-text-muted text-[11px]">{shown.length} titles</p>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 mb-3">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${serviceLabel} ${kindLabel.toLowerCase()}...`}
            autoComplete="off"
            className="w-full glass-card rounded-xl pl-10 pr-10 py-2.5 text-white text-sm placeholder-text-muted outline-none focus:ring-1 focus:ring-brand focus:shadow-[0_0_18px_rgba(37,99,235,0.35)] transition-all"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="w-4 h-4 text-text-muted hover:text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Sort pills */}
      <div className="flex items-center gap-2 overflow-x-auto px-4 mb-4 poster-rail">
        <span className="flex items-center gap-1 text-text-muted text-[11px] flex-shrink-0 pr-1">
          <ArrowDownWideNarrow className="w-3.5 h-3.5" />
          Sort
        </span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
              sort === s.key
                ? "bg-brand text-white hud-glow"
                : "glass-card text-text-secondary hover:text-white"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {shown.length === 0 ? (
        <div className="px-4 pt-8 text-center">
          <p className="text-text-secondary text-sm">
            No {kindLabel.toLowerCase()} match &ldquo;{query.trim()}&rdquo;
          </p>
        </div>
      ) : (
        /* One column fewer at every breakpoint than this grid used to carry.
           At 3-up a 375px phone gave (375 − 32 padding − 24 gaps) / 3 = 106px
           of poster, small enough that titles on the art were unreadable; 2-up
           is 165px. Same card, same 2:3 crop, same treatment — only the column
           count moved. */
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 px-4">
          {shown.map((item) => (
            <PosterCard
              key={`${item.tmdb_id}-${kind}`}
              tmdbId={item.tmdb_id}
              title={item.title}
              poster={item.poster}
              kind={kind}
              service={item.service}
              rating={item.vote_average || (item.rating ? Number(item.rating) : undefined)}
              year={item.year || undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
