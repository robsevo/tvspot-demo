"use client";

import { useMemo } from "react";
import { useChannels } from "@/hooks/useChannels";
import { useEpg } from "@/hooks/useEpg";
import Link from "next/link";
import { LogoImage } from "@/components/LogoImage";
import { channelSlug } from "@/lib/sources";
import type { EpgProgram } from "@/lib/types";

/** The program airing now, from either the EPG map or the channel's own
 *  sports game-guide entries. */
function nowPlaying(programs: EpgProgram[] | undefined): string | null {
  if (!programs?.length) return null;
  const now = Date.now();
  const hit = programs.find(
    (p) => new Date(p.start_utc).getTime() <= now && now < new Date(p.stop_utc).getTime(),
  );
  return hit?.title ?? null;
}

/** TV guide: one row per channel — logo, name, and what's on now. A vertical
 *  list (not a poster grid) because "what's on" is the deciding information. */
export default function TvLivePage() {
  const { channels, loading } = useChannels();
  const names = useMemo(() => channels.map((c) => c.name), [channels]);
  const { epg } = useEpg(names);

  return (
    <div className="px-16 pb-16">
      <h1 className="text-3xl font-bold text-white mb-6">Live TV</h1>

      {loading && channels.length === 0 && (
        <p className="text-xl text-text-muted">Loading channels…</p>
      )}

      <div className="flex flex-col gap-3 max-w-5xl">
        {channels.map((c) => {
          const current = nowPlaying(epg[c.name]) ?? nowPlaying(c.programs);
          return (
            <Link
              key={c.name}
              href={`/tv/live/${channelSlug(c.name)}`}
              data-tv
              className={`flex items-center gap-6 rounded-xl bg-card ring-1 ring-white/5 px-6 py-4 focus:outline-none ${
                c.online ? "" : "opacity-50"
              }`}
            >
              <div className="w-24 h-14 shrink-0 flex items-center justify-center">
                <LogoImage
                  name={c.name}
                  logoUrl={c.logo_url || c.logo}
                  className="w-full h-full"
                  fallbackClassName="text-xl font-bold text-white/80"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xl font-semibold text-white truncate">{c.name}</p>
                {current && (
                  <p className="text-lg text-text-secondary truncate">Now: {current}</p>
                )}
              </div>
              {!c.online && <span className="text-base text-text-muted shrink-0">Offline</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
