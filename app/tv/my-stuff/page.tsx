"use client";

import { useCallback, useMemo, useState } from "react";
import { useMyList } from "@/hooks/useMyList";
import { useContinueWatching } from "@/hooks/useContinueWatching";
import TvRail from "@/components/tv/TvRail";
import TvPosterCard from "@/components/tv/TvPosterCard";
import { useTvBack } from "@/components/tv/TvNav";

/** The side menu's "My Stuff": the watchlist and continue-watching, the two
 *  things a TV user saves. Empty until they add something. */
export default function TvMyStuffPage() {
  const { items: listed } = useMyList();
  const { items: cwItems, remove } = useContinueWatching();

  /**
   * Remove mode for Continue watching.
   *
   * A mode toggle rather than a per-card affordance: a remote has no
   * right-click and no hover, and every extra control ON a card becomes another
   * D-pad stop between the viewer and pressing play — which is the thing they
   * actually came to do. A dedicated key is no good either; the one button both
   * the Samsung and the Fire TV remote reliably deliver here is Select.
   *
   * So the rail flips: while removing, its tiles are buttons that delete
   * instead of links that play, marked with a red REMOVE badge and dimmed art.
   * Back leaves the mode (registered below), which is what Back already means
   * everywhere else in the app.
   */
  const [removing, setRemoving] = useState(false);

  const continueWatching = useMemo(
    () => cwItems.filter((i) => i.progress > 2 && i.progress < 95).slice(0, 20),
    [cwItems],
  );

  const empty = listed.length === 0 && continueWatching.length === 0;

  // Back exits the mode instead of leaving the page — the innermost registered
  // handler wins, so this only intercepts Back while removing.
  const exitRemoving = useCallback(() => setRemoving(false), []);
  useTvBack(removing ? exitRemoving : null);

  // Removing the last row would strand the viewer in a mode with nothing to act
  // on and no visible way out.
  if (removing && continueWatching.length === 0 && !empty) setRemoving(false);

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
            <>
              <div className="px-16 flex items-center gap-4 mb-1">
                <button
                  type="button"
                  data-tv
                  onClick={() => setRemoving((v) => !v)}
                  className="tv-pill px-5 py-2 rounded-lg text-lg focus:outline-none focus:bg-white focus:text-black"
                >
                  {removing ? "Done" : "Remove titles"}
                </button>
                {removing && (
                  <span className="text-base text-[#8197a4]">
                    Select a title to remove it from Continue watching.
                  </span>
                )}
              </div>
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
                    {...(removing
                      ? {
                          onSelect: () => remove(i.tmdbId, i.kind),
                          danger: true,
                          badge: "REMOVE",
                        }
                      : {})}
                    tvAutoFocus={!removing}
                  />
                ))}
              </TvRail>
            </>
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
