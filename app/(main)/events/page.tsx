"use client";

import Link from "next/link";
import { useChannels } from "@/hooks/useChannels";
import { useEvents } from "@/hooks/useEvents";
import { channelSlug } from "@/lib/sources";
import { carrierForLeague, broadcastersForLeague, type GameEvent, type LeagueEvents } from "@/lib/leagues";
import type { Channel } from "@/lib/types";
import { ChevronLeft, Tv, CalendarDays, Play } from "lucide-react";

/** Kickoff time in Eastern, e.g. "7:00 PM ET". */
function etTime(iso: string): string {
  try {
    return (
      new Date(iso).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
      }) + " ET"
    );
  } catch {
    return "";
  }
}

function TeamRow({ name, logo, score, dim }: { name: string; logo?: string; score?: string; dim?: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-6 h-6 object-contain flex-shrink-0" />
      ) : (
        <span className="w-6 h-6 rounded-full bg-card flex-shrink-0" />
      )}
      <span className={`text-sm truncate ${dim ? "text-text-secondary" : "text-white font-medium"}`}>{name}</span>
      {score !== undefined && score !== "" && (
        <span className="ml-auto text-sm font-bold text-white tabular-nums">{score}</span>
      )}
    </div>
  );
}

function GameCard({ game, watchSlug, broadcasters }: { game: GameEvent; watchSlug: string | null; broadcasters: Channel[] }) {
  const live = game.state === "in";
  const final = game.state === "post";
  const showScore = live || final;

  const card = (
    <div
      className={`glass-card rounded-2xl p-3 transition-colors ${
        live ? "ring-1 ring-brand/50 hud-glow" : "ring-1 ring-white/5"
      } ${watchSlug ? "hover:bg-white/5 cursor-pointer" : ""}`}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        {/* status pill */}
        {live ? (
          <span className="flex items-center gap-1.5 text-brand text-[11px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-brand live-dot" />
            LIVE · {game.detail}
          </span>
        ) : final ? (
          <span className="text-text-muted text-[11px] font-medium">{game.detail || "Final"}</span>
        ) : (
          <span className="text-text-secondary text-[11px] font-medium">{etTime(game.dateUtc)}</span>
        )}
        {watchSlug && live && (
          <span className="flex items-center gap-1 text-brand text-[11px] font-semibold">
            <Play className="w-3 h-3 fill-brand" /> Watch
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <TeamRow name={game.away.name} logo={game.away.logo} score={showScore ? game.away.score : undefined} />
        <TeamRow name={game.home.name} logo={game.home.logo} score={showScore ? game.home.score : undefined} />
      </div>
      {(broadcasters.length > 0 || game.broadcasts.length > 0) && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {broadcasters.map((c) => (
            <span
              key={c.name}
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-brand/20 text-white ring-1 ring-brand/30"
            >
              {c.name}
            </span>
          ))}
          {game.broadcasts.length > 0 && (
            <span className="text-text-muted text-[10px] truncate">{game.broadcasts.join(" · ")}</span>
          )}
        </div>
      )}
    </div>
  );

  // Live + we carry it → link straight to the channel. Otherwise static card.
  return watchSlug && live ? (
    <Link href={`/live/${watchSlug}`} className="block focus:outline-none focus:ring-1 focus:ring-brand/50 rounded-2xl">
      {card}
    </Link>
  ) : (
    card
  );
}

function LeagueSection({ league, channels }: { league: LeagueEvents; channels: ReturnType<typeof useChannels>["channels"] }) {
  const carrier = carrierForLeague(league.key, channels, channelSlug);
  const watchSlug = carrier ? channelSlug(carrier.name) : null;
  const broadcasters = broadcastersForLeague(league.key, channels, channelSlug);
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 px-4 mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={league.logo} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-6 h-6 object-contain" />
        <h2 className="text-white text-[15px] font-bold tracking-tight">{league.name}</h2>
        <span className="text-text-muted text-[11px]">{league.games.length}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 px-4">
        {league.games.map((g) => (
          <GameCard key={g.id} game={g} watchSlug={watchSlug} broadcasters={broadcasters} />
        ))}
      </div>
    </section>
  );
}

export default function EventsPage() {
  const { channels } = useChannels();
  const { data, loading } = useEvents();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const leagues = data?.leagues || [];

  return (
    <div className="hud-grid-bg pt-14 min-h-screen pb-20 animate-page-rise">
      {/* Header — mirrors the Live page header, with a toggle back to Live TV */}
      <div className="px-4 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-3xl bg-gradient-to-br from-brand to-cyan-400 flex items-center justify-center hud-glow flex-shrink-0">
            <CalendarDays className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-white text-lg font-bold">Events</h1>
            <p className="text-text-muted text-[11px] truncate">{today}</p>
          </div>
        </div>
        <Link
          href="/live"
          className="flex items-center gap-1.5 glass-card text-text-secondary hover:text-white text-xs font-medium px-3 py-2 rounded-xl transition-colors flex-shrink-0"
        >
          <Tv className="w-4 h-4" />
          Live TV
        </Link>
      </div>

      {loading ? (
        <div className="px-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 hud-skeleton rounded-2xl" />
          ))}
        </div>
      ) : leagues.length === 0 ? (
        <div className="px-4 pt-12 text-center">
          <div className="w-16 h-16 rounded-full bg-card mx-auto mb-4 flex items-center justify-center">
            <CalendarDays className="w-6 h-6 text-text-muted" />
          </div>
          <p className="text-text-secondary text-sm">No games today</p>
          <p className="text-text-muted text-xs mt-1">Check back tomorrow for the day&rsquo;s fixtures</p>
          <Link href="/live" className="inline-flex items-center gap-1.5 text-brand text-sm mt-4">
            <ChevronLeft className="w-4 h-4" /> Back to Live TV
          </Link>
        </div>
      ) : (
        leagues.map((lg) => <LeagueSection key={lg.key} league={lg} channels={channels} />)
      )}
    </div>
  );
}
