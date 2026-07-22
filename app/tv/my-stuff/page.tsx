"use client";

import { useMemo } from "react";
import { useMyList } from "@/hooks/useMyList";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import TvRail from "@/components/tv/TvRail";
import TvPosterCard from "@/components/tv/TvPosterCard";

/** The side menu's "My Stuff": the watchlist and continue-watching, the two
 *  things a TV user saves. Empty until they add something. */
export default function TvMyStuffPage() {
  const { items: listed } = useMyList();
  const { items: cwItems } = useContinueWatching();

  const continueWatching = useMemo(
    () => cwItems.filter((i) => i.progress > 2 && i.progress < 95).slice(0, 20),
    [cwItems],
  );

  const empty = listed.length === 0 && continueWatching.length === 0;

  return (
    <div className="pb-16">
      <h1 className="text-4xl font-bold text-white px-16 pt-2 mb-2">My Stuff</h1>

      {empty ? (
        <p className="px-16 py-8 text-xl text-[#8197a4]">
          Nothing saved yet. Open any title and choose “My Stuff”, or start watching
          something — it shows up here.
        </p>
      ) : (
        <>
          {continueWatching.length > 0 && (
            <TvRail title="Continue watching">
              {continueWatching.map((i) => (
                <TvPosterCard
                  key={`cw-${i.kind}-${i.tmdbId}-${i.season ?? 0}-${i.episode ?? 0}`}
                  tmdbId={i.tmdbId}
                  title={i.title}
                  // Continue-watching stores a POSTER url; it was previously
                  // passed as `backdrop`, which sent it down the w300 backdrop
                  // ladder that posters don't publish.
                  poster={i.poster}
                  kind={i.kind}
                  progress={i.progress}
                  sublabel={i.kind === "series" && i.episode ? `S${i.season ?? 1} E${i.episode}` : undefined}
                  tvAutoFocus
                />
              ))}
            </TvRail>
          )}

          {listed.length > 0 && (
            <TvRail title="Your watchlist">
              {listed.map((i, idx) => (
                <TvPosterCard
                  key={`ml-${i.kind}-${i.tmdbId}`}
                  tmdbId={i.tmdbId}
                  title={i.title}
                  poster={i.poster}
                  kind={i.kind}
                  provider={i.service}
                  tvAutoFocus={continueWatching.length === 0 && idx === 0}
                />
              ))}
            </TvRail>
          )}
        </>
      )}
    </div>
  );
}
