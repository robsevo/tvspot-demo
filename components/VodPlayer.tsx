"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import VideoPlayer, { type TvCcHandle } from "@/components/VideoPlayer";
import type { SubtitleTrack } from "@/lib/subtitles";
import { fetchJson, DEADLINE } from "@/lib/fetchDeadline";

/**
 * VideoPlayer wrapped with VOD source-failure detection. Live TV has its own
 * failover in ChannelPlayer — this is the VOD equivalent, fixing the "press
 * play and nothing happens / the play button never goes away" class:
 *
 *  - player error (dead proxy URL, bad container, hls fatal) → onSourceFail
 *  - stall watchdog second-strike (plays then freezes)       → onSourceFail
 *  - play requested but NOTHING ever starts within 15s       → onSourceFail
 *    (a dead-slow source neither errors nor plays — the timeout is the only
 *    signal; cleared the instant playback actually begins)
 *
 * The parent advances to its next source and remounts with autoPlay so the
 * user doesn't have to press play again.
 */
interface Props {
  src: string;
  poster?: string;
  title?: string;
  initialTime?: number;
  autoPlay?: boolean;
  onProgress?: (currentTime: number, duration: number) => void;
  /** This source is dead — advance. Receives the last playback position so
   *  the parent can resume the NEXT source there instead of restarting. */
  onSourceFail?: (lastTime: number) => void;
  /** Fired when playback actually starts (first frame ready). */
  onPlay?: () => void;
  /** Fired when the media reaches its natural end (drives episode auto-advance). */
  onEnded?: () => void;
  /** External WebVTT caption tracks (see useSubtitles). They're keyed to the
   *  TITLE, not the source URL, so they survive a source failover unchanged. */
  subtitles?: SubtitleTrack[];
  /** Passed through to VideoPlayer — the /tv pages drive pause/seek via the
   *  raw <video> element instead of the touch overlay. */
  videoElRef?: React.MutableRefObject<HTMLVideoElement | null>;
  /** Passed through to VideoPlayer — TV mode, no touch chrome. */
  hideControls?: boolean;
  /** Passed through to VideoPlayer — TV OSD caption toggle. */
  ccRef?: React.MutableRefObject<TvCcHandle | null>;
}

// Remux sources get a longer runway: a cold relay ffmpeg spawn takes ~20-24s
// to produce the first manifest (the relay holds the request meanwhile), and
// failing over AWAY from the last-resort source because it was still warming
// up defeats its purpose. Direct sources are double-proxied (vod-stream →
// stream-proxy → origin) and a cold chain regularly needs >15s to first frame —
// killing them at 15s cycled the player through GOOD sources ("keeps
// restarting" while the same URL played fine via Open, which has no timeout).
const NEVER_STARTED_MS = 25_000;
const NEVER_STARTED_REMUX_MS = 35_000;

// Minimum time a source stays on screen before its failure is REPORTED. Dead
// relay URLs error in well under a second; reporting instantly made failover
// strobe through the source list ("flickers between sources really fast",
// especially right after Recheck lifts every cooldown at once). The verdict
// itself is still immediate — only the advance is paced. Late failures
// (stalls minutes in) are past the dwell and report with zero delay.
const FAIL_DWELL_MS = 1_500;

// VOD stall window (VideoPlayer's watchdog runs two strikes of this). Wider
// than the live default: a cold proxied file rebuffering 10-20s is normal and
// self-recovers — the user sees the buffering ring/notice meanwhile — whereas a
// false failover restarts the movie on another source.
const STALL_MS = 15_000;

/** A relay remux source? Its playlist is rolling/live-style, so the media
 *  element reports no usable duration and native seeking no-ops. */
export function isRemuxSource(src: string | undefined): boolean {
  return !!src && src.includes("remux.m3u8");
}

/**
 * Second the relay's ffmpeg is told to start reading the file at, for a remux
 * source resuming/seeking to `at`.
 *
 * Exported because the TV shell has to agree with the player EXACTLY: the
 * remux clocks from 0 at this offset, so absolute position is
 * `remuxStartFor(...) + video.currentTime`. When the shell computed its own
 * idea of the offset the two drifted and continue-watching recorded a position
 * playback was never at.
 *
 * Below the threshold there's no point paying a respawn, so it starts at 0.
 */
export function remuxStartFor(src: string | undefined, at: number | undefined): number {
  if (!isRemuxSource(src) || !at || at <= REMUX_SEEK_MIN_S) return 0;
  return Math.max(0, Math.floor(at));
}

