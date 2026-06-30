"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Play, Info, Star, Sparkles, Clock } from "lucide-react";
import { getServiceColor } from "@/lib/logos";
import type { CatalogItem } from "@/lib/types";
import type { EventTeam } from "@/lib/leagues";

/** An event surfaced in the hero (built by HomePage from /api/events). */
export interface HeroEvent {
  id: string;
  leagueName: string;
  leagueLogo: string;
  home: EventTeam;
  away: EventTeam;
  dateUtc: string;
  state: "pre" | "in" | "post";
  detail: string;
  /** OUR channel slug carrying it, or null. */
  watchSlug: string | null;
  watchName: string | null;
}

interface Props {
  items: CatalogItem[];
  events?: HeroEvent[];
}

type Slide = { type: "catalog"; item: CatalogItem } | { type: "event"; ev: HeroEvent };

/** Kickoff time in Eastern, e.g. "7:00 PM ET". */
function etTime(iso: string): string {
  try {
    return (
      new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) +
      " ET"
    );
  } catch {
    return "";
  }
}

export default function HeroBanner({ items, events = [] }: Props) {
  // Events lead the rotation (max 2), then the trending catalog backdrops.
  const slides: Slide[] = [
    ...events.slice(0, 2).map((ev) => ({ type: "event" as const, ev })),
    ...items.map((item) => ({ type: "catalog" as const, item })),
  ];

  const [current, setCurrent] = useState(0);
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchX = useRef<number | null>(null);

  const count = slides.length;
  const goTo = useCallback((idx: number) => setCurrent(idx), []);
  const next = useCallback(() => goTo((current + 1) % count), [current, count, goTo]);
  const prev = useCallback(() => goTo((current - 1 + count) % count), [current, count, goTo]);

  useEffect(() => {
    if (count < 2) return;
    intervalRef.current = setInterval(() => setCurrent((c) => (c + 1) % count), 6000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [count]);

  // Keep index valid if slides shrink (e.g. events arrive/leave).
  useEffect(() => { if (current >= count) setCurrent(0); }, [count, current]);

  const restart = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => setCurrent((c) => (c + 1) % count), 6000);
  };
  const handleDotClick = (idx: number) => { restart(); goTo(idx); };

  // Touch swipe (carousel on mobile).
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) { restart(); dx < 0 ? next() : prev(); }
    touchX.current = null;
  };

  if (count === 0) return null;
  const slide = slides[current];

  return (
    <div
      className="hud-scan relative w-full aspect-[16/9] sm:aspect-[21/9] max-h-[70vh] mt-11 mb-6 rounded-b-2xl overflow-hidden bg-black"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Backgrounds (crossfaded) */}
      <div className="absolute inset-0">
        {slides.map((s, i) =>
          s.type === "catalog" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`c-${s.item.tmdb_id}`}
              src={s.item.backdrop}
              alt=""
              referrerPolicy="no-referrer"
              className={`absolute inset-0 w-full h-full object-cover transition-all duration-[1200ms] ease-out ${
                i === current ? "opacity-100 scale-105" : "opacity-0 scale-100"
              }`}
              onError={() => setImgErrors((p) => ({ ...p, [i]: true }))}
            />
          ) : (
            // Generic league "poster": branded gradient + large faint league logo.
            <div
              key={`e-${s.ev.id}`}
              className={`absolute inset-0 transition-opacity duration-[1200ms] ease-out bg-gradient-to-br from-brand/40 via-blue-950/40 to-black ${
                i === current ? "opacity-100" : "opacity-0"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.ev.leagueLogo}
                alt=""
                referrerPolicy="no-referrer"
                className="absolute right-[-4%] top-1/2 -translate-y-1/2 h-[120%] object-contain opacity-10"
              />
            </div>
          ),
        )}
        <div
          className={`absolute inset-0 bg-gradient-to-br from-brand/30 via-blue-950/30 to-surface transition-opacity duration-700 ${
            slide.type === "catalog" && imgErrors[current] ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>

      <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-surface/80 via-surface/20 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-surface/60 via-transparent to-transparent" />

      <div className="absolute bottom-2 left-0 right-0 px-4 sm:px-6 max-w-screen-lg">
        <div key={current} className="animate-fade-in-up">
          {slide.type === "catalog" ? (
            <CatalogContent item={slide.item} />
          ) : (
            <EventContent ev={slide.ev} />
          )}
        </div>
        {count > 1 && (
          <div className="flex justify-center gap-1.5 mt-5">
            {slides.map((_, i) => (
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
      </div>

    </div>
  );
}

function CatalogContent({ item }: { item: CatalogItem }) {
  const href = item.category === "series" ? `/vod/series/${item.tmdb_id}` : `/vod/movie/${item.tmdb_id}`;
  return (
    <>
      <h1 className="text-white text-xl sm:text-2xl font-bold mb-1 hero-text-shadow truncate">{item.title}</h1>
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
        <a href={href} className="flex items-center gap-1.5 bg-white text-black px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-white/90 transition-all hover:scale-105 active:scale-95">
          <Play className="w-4 h-4 fill-black" /> Play
        </a>
        <a href={href} className="flex items-center gap-1.5 bg-white/10 text-white px-5 py-2.5 rounded-full text-sm font-medium backdrop-blur-sm hover:bg-white/20 transition-all">
          <Info className="w-4 h-4" /> Details
        </a>
      </div>
    </>
  );
}

function HeroTeam({ team, score, showScore }: { team: EventTeam; score?: string; showScore: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {team.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.logo} alt="" referrerPolicy="no-referrer" className="w-8 h-8 object-contain" />
      ) : (
        <span className="w-8 h-8 rounded-full bg-white/10" />
      )}
      <span className="text-white text-lg font-bold hero-text-shadow">{team.name}</span>
      {showScore && score !== undefined && score !== "" && (
        <span className="text-white text-lg font-bold tabular-nums ml-1">{score}</span>
      )}
    </div>
  );
}

function EventContent({ ev }: { ev: HeroEvent }) {
  const live = ev.state === "in";
  const final = ev.state === "post";
  const showScore = live || final;
  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ev.leagueLogo} alt="" referrerPolicy="no-referrer" className="w-5 h-5 object-contain" />
        <span className="text-white/80 text-xs font-semibold uppercase tracking-wide">{ev.leagueName}</span>
        {live && (
          <span className="flex items-center gap-1 text-brand text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-brand live-dot" /> LIVE
          </span>
        )}
      </div>
      <div className="space-y-1 mb-3">
        <HeroTeam team={ev.away} score={ev.away.score} showScore={showScore} />
        <HeroTeam team={ev.home} score={ev.home.score} showScore={showScore} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {ev.watchSlug ? (
          <Link
            href={`/live/${ev.watchSlug}`}
            className="flex items-center gap-1.5 bg-white text-black px-6 py-2.5 rounded-full text-sm font-semibold hover:bg-white/90 transition-all hover:scale-105 active:scale-95"
          >
            <Play className="w-4 h-4 fill-black" />
            {live ? "Watch Live" : ev.watchName ? `Watch on ${ev.watchName}` : "Watch"}
          </Link>
        ) : (
          <span className="bg-white/10 text-white/80 px-5 py-2.5 rounded-full text-sm font-medium backdrop-blur-sm">
            Not on your channels
          </span>
        )}
        <span className="flex items-center gap-1.5 text-white/80 text-sm">
          <Clock className="w-4 h-4" />
          {live ? ev.detail : final ? ev.detail || "Final" : etTime(ev.dateUtc)}
        </span>
      </div>
    </>
  );
}
