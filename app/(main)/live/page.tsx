"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useChannels } from "@/hooks/useChannels";
import { getChannelType } from "@/lib/logos";
import { LogoImage } from "@/components/LogoImage";
import { proxyFetch } from "@/lib/api";
import { channelSlug } from "@/lib/sources";
import { useEvents } from "@/hooks/useEvents";
import { carriersForLeague, type GameEvent } from "@/lib/leagues";
import Link from "next/link";
import { Tv, CalendarDays } from "lucide-react";
import type { EpgResponse } from "@/lib/types";

const HOUR_WIDTH = 240; // pixels per hour
const NOW_COLOR = "#38bdf8";

const categoryTabs = ["All", "Sports", "Entertainment", "Movies", "News", "Kids", "Music", "Lifestyle"];

/** Live → within-the-hour → later-today → finished, for the events filter row. */
type GameStatus = "live" | "soon" | "upcoming" | "done";
function gameStatus(state: GameEvent["state"], startMs: number, nowMs: number): GameStatus {
  if (state === "in") return "live";
  if (state === "post") return "done";
  return (startMs - nowMs) / 60000 <= 60 ? "soon" : "upcoming";
}
/** Pill accent per status: green=live, amber=within 1h, grey=later, red=done. */
const STATUS_STYLE: Record<GameStatus, { dot: string; ring: string; text: string }> = {
  live: { dot: "bg-green-400", ring: "ring-green-400/50", text: "text-green-300" },
  soon: { dot: "bg-amber-400", ring: "ring-amber-400/50", text: "text-amber-300" },
  upcoming: { dot: "bg-gray-500", ring: "ring-white/10", text: "text-text-muted" },
  done: { dot: "bg-red-500", ring: "ring-red-500/40", text: "text-red-300" },
};
const teamAbbr = (t: GameEvent["home"]): string => t.abbrev || t.name.slice(0, 3).toUpperCase();