/** Below this, "resume" is just "start from the beginning". */
export const REMUX_SEEK_MIN_S = 5;

export default function VodPlayer({
  src,
  poster,
  title,
  initialTime,
  autoPlay = false,
  onProgress,
  onSourceFail,
  onPlay: onPlayProp,
  onEnded,
  subtitles,
  videoElRef,
  hideControls,
  ccRef,
}: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Separate from `timer`: arm()/clear() manage the never-started watchdog and
  // must never cancel a pending (dwell-delayed) failure report.
  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = useRef(false);
  const lastTime = useRef(0);
  const mountedAt = useRef(Date.now());
  const [started, setStarted] = useState(false);

  // Remux seek (touch scrubber). A rolling remux can't be seeked natively — the
  // playlist is a live window — so a scrub becomes "restart the relay at a new
  // offset": `seekTarget` overrides the resume position and the changed &start=
  // URL remounts playback there. `remuxDuration` is the file's real runtime,
  // needed both to scale the bar and to clamp a target. Only fetched/used when
  // the touch controls are visible (mobile/web); the TV shell has its own OSD
  // seek in TvVodPlayback and passes hideControls, so this stays dormant there.
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [remuxDuration, setRemuxDuration] = useState<number | null>(null);
  const durationFetchedFor = useRef<string | null>(null);
  // Audio-language choice (VOD remux). `audioTracks` is the switchable set;
  // `audioUrl` is a chosen track's signed remux URL, played in place of the
  // plain source. Same probe call as the runtime, so it costs no extra fetch.
  const [audioTracks, setAudioTracks] = useState<
    { rel: number; lang: string; label: string; url: string }[]
  >([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const fail = useCallback(() => {
    if (failed.current) return; // one verdict per source
    failed.current = true;
    clear();
    const wait = Math.max(0, FAIL_DWELL_MS - (Date.now() - mountedAt.current));
    if (wait === 0) {
      onSourceFail?.(lastTime.current);
    } else {
      reportTimer.current = setTimeout(() => onSourceFail?.(lastTime.current), wait);
    }
  }, [onSourceFail]);

  const arm = useCallback(() => {
    clear();
    const ms = src.includes("remux.m3u8") ? NEVER_STARTED_REMUX_MS : NEVER_STARTED_MS;
    timer.current = setTimeout(() => {
      if (!failed.current && !started) fail();
    }, ms);
    // `started` is intentionally read via state at fire time through the
    // closure guard below in onPlay (which clears the timer) — an armed timer
    // that outlives a successful start is always cleared before firing.
  }, [fail, started, src]);

  // New source: reset the verdict; if it auto-plays (failover advance), the
  // play attempt starts immediately — arm the never-started timeout now.
  useEffect(() => {
    failed.current = false;
    mountedAt.current = Date.now();
    setStarted(false);
    // A new source is a different file: drop any in-progress remux seek and the
    // audio-track override so we don't carry one file's offset/track onto another.
    setSeekTarget(null);
    setAudioUrl(null);
    setAudioTracks([]);
    if (autoPlay) arm();
    return () => {
      clear();
      // Source changed (advance landed / manual pick) — a stale pending
      // report must not fire against the new source's parent state.
      if (reportTimer.current) clearTimeout(reportTimer.current);
      reportTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Fetch the file's runtime for a remux source, which is what makes the touch
  // scrubber seekable (the rolling playlist can't report a duration). Mobile/web
  // only — gated on !hideControls so the TV never double-fetches (TvVodPlayback
  // fetches its own for the OSD). The relay caches the probe, so this is cheap.
  useEffect(() => {
    if (hideControls || !src.includes("remux.m3u8")) {
      setRemuxDuration(null);
      return;
    }
    if (durationFetchedFor.current === src) return;
    durationFetchedFor.current = src;
    let cancelled = false;
    fetchJson<{
      duration: number | null;
      tracks?: { rel: number; lang: string; label: string; url: string }[];
    }>(
      `/api/vod-audio-tracks?src=${encodeURIComponent(src)}`,
      { credentials: "include" },
      DEADLINE.stream,
    )
      .then(({ ok, data }) => {
        if (cancelled) return;
        const d = Number(ok ? data?.duration : NaN);
        setRemuxDuration(Number.isFinite(d) && d > 0 ? d : null);
        setAudioTracks(ok && Array.isArray(data?.tracks) ? data!.tracks : []);
      })
      .catch(() => {
        if (!cancelled) {
          setRemuxDuration(null);
          setAudioTracks([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [src, hideControls]);

  // What actually plays: a chosen audio track's remux URL overrides the plain
  // source (both are the same file, different mapped audio). Everything below —
  // remux detection, seek offset, caption clock — keys off this active URL.
  const activeSrc = audioUrl ?? src;
  // Remux sources (relay live-style HLS) can't seek natively — position is
  // baked into the URL instead: the relay's ffmpeg starts reading the file at
  // &start=<sec>. That is the mechanism behind BOTH resume and seeking; the
  // shell moves `initialTime` and this remounts at the new offset.
  const isRemux = isRemuxSource(activeSrc);
  // Where playback should begin: a touch seek (seekTarget) overrides the parent's
  // resume position. For a remux this is baked into the URL as &start=; for a
  // native file it's a normal seek via initialTime.
  const effectiveInitial = seekTarget ?? initialTime;
  // The exact second the relay's ffmpeg begins reading the file. The remux then
  // clocks from 0 here, so this is also how far the media clock lags the
  // episode-absolute caption clock — passed to VideoPlayer as captionTimeOffset
  // so subtitles line up on a resumed remux instead of showing the opening.
  const remuxStart = remuxStartFor(activeSrc, effectiveInitial);
  const effectiveSrc = remuxStart ? `${activeSrc}&start=${remuxStart}` : activeSrc;
  // Switch the audio language: capture the current absolute position so the new
  // track resumes in place (not from the top), then swap. lastTime tracks the
  // absolute position (remuxStart + media time), maintained in onTimeUpdate.
  const selectAudio = useCallback((url: string) => {
    const at = lastTime.current;
    setSeekTarget(at > 5 ? at : 0);
    setAudioUrl(url);
  }, []);
  // Hand the scrubber a virtual timeline when this is a remux with a known
  // runtime and the touch controls are live. Dragging sets seekTarget, which
  // moves remuxStart, which rewrites effectiveSrc → VideoPlayer reloads at the
  // new offset (its src-keyed watchdogs reset, so the ~few-second ffmpeg respawn
  // reads as normal buffering, not a failover).
  const virtualSeek =
    isRemux && remuxDuration && !hideControls
      ? { duration: remuxDuration, baseTime: remuxStart, onSeek: (abs: number) => setSeekTarget(Math.max(0, abs)) }
      : undefined;

  return (
    <VideoPlayer
      src={effectiveSrc}
      poster={poster}
      title={title}
      initialTime={isRemux ? undefined : effectiveInitial}
      virtualSeek={virtualSeek}
      audioTracks={hideControls ? undefined : audioTracks}
      currentAudioUrl={audioUrl}
      onSelectAudio={selectAudio}
      captionTimeOffset={remuxStart}
      autoPlay={autoPlay}
      stallMs={STALL_MS}
      subtitles={subtitles}
      videoElRef={videoElRef}
      hideControls={hideControls}
      ccRef={ccRef}
      onProgress={
        onProgress &&
        ((t, d) => {
          // Remux playback clocks from 0 at the baked offset — report ABSOLUTE
          // position/duration or continue-watching regresses to ~0% on resume.
          // The offset is remuxStart (what ffmpeg was actually told to seek to),
          // NOT initialTime: they differ by the 5s pre-roll, and below the 30s
          // threshold remuxStart is 0 while initialTime is not, so using
          // initialTime reported a position the media was never at.
          //
          // Duration: a rolling remux reports Infinity for `d`, which pins
          // continue-watching to 0%. When we know the file's real runtime
          // (mobile, where we fetched it) use it; otherwise fall back to the old
          // relative-plus-offset (TV keeps its own onProgress anyway).
          const absDuration = remuxDuration ?? remuxStart + d;
          onProgress(remuxStart + t, absDuration);
        })
      }
      onTimeUpdate={(t) => {
        // Remux playback clocks from 0 at the baked offset — track absolute
        // position so a further failover resumes at the right spot.
        lastTime.current = remuxStart + t;
      }}
      onPlayIntent={arm}
      onPlay={() => {
        setStarted(true);
        clear();
        onPlayProp?.();
      }}
      onEnded={onEnded}
      onError={fail}
      onStall={fail}
    />
  );
}
