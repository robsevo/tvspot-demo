"use client";

import { useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import PosterCard from "./PosterCard";
import { useContinueWatching } from "@/hooks/useContinueWatching";

/** Same window the TV home uses: started, but not effectively finished. */
const MIN_PROGRESS = 2;
const MAX_PROGRESS = 95;
const MAX_ITEMS = 12;

/**
 * "Continue watching" for the web/mobile home — the rail the TV home has led
 * with and this one was missing entirely (it existed only on My List, a tab
 * away from where you actually resume).
 *
 * Deliberately its own component rather than a PosterRail: that takes a single
 * `kind` and a CatalogItem[], and continue-watching rows are mixed movies and
 * series carrying a season/episode and a progress value. Each tile deep-links to
 * the exact episode with ?s=&e= so it resumes where the viewer left off instead
 * of reopening the show at S1E1 — matching the TV tile.
 *
 * Renders nothing when there is nothing in progress, so the home page is
 * unchanged for a fresh install.
 */
export default function ContinueWatchingRail() {
  const { items } = useContinueWatching();
  const scrollRef = useRef<HTMLDivElement>(null);

  const resumable = useMemo(
    () =>
      items
        .filter((i) => i.progress > MIN_PROGRESS && i.progress < MAX_PROGRESS)
        .slice(0, MAX_ITEMS),
    [items],
  );

  if (resumable.length === 0) return null;

  const scrollByAmount = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section className="mb-6 group/rail">
      <div className="flex items-center gap-2 px-4 mb-2">
        <span className="inline-block w-1 h-4 rounded-full bg-brand hud-glow" />
        <h2 className="text-white text-[15px] font-bold tracking-tight uppercase">
          Continue Watching
        </h2>
      </div>

      <div className="relative">
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollByAmount(-1)}
          className="flex absolute left-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/55 hover:bg-black/80 items-center justify-center text-white md:opacity-0 md:group-hover/rail:opacity-100 transition-opacity backdrop-blur-sm shadow-lg"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div ref={scrollRef} className="poster-rail flex gap-2.5 overflow-x-auto px-4 pb-1">
          {resumable.map((i, idx) => (
            <div
              key={`cw-${i.kind}-${i.tmdbId}-${i.season ?? 0}-${i.episode ?? 0}`}
              className="animate-fade-in-up flex-shrink-0 w-[48vw] sm:w-[210px] md:w-[236px] lg:w-[258px]"
              style={{ animationDelay: `${Math.min(idx * 0.03, 0.3)}s` }}
            >
              <PosterCard
                tmdbId={i.tmdbId}
                title={i.title}
                poster={i.poster}
                kind={i.kind}
                season={i.kind === "series" ? i.season : undefined}
                episode={i.kind === "series" ? i.episode : undefined}
                progress={i.progress}
                sublabel={
                  i.kind === "series" && i.episode
                    ? `S${i.season ?? 1} E${i.episode}`
                    : undefined
                }
              />
            </div>
          ))}
        </div>

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