export default function LivePage() {
  const { channels, loading } = useChannels();
  const { data: eventsData } = useEvents();
  const [activeCat, setActiveCat] = useState("All");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [epgData, setEpgData] = useState<Record<string, { title: string; start: Date; end: Date }[]>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeRulerRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());

  // Update "now" every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Fetch EPG data
  useEffect(() => {
    if (channels.length === 0) return;
    const names = channels.map((c) => c.name).join(",");
    proxyFetch<EpgResponse>(`/api/lounge/epg?channels=${encodeURIComponent(names)}`)
      .then((data) => {
        const parsed: Record<string, { title: string; start: Date; end: Date }[]> = {};
        for (const [name, progs] of Object.entries(data.programmes || {})) {
          // First pass: merge overlapping/contiguous entries with the same title
          const sorted = progs
            .map((p) => ({
              title: p.title,
              start: new Date(p.start_utc),
              end: new Date(p.stop_utc),
            }))
            .sort((a, b) => a.start.getTime() - b.start.getTime());
          const merged: typeof sorted = [];
          for (const p of sorted) {
            const last = merged[merged.length - 1];
            if (last && last.title === p.title && p.start.getTime() <= last.end.getTime() + 300000) {
              if (p.end > last.end) last.end = p.end;
            } else {
              merged.push({ title: p.title, start: p.start, end: p.end });
            }
          }
          // Second pass: remove any remaining overlaps between different titles
          const deduped: typeof merged = [];
          for (const p of merged) {
            const last = deduped[deduped.length - 1];
            if (last && p.start.getTime() < last.end.getTime()) {
              // Overlaps with previous — different titles, skip the duplicate
            } else {
              deduped.push(p);
            }
          }
          parsed[name] = deduped;
        }
        setEpgData(parsed);
      })
      .catch(() => {});
  }, [channels]);

  // Time window: 1 hour before to 5 hours after
  const windowStart = useMemo(() => {
    const d = new Date(now);
    d.setHours(d.getHours() - 1, 0, 0, 0);
    return d;
  }, [now]);

  const windowEnd = useMemo(() => {
    const d = new Date(now);
    d.setHours(d.getHours() + 5, 0, 0, 0);
    return d;
  }, [now]);

  const windowHours = useMemo(() => {
    const hours: Date[] = [];
    const h = new Date(windowStart);
    while (h < windowEnd) {
      hours.push(new Date(h));
      h.setHours(h.getHours() + 1);
    }
    return hours;
  }, [windowStart, windowEnd]);

  const totalWidth = windowHours.length * HOUR_WIDTH;

  // Now-line position
  const nowOffset = ((now.getTime() - windowStart.getTime()) / (1000 * 60 * 60)) * HOUR_WIDTH;

  // Scroll to now on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, nowOffset - 100);
    }
  }, [nowOffset, loading]);

  // Channels grouped + ordered by derived TYPE (backend category is just "live",
  // so we classify by name). Sports → News → Entertainment → Movies → Kids →
  // Music → Lifestyle, keeping channel_number order within each type.
  const TYPE_ORDER = ["Sports", "News", "Entertainment", "Movies", "Kids", "Music", "Lifestyle"];
  const channelsByType = useMemo(() => {
    return [...channels]
      .map((ch) => ({ ch, type: getChannelType(ch.name) }))
      .sort((a, b) => {
        const ta = TYPE_ORDER.indexOf(a.type), tb = TYPE_ORDER.indexOf(b.type);
        if (ta !== tb) return (ta < 0 ? 99 : ta) - (tb < 0 ? 99 : tb);
        return (a.ch.channel_number || 0) - (b.ch.channel_number || 0);
      })
      .map((x) => x.ch);
  }, [channels]);

  // Filter channels by derived type (category tabs).
  const filteredByCat = useMemo(() => {
    return activeCat === "All"
      ? channelsByType
      : channelsByType.filter((ch) => getChannelType(ch.name) === activeCat);
  }, [channelsByType, activeCat]);

  // Today's games we actually carry, for the events filter row: live first, then
  // by kickoff. Each entry keeps the lineup channels that broadcast it so a tap
  // narrows the grid to exactly those channels.
  const games = useMemo(() => {
    const list: { game: GameEvent; carriers: typeof channels }[] = [];
    for (const lg of eventsData?.leagues || []) {
      const carriers = carriersForLeague(lg.key, channels, channelSlug);
      if (!carriers.length) continue; // skip games we can't tune to
      for (const game of lg.games) list.push({ game, carriers });
    }
    const rank: Record<string, number> = { in: 0, pre: 1, post: 2 };
    list.sort((a, b) => {
      const r = (rank[a.game.state] ?? 1) - (rank[b.game.state] ?? 1);
      return r !== 0 ? r : new Date(a.game.dateUtc).getTime() - new Date(b.game.dateUtc).getTime();
    });
    return list;
  }, [eventsData, channels]);

  const selectedEntry = useMemo(
    () => games.find((x) => x.game.id === selectedGameId) || null,
    [games, selectedGameId],
  );

  // Grid channels: a selected game narrows to its broadcasters; otherwise the
  // category tab applies.
  const filteredChannels = useMemo(() => {
    if (selectedEntry) {
      const names = new Set(selectedEntry.carriers.map((c) => c.name));
      return channelsByType.filter((ch) => names.has(ch.name));
    }
    return filteredByCat;
  }, [selectedEntry, channelsByType, filteredByCat]);

  if (loading) {
    return (
      <div className="pt-4 min-h-screen">
        <div className="px-4 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 bg-card rounded-3xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="hud-grid-bg pt-14 min-h-screen pb-20 animate-page-rise">
      {/* Header */}
      <div className="px-4 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-3xl bg-white/[0.07] flex items-center justify-center">
            <Tv className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-white text-lg font-bold">Live TV</h1>
            <p className="text-text-muted text-[11px]">{channels.length} channels</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/events"
            className="flex items-center gap-1.5 glass-card text-text-secondary hover:text-white text-xs font-medium px-3 py-2 rounded-xl transition-colors"
          >
            <CalendarDays className="w-4 h-4" />
            Events
          </Link>
          <div className="flex items-center gap-1.5 text-cyan-400 text-xs font-medium bg-cyan-400/10 px-2.5 py-1 rounded-xl">
            <span className="w-1.5 h-1.5 rounded-xl bg-cyan-400 live-dot" />
            <span>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
      </div>

      {/* Category tabs — horizontal scroll */}
      <div className="flex gap-2.5 overflow-x-auto px-4 mb-3.5 poster-rail">
        {categoryTabs.map((cat) => {
          const count = cat === "All" ? channels.length : channels.filter((ch) => getChannelType(ch.name) === cat).length;
          if (count === 0 && cat !== "All") return null;
          return (
            <button
              key={cat}
              onClick={() => setActiveCat(cat)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                activeCat === cat
                  ? "bg-white/[0.07] text-white ring-1 ring-white/10"
                  : "glass-card text-text-secondary hover:text-white"
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Today's sporting events — status-colored (grey=later · amber=within 1h ·
          green=live · red=done). Tap to filter the grid to channels carrying it. */}
      <div className="flex gap-2.5 overflow-x-auto px-4 mb-5 poster-rail items-center">
        <button
          onClick={() => setSelectedGameId(null)}
          className={`flex-shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all ${
            !selectedEntry
              ? "bg-white/[0.07] text-white ring-1 ring-white/10"
              : "glass-card text-text-secondary hover:text-white"
          }`}
        >
          All
        </button>
        {games.length === 0 ? (
          <span className="flex-shrink-0 text-text-muted text-[11px] px-1">No games on today</span>
        ) : (
          games.map(({ game }) => {
            const status = gameStatus(game.state, new Date(game.dateUtc).getTime(), now.getTime());
            const s = STATUS_STYLE[status];
            const active = selectedGameId === game.id;
            const suffix =
              status === "live"
                ? game.detail || "LIVE"
                : status === "done"
                  ? "FINAL"
                  : new Date(game.dateUtc).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            return (
              <button
                key={game.id}
                onClick={() => setSelectedGameId(active ? null : game.id)}
                title={`${game.away.name} vs ${game.home.name}`}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all ring-1 ${
                  active
                    ? `bg-white/[0.07] text-white ring-1 ring-white/10 ${s.ring}`
                    : `glass-card ${s.ring} text-text-secondary hover:text-white`
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${status === "live" ? "live-dot" : ""}`} />
                <span className="whitespace-nowrap">
                  {teamAbbr(game.away)} <span className="text-text-muted">v</span> {teamAbbr(game.home)}
                </span>
                <span className={`text-[10px] whitespace-nowrap ${active ? "text-white/80" : s.text}`}>
                  {suffix}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* EPG Grid */}
      {filteredChannels.length === 0 && selectedEntry ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-text-muted text-sm">No channels carrying this game right now</p>
        </div>
      ) : (
      <div className="relative">
        {/* Sticky channel column + scrollable grid */}
        <div className="flex">
          {/* Channel logos — fixed column */}
          <div className="flex-shrink-0 w-[72px] bg-[#0c1426] z-20 border-r border-white/5">
            {/* Empty top-left corner (aligns with time ruler) */}
            <div className="h-8 border-b border-white/5" />
            {/* Channel rows */}
            {filteredChannels.map((ch) => {
              return (
                <Link
                  key={ch.name}
                  href={`/live/${channelSlug(ch.name)}`}
                  className="flex flex-col items-center justify-center gap-0.5 h-14 border-b border-white/5 hover:bg-card/50 transition-colors"
                >
                  <div className="w-11 h-9 rounded-lg bg-gradient-to-br from-zinc-200/90 via-zinc-400/75 to-zinc-600/70 backdrop-blur-sm flex items-center justify-center overflow-hidden relative p-1 ring-1 ring-white/15">
                    <LogoImage
                      name={ch.name}
                      logoUrl={ch.logo_url || ch.logo}
                      className="w-full h-full object-contain"
                      fallbackClassName="text-gray-800"
                    />
                    {/* Smoked-glass casing — frosted gradient + sky-blue underglow */}
                    <div className="absolute inset-0 rounded-lg pointer-events-none bg-gradient-to-br from-white/15 via-transparent to-cyan-500/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),inset_0_-2px_3px_rgba(56,189,248,0.22)] ring-1 ring-white/10" />
                    {ch.online && (
                      <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-green-500 ring-1 ring-white" />
                    )}
                  </div>
                  <span className="text-text-muted text-[8px] leading-tight text-center truncate max-w-[64px]">{ch.name}</span>
                </Link>
              );
            })}
          </div>

          {/* Scrollable program grid */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-x-auto relative"
            onScroll={(e) => {
              if (timeRulerRef.current) {
                timeRulerRef.current.scrollLeft = (e.target as HTMLElement).scrollLeft;
              }
            }}
          >
            {/* Time ruler */}
            <div
              ref={timeRulerRef}
              className="sticky top-0 z-10 h-8 bg-[#0a1222]/95 border-b border-white/5 flex items-end overflow-hidden"
              style={{ width: totalWidth + 32 }}
            >
              {windowHours.map((h, i) => (
                <div
                  key={i}
                  className="flex-shrink-0 text-[10px] text-text-muted font-medium pl-2 pb-1 border-l border-white/5"
                  style={{ width: HOUR_WIDTH }}
                >
                  {h.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              ))}
              {/* Spacer for right padding */}
              <div className="flex-shrink-0 w-8" />
              {/* Now line on ruler */}
              <div
                className="absolute top-0 bottom-0 w-0.5 z-20"
                style={{ left: nowOffset, backgroundColor: NOW_COLOR, boxShadow: "0 0 8px rgba(56,189,248,0.6)" }}
              >
                <div className="absolute -top-0 left-1/2 -translate-x-1/2 bg-white/[0.07] text-cyan-300 text-[8px] px-1.5 py-0.5 rounded-b font-bold ring-1 ring-cyan-400/30">
                  NOW
                </div>
              </div>
            </div>

            {/* Program rows */}
            <div style={{ width: totalWidth + 32 }}>
              {filteredChannels.map((ch) => {
                const is247 = /^24\/7\s+/i.test(ch.name);
                const progs = epgData[ch.name] || [];
                return (
                  <div
                    key={ch.name}
                    className="h-14 border-b border-white/5 relative"
                  >
                    <div className="absolute inset-y-0 left-0 right-8 flex items-center">
                      {is247 ? (
                        <Link
                          href={`/live/${channelSlug(ch.name)}`}
                          className="absolute inset-x-0 top-1 bottom-1 left-1 right-9 rounded-lg bg-white/[0.05] ring-1 ring-white/10 flex items-center px-3"
                        >
                          <span className="text-[11px] truncate font-medium text-white">
                            24 hour {ch.name.replace(/^24\/7\s+/i, "")}
                          </span>
                        </Link>
                      ) : progs.length > 0 ? (
                        progs
                          .filter((p) => p.end > windowStart && p.start < windowEnd)
                          .map((p, i) => {
                            const startOffset = Math.max(0, (p.start.getTime() - windowStart.getTime()) / (1000 * 60 * 60)) * HOUR_WIDTH;
                            const endOffset = Math.min(totalWidth, ((p.end.getTime() - windowStart.getTime()) / (1000 * 60 * 60)) * HOUR_WIDTH);
                            const width = endOffset - startOffset;
                            if (width < 4) return null;
                            const isNow = p.start <= now && p.end > now;
                            const gap = 3;
                            return (
                              <Link
                                key={`${ch.name}-${i}`}
                                href={`/live/${channelSlug(ch.name)}`}
                                className={`rounded-md flex items-center px-2 overflow-hidden ${
                                  isNow
                                    ? "bg-white/[0.07] ring-1 ring-white/10 z-10"
                                    : "bg-white/[0.04] hover:bg-white/[0.06]"
                                }`}
                                style={{
                                  position: "absolute",
                                  top: 4,
                                  bottom: 4,
                                  left: startOffset + gap,
                                  width: Math.max(width - gap * 2, 36),
                                }}
                              >
                                <span className={`text-[11px] truncate font-medium ${isNow ? "text-white" : "text-text-secondary"}`}>
                                  {p.title}
                                </span>
                              </Link>
                            );
                          })
                      ) : (
                        <Link
                          href={`/live/${channelSlug(ch.name)}`}
                          className="absolute inset-x-0 top-1 bottom-1 left-1 right-9 rounded-lg bg-white/[0.02] border border-white/5 flex items-center px-3 hover:bg-white/[0.05] transition-colors"
                        >
                          <span className="text-text-muted text-[11px]">No schedule data</span>
                        </Link>
                      )}
                    </div>

                    {/* Now line */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 z-10 pointer-events-none"
                      style={{ left: nowOffset, backgroundColor: NOW_COLOR }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}