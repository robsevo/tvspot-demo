"use client";

import type { GameEvent } from "@/lib/leagues";

/** Rich live-event tile shared by the TV home and Live TV pages: league mark
 *  washed large behind the matchup, league eyebrow, LIVE/UPCOMING badge.
 *  Plain-CSS art/shadow classes on purpose (Tizen: Tailwind gradients drop). */
export default function TvEventCard({
  game,
  leagueKey,
  leagueName,
  leagueLogo,
  onOpen,
  onCardFocus,
}: {
  game: GameEvent;
  /** "ufc" → the crests are fighter photos, not club logos. */
  leagueKey?: string;
  leagueName: string;
  leagueLogo?: string;
  onOpen: () => void;
  onCardFocus?: () => void;
}) {
  const portrait = leagueKey === "ufc";
  return (
    <button
      data-tv
      onClick={onOpen}
      onFocus={onCardFocus}
      className="w-[30rem] shrink-0 text-left rounded-xl bg-[#111a26] ring-1 ring-white/10 tv-card-shadow focus:outline-none"
    >
      <div className="tv-event-art relative h-52 rounded-t-xl overflow-hidden">
        {leagueLogo && (
          <img
            src={leagueLogo}
            alt=""
            referrerPolicy="no-referrer"
            className="pointer-events-none absolute -right-8 -bottom-8 w-56 h-56 object-contain opacity-[0.08]"
          />
        )}
        <div className="absolute top-3 left-4 flex items-center gap-2">
          {leagueLogo && (
            <img
              src={leagueLogo}
              alt=""
              referrerPolicy="no-referrer"
              className="w-6 h-6 object-contain"
            />
          )}
          <span className="text-xs font-bold uppercase tracking-widest text-white/70">
            {leagueName}
          </span>
        </div>
        <span
          className={`absolute top-3 right-3 text-xs font-bold tracking-wider rounded px-2 py-0.5 ${
            game.state === "in" ? "text-white bg-[#c7040c]" : "text-black bg-white/90"
          }`}
        >
          {game.state === "in" ? "LIVE" : "UPCOMING"}
        </span>
        <div className="absolute inset-0 flex items-center justify-center gap-10 px-8">
          <TeamCrest logo={game.away.logo} name={game.away.name} portrait={portrait} />
          <span className="text-2xl font-black text-white/40">VS</span>
          <TeamCrest logo={game.home.logo} name={game.home.name} portrait={portrait} />
        </div>
      </div>
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-white truncate">{game.shortName}</p>
          <p className="text-base text-[#8197a4] truncate">{game.detail || leagueName}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-[#1399ff]">Watch</span>
      </div>
    </button>
  );
}

function TeamCrest({ logo, name, portrait }: { logo?: string; name: string; portrait?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 min-w-0">
      {logo ? (
        <img
          src={logo}
          alt=""
          referrerPolicy="no-referrer"
          className={
            portrait
              ? "w-20 h-20 rounded-full object-cover bg-white/5 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
              : "w-20 h-20 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
          }
        />
      ) : (
        <div className="w-20 h-20 rounded-full bg-white/10" />
      )}
      <span className="truncate text-center text-sm font-semibold max-w-32 text-[#dfe8f0]">{name}</span>
    </div>
  );
}
