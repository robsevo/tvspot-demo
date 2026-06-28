"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Play, Info, ChevronLeft, ChevronRight, Star, Sparkles } from "lucide-react";
import { getServiceColor } from "@/lib/logos";
import type { CatalogItem } from "@/lib/types";

interface Props {
  items: CatalogItem[];
}

export default function HeroBanner({ items }: Props) {
  const [current, setCurrent] = useState(0);
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const item = items[current];

  const goTo = useCallback((idx: number) => {
    setCurrent(idx);
  }, []);

  const next = useCallback(() => {
    goTo((current + 1) % items.length);
  }, [current, items.length, goTo]);

  const prev = useCallback(() => {
    goTo((current - 1 + items.length) % items.length);
  }, [current, items.length, goTo]);

  useEffect(() => {
    if (items.length < 2) return;
    intervalRef.current = setInterval(next, 6000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [next, items.length]);

  const handleDotClick = (idx: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    goTo(idx);
    intervalRef.current = setInterval(next, 6000);
  };

  if (!item || items.length === 0) return null;

  const href = item.category === "series"
    ? `/vod/series/${item.tmdb_id}`
    : `/vod/movie/${item.tmdb_id}`;

  return (
    <div className="hud-scan relative w-full aspect-[16/9] mb-6 rounded-b-2xl overflow-hidden bg-black">
      <div className="absolute inset-0">
        {items.map((it, i) => (
          <img
            key={it.tmdb_id}
            src={it.backdrop}
            alt=""
            referrerPolicy="no-referrer"
            className={`absolute inset-0 w-full h-full object-cover transition-all duration-[1200ms] ease-out ${
              i === current ? "opacity-100 scale-105" : "opacity-0 scale-100"
            }`}
            onError={() => setImgErrors(prev => ({ ...prev, [i]: true }))}
          />
        ))}
        <div className={`absolute inset-0 bg-gradient-to-br from-brand/30 to-surface transition-opacity duration-700 ${
          imgErrors[current] ? "opacity-100" : "opacity-0"
        }`} />
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-surface/60 via-transparent to-transparent" />

      {items.length > 1 && (
        <div className="absolute top-3 right-3 flex gap-1.5 z-10">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => handleDotClick(i)}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === current ? "w-6 bg-brand" : "w-1.5 bg-white/40 hover:bg-white/60"
              }`}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 p-4">
        <div key={current} className="animate-fade-in-up">
          <h1 className="text-white text-2xl font-bold mb-1 hero-text-shadow">{item.title}</h1>
          <div className="flex items-center gap-3 mb-2">
            {item.year && <span className="text-white/70 text-xs">{item.year}</span>}
            {item.vote_average && Number(item.vote_average) > 0 && (
              <span className="flex items-center gap-1 text-xs font-medium text-yellow-400">
                <Star className="w-3 h-3 fill-yellow-400" />
                {Number(item.vote_average).toFixed(1)}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs" style={{ color: getServiceColor(item.service) }}>
              <Sparkles className="w-3 h-3" />
              {item.service}
            </span>
          </div>
          <p className="text-text-secondary text-xs line-clamp-2 mb-3 max-w-[85%]">{item.overview}</p>
          <div className="flex gap-3">
            <a
              href={href}
              className="flex items-center gap-1.5 bg-white text-black px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-white/90 transition-all hover:scale-105 active:scale-95"
            >
              <Play className="w-4 h-4 fill-black" />
              Play
            </a>
            <a
              href={href}
              className="flex items-center gap-1.5 bg-white/10 text-white px-5 py-2.5 rounded-full text-sm font-medium backdrop-blur-sm hover:bg-white/20 transition-all"
            >
              <Info className="w-4 h-4" />
              Details
            </a>
          </div>
        </div>
      </div>

      {items.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center hover:bg-black/60 transition-all md:opacity-0 md:hover:opacity-100"
            aria-label="Previous"
          >
            <ChevronLeft className="w-4 h-4 text-white" />
          </button>
          <button
            onClick={next}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center hover:bg-black/60 transition-all md:opacity-0 md:hover:opacity-100"
            aria-label="Next"
          >
            <ChevronRight className="w-4 h-4 text-white" />
          </button>
        </>
      )}
    </div>
  );
}