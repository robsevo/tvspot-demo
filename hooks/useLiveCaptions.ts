"use client";

import { useEffect, useState, type RefObject } from "react";
import {
  CC_EMPTY,
  CC_LINGER_MS,
  CC_LIVE_LEAD_S,
  linesAtTime,
  linesFromActiveCues,
  type CcSource,
} from "@/lib/captions";

/**
 * Live CEA-608 captions for a lightweight player — the channel preview.
 *
 * The full VideoPlayer has a whole CC menu (native tracks, external WebVTT
 * files, language matching, remembered preference). A preview has one stream and
 * one question: what are they saying right now. So this is the small half of
 * that: pick the first caption track the element carries, and mirror it. The
 * cue parsing and layout are the SHARED engine in lib/captions, so the preview
 * and the player break lines the same way.
 *
 * Two things are easy to get wrong here and are why this is a hook, not four
 * lines inline:
 *
 *  - The track ARRIVES LATE. hls.js only creates the 608 text track once it has
 *    decoded caption data out of the H.264 SEI, which is well after the video is
 *    playing. Scanning `textTracks` once on mount finds nothing and the preview
 *    is silently caption-less forever, so we keep looking until one shows up.
 *  - `mode` must be "hidden", not "showing". Showing lets the browser draw its
 *    own captions on top of the ones we render, and "disabled" stops cues
 *    populating at all. Hidden is the one that fires cuechange while leaving the
 *    drawing to us.
 *
 * Live-only by design: it always reads CC_LIVE_LEAD_S ahead of the playhead,
 * because live 608 is typed by a human listening to the show and lands a beat
 * after the words it transcribes (see CC_LIVE_LEAD_S). The preview only ever
 * shows live channels, so there's no VOD path to branch on.
 */
export function useLiveCaptions(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  /** Changes when the underlying stream does, so the watch restarts. */
  srcKey: string | undefined,
): CcSource {
  const [source, setSource] = useState<CcSource>(CC_EMPTY);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !enabled || !srcKey) {
      setSource(CC_EMPTY);
      return;
    }

    let track: TextTrack | null = null;
    let tickTimer: ReturnType<typeof setInterval> | null = null;
    let findTimer: ReturnType<typeof setInterval> | null = null;
    let lingerTimer: ReturnType<typeof setTimeout> | null = null;

    const apply = (next: CcSource) => {
      if (lingerTimer) {
        clearTimeout(lingerTimer);
        lingerTimer = null;
      }
      if (next.lines.length) setSource(next);
      else lingerTimer = setTimeout(() => setSource(CC_EMPTY), CC_LINGER_MS);
    };

    const tick = () => {
      if (!track) return;
      const now = video.currentTime || 0;
      // Read ahead of the playhead; fall back to the playhead itself, then to
      // whatever the browser calls active. At the live edge the lead can outrun
      // what's been decoded, and giving up the lead beats giving up captions.
      let next = linesAtTime(track, now + CC_LIVE_LEAD_S);
      if (!next.lines.length) next = linesAtTime(track, now);
      if (!next.lines.length) next = linesFromActiveCues(track);
      apply(next);
    };

    const find = () => {
      if (track) return;
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t.kind !== "captions" && t.kind !== "subtitles") continue;
        track = t;
        t.mode = "hidden";
        if (findTimer) {
          clearInterval(findTimer);
          findTimer = null;
        }
        tickTimer = setInterval(tick, 200);
        tick();
        return;
      }
    };

    find();
    if (!track) findTimer = setInterval(find, 500);

    return () => {
      if (tickTimer) clearInterval(tickTimer);
      if (findTimer) clearInterval(findTimer);
      if (lingerTimer) clearTimeout(lingerTimer);
      // Leave the element as we found it — the preview unmounts on every channel
      // change, and a track left in "hidden" on a recycled element would keep
      // decoding cues nobody reads.
      if (track) {
        try {
          track.mode = "disabled";
        } catch {}
      }
      setSource(CC_EMPTY);
    };
  }, [videoRef, enabled, srcKey]);

  return source;
}
