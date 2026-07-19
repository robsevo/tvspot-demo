"use client";

import { useMemo } from "react";
import { useChannels } from "@/hooks/useChannels";
import { useEpg } from "@/hooks/useEpg";
import Link from "next/link";
import { LogoImage } from "@/components/LogoImage";
import { channelSlug } from "@/lib/sources";
import { nowAndNext, fmtTime } from "@/lib/tvEpg";

/** Prime-style channel guide: one row per channel — logo tile, what's on now
 *  with a live progress bar, and what's up next with its start time. */
export default function TvLivePage() {
  const { channels, loading } = useChannels();
  const names = useMemo(() => channels.map((c) => c.name), [channels]);
  const { epg } = useEpg(names);

  return (
    // One centered column: the guide is a 72rem list, and pinning it to the
    // left of a 1920px screen left a third of the panel empty ("everything is
    // to the left"). Title rides the same column so they align.
    <div className="px-16 pb-16 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-6">Live TV</h1>

      {loading && channels.length === 0 && (
        <p className="text-xl text-[#8197a4]">Loading channels…</p>
      )}

      <div className="flex flex-col gap-3">
        {channels.map((c) => {
          // Backend sports game-guide entries fill in when the EPG has nothing.
          const guide = nowAndNext(epg[c.name]?.length ? epg[c.name] : c.programs);
          return (
            <Link
              key={c.name}
              href={`/tv/live/${channelSlug(c.name)}`}
              data-tv
              className={`flex items-center gap-6 rounded-lg bg-[#1a242f] ring-1 ring-white/10 px-6 py-4 focus:outline-none ${
                c.online ? "" : "opacity-50"
              }`}
            >
              <div className="w-28 h-16 shrink-0 flex items-center justify-center">
                <LogoImage
                  name={c.name}
                  logoUrl={c.logo_url || c.logo}
                  className="w-full h-full"
                  fallbackClassName="text-xl font-bold text-white/80"
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <p className="text-base font-semibold text-[#8197a4] truncate">{c.name}</p>
                  {c.online && (
                    <span className="text-[11px] font-bold tracking-wider text-white bg-[#cc0000] rounded px-1.5 py-0.5 shrink-0">
                      LIVE
                    </span>
                  )}
                </div>

                {guide.now ? (
                  <>
                    <p className="text-xl font-semibold text-white truncate mt-0.5">
                      {guide.now.title}
                    </p>
                    <div className="mt-2 h-1 max-w-md rounded-full bg-white/15 overflow-hidden">
                      <div
                        className="h-full bg-[#1399ff]"
                        style={{ width: `${Math.round(guide.progress)}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-xl text-[#8197a4] mt-0.5">
                    {c.online ? "Live programming" : "Offline"}
                  </p>
                )}
              </div>

              {guide.next && (
                <div className="w-72 shrink-0 text-right">
                  <p className="text-sm text-[#8197a4]">Next · {fmtTime(guide.next.start_utc)}</p>
                  <p className="text-base text-[#aebbc5] truncate">{guide.next.title}</p>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
