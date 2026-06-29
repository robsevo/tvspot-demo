"use client";

import { ReactNode, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import PosterCard from "./PosterCard";
import type { CatalogItem } from "@/lib/types";

interface Props {
  title: string;
  items: CatalogItem[];
  kind: "movie" | "series";
  children?: ReactNode;
  /** When set, render a "See all" button in the header that opens the full grid. */
  onSeeAll?: () => void;
}

export default function PosterRail({ title, items, kind, children, onSeeAll }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) return null;

  const scrollByAmount = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    // Scroll ~85% of the visible width so a couple of cards stay for context.
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section className="mb-6 group/rail">
      <div className="flex items-center gap-2 px-4 mb-2">
        <span className="inline-block w-1 h-4 rounded-full bg-brand hud-glow" />
        <h2 className="text-white text-[15px] font-bold tracking-tight uppercase">{title}</h2>
        {onSeeAll && (
          <button
            onClick={onSeeAll}
            className="ml-auto flex items-center gap-0.5 text-text-secondary hover:text-white text-xs font-medium transition-colors min-h-[32px]"
          >
            See all
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
      {children}
      <div className="relative">
        {/* Left arrow */}
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollByAmount(-1)}
          className="flex absolute left-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/55 hover:bg-black/80 items-center justify-center text-white md:opacity-0 md:group-hover/rail:opacity-100 transition-opacity backdrop-blur-sm shadow-lg"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div
          ref={scrollRef}
          className="poster-rail flex gap-2.5 overflow-x-auto px-4 pb-1"
        >
          {items.map((item, i) => (
            <div
              key={`${item.tmdb_id}-${kind}`}
              className="animate-fade-in-up flex-shrink-0 w-[40vw] sm:w-[180px] md:w-[200px] lg:w-[220px]"
              style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}
            >
              <PosterCard
                tmdbId={item.tmdb_id}
                title={item.title}
                poster={item.poster}
                kind={kind}
                service={item.service}
                rating={item.vote_average || (item.rating ? Number(item.rating) : undefined)}
                year={item.year || undefined}
              />
            </div>
          ))}
        </div>

        {/* Right arrow */}
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollByAmount(1)}
          className="flex absolute right-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/55 hover:bg-black/80 items-center justify-center text-white md:opacity-0 md:group-hover/rail:opacity-100 transition-opacity backdrop-blur-sm shadow-lg"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </section>
  );
}
