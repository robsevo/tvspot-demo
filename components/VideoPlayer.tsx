"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type Hls from "hls.js"; // type only — the library is imported lazily below
import { Play, Pause, Maximize, Minimize, SkipBack, SkipForward, Monitor, Cast, Volume2, VolumeX, Volume1, PictureInPicture2 } from "lucide-react";
import { castMedia, loadCastSDK, endCastSession } from "@/lib/cast";
import { setPlaybackActive } from "@/lib/playbackState";

interface Props {
  src?: string;
  poster?: string;
  autoPlay?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onError?: (err: string) => void;
  /** Fired when playback makes no progress for too long (the "plays then drops"
   *  case) so the parent can fail over to another source. */
  onStall?: () => void;
  /** Fired the moment the user asks for playback (tap on the play button /
   *  overlay). Lets a VOD parent arm a "nothing ever played" timeout — the
   *  stall watchdog can't cover that case because a source that never starts
   *  stays paused. */
  onPlayIntent?: () => void;
  onTimeUpdate?: (time: number) => void;
  /** Throttled (~8s) progress callback for continue-watching persistence. */
  onProgress?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  channelUp?: () => void;
  channelDown?: () => void;
  channelName?: string;
  /** Display title for MediaSession (lock-screen) metadata. */
  title?: string;
  /** True for live channels — changes background/foreground resync behavior. */
  isLive?: boolean;
  /** Seek here once metadata loads (resume-where-you-left-off for VOD). */
  initialTime?: number;
  /** Stall-watchdog window (ms) before a recovery strike / failover. Live keeps
   *  the tight default (a stalled channel should fail over fast — another source
   *  has the same content); VOD passes a longer window because cold double-proxied
   *  files legitimately rebuffer for 10-20s and a false failover restarts the
   *  movie, which is worse than waiting. */
  stallMs?: number;
}

export default function VideoPlayer({
  src,
  poster,
  autoPlay = true,
  onPlay,
  onPause,
  onError,
  onStall,
  onPlayIntent,
  onTimeUpdate,
  onProgress,
  onEnded,
  channelUp,
  channelDown,
  channelName,
  title,
  isLive = false,
  initialTime,
  stallMs = 10000,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Was the video playing when the tab was backgrounded? (drives auto-resume).
  const wasPlayingRef = useRef(false);
  // Throttle continue-watching writes so timeupdate (~4Hz) doesn't spam storage.
  const lastProgressSaveRef = useRef(0);
  // Latest onProgress in a ref so the timeupdate effect doesn't re-subscribe when
  // the callback identity changes each render.
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);
  // onError/onStall likewise live in refs: they sit in the ATTACH and WATCHDOG
  // effects, and a parent re-creating these callbacks (probe verdicts landing,
  // playback state flips) must never re-run those — re-assigning video.src
  // restarts playback from 0 and silently discards the resume seek.
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  const onStallRef = useRef(onStall);
  useEffect(() => { onStallRef.current = onStall; }, [onStall]);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  // Rebuffering UX: `buffering` drives the on-screen ring; `bufferNotice` is the
  // sustained-rebuffer banner (the "freezes ~30s then resumes" case).
  const [buffering, setBuffering] = useState(false);
  const [bufferNotice, setBufferNotice] = useState(false);
  // User tapped play but nothing has started yet — drives the spinner on the
  // center button so a slow/dead source doesn't look like a dead button.
  const [awaitingPlay, setAwaitingPlay] = useState(false);
  const [castAvailable, setCastAvailable] = useState(false);
  const [airPlaySupported, setAirPlaySupported] = useState(false);
  // A cast session is live: local playback is stopped and an overlay explains
  // where the stream went. Cleared when the TV session ends (either side).
  const [casting, setCasting] = useState(false);
  // Picture-in-picture: the video plays on in the floating window while the
  // inline area shows a placeholder. Ref mirror for the visibility handler.
  const [pipSupported, setPipSupported] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const pipActiveRef = useRef(false);
  useEffect(() => { pipActiveRef.current = pipActive; }, [pipActive]);
  const controlsTimer = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Proactively load Cast SDK so button appears
  useEffect(() => {
    loadCastSDK().then(() => setCastAvailable(true)).catch(() => {});
  }, []);

  // PiP capability — standard API (Chrome/Edge/Android) or WebKit presentation
  // mode (Safari mac/iPhone/iPad). Firefox exposes neither (its PiP is
  // browser-chrome-only), so the button simply doesn't render there.
  useEffect(() => {
    const video = videoRef.current as any;
    if (!video) return;
    const standard = typeof document !== "undefined" && (document as any).pictureInPictureEnabled;
    const webkit =
      typeof video.webkitSupportsPresentationMode === "function" &&
      video.webkitSupportsPresentationMode("picture-in-picture") &&
      typeof video.webkitSetPresentationMode === "function";
    setPipSupported(Boolean(standard || webkit));
  }, []);

  // Keep pipActive in sync however PiP is entered/left (our button, the
  // browser's own control, or the PiP window's close button).
  useEffect(() => {
    const video = videoRef.current as any;
    if (!video) return;
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    const onWebkitMode = () =>
      setPipActive(video.webkitPresentationMode === "picture-in-picture");
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    video.addEventListener("webkitpresentationmodechanged", onWebkitMode);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
      video.removeEventListener("webkitpresentationmodechanged", onWebkitMode);
    };
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current as any;
    const doc = document as any;
    if (!video) return;
    try {
      if (doc.pictureInPictureEnabled) {
        if (doc.pictureInPictureElement) await doc.exitPictureInPicture();
        else await video.requestPictureInPicture();
        return;
      }
      if (typeof video.webkitSetPresentationMode === "function") {
        // Safari path
        const inPip = video.webkitPresentationMode === "picture-in-picture";
        video.webkitSetPresentationMode(inPip ? "inline" : "picture-in-picture");
      }
    } catch {}
  }, []);

  // Cast: hand the stream to the TV and STOP playing it here — both playing at
  // once was the old behavior. Local buffering stops too (bandwidth/battery);
  // when the TV session ends we rebuild, snap live back to the edge, and resume.
  const startCast = useCallback(async () => {
    const video = videoRef.current;
    if (!src) return;
    try {
      await castMedia(src, channelName || title || "TVSPOT", poster, {
        onSessionEnd: () => {
          setCasting(false);
          const v = videoRef.current;
          try { hlsRef.current?.startLoad(); } catch {}
          if (isLive && hlsRef.current) {
            const pos = hlsRef.current.liveSyncPosition;
            if (typeof pos === "number" && isFinite(pos) && pos > (v?.currentTime ?? 0) + 10) {
              try { if (v) v.currentTime = pos; } catch {}
            }
          }
          if (v) { const p = v.play(); if (p) p.catch(() => {}); }
        },
      });
      // Media is loaded on the TV → stop local playback + segment pulling.
      video?.pause();
      try { hlsRef.current?.stopLoad(); } catch {}
      setCasting(true);
    } catch {
      // User closed the device picker / session failed — leave local playing.
    }
  }, [src, channelName, title, poster, isLive]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Guard against the source-swap race: when the resolved "HD" sources arrive,
    // the parent swaps `src`, tearing down this effect. Without this flag a pending
    // MANIFEST_PARSED could call play() on a now-stale load → "play() interrupted
    // by a new load request". safePlay() no-ops once the effect is cancelled.
    let cancelled = false;
    const safePlay = () => {
      if (cancelled) return;
      const p = video.play();
      if (p) p.catch(() => {});
    };

    // Cancel any pending play() from previous src to avoid race
    video.pause();
    // Fresh source: clear a stale spinner; VOD auto-advance (autoPlay after a
    // failover) starts in the "waiting for playback" state so the user sees
    // progress, not a dead frame. Live keeps its existing overlay behavior.
    setAwaitingPlay(autoPlay && !isLive);

    // Clean up previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // One-shot position restore used by the native-HLS fallback below. Tracked at
    // effect scope so a source swap removes a not-yet-fired listener before it
    // could mis-seek the NEXT source's metadata load.
    let restoreSeek: (() => void) | null = null;

    // Check if it's an HLS URL
    const isHlsUrl = typeof src === 'string' && src.includes(".m3u8");

    // hls.js is ~150KB gzip: load it LAZILY, only when actually attaching an HLS
    // stream on an MSE browser — never on Home/search/etc, and never on iOS (which
    // plays .m3u8 natively). This keeps the library off every route's first-load JS.
    const supportsMSE =
      typeof window !== "undefined" &&
      ("MediaSource" in window || "ManagedMediaSource" in window);

    if (isHlsUrl && supportsMSE) {
      void (async () => {
      const Hls = (await import("hls.js")).default;
      if (cancelled) return;
      if (!Hls.isSupported()) {
        // MSE present but hls.js unusable — let the element try natively.
        video.src = src;
        if (autoPlay) safePlay();
        return;
      }
      // The relay upstream (relay.example.com, used by TSN1 etc.) transiently 403s
      // and times out even on a healthy stream. Bump load retries so those blips
      // are absorbed by the loader instead of bubbling up as a fatal error that
      // kills an otherwise-fine source. Build from DefaultConfig so we only
      // override the retry counts and keep every other policy field intact.
      const dc = Hls.DefaultConfig;
      const resilient = (p: typeof dc.fragLoadPolicy): typeof dc.fragLoadPolicy => ({
        default: {
          ...p.default,
          errorRetry: { maxNumRetry: 8, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
          timeoutRetry: { maxNumRetry: 4, retryDelayMs: 500, maxRetryDelayMs: 4000 },
        },
      });
      const hls = new Hls({
        enableWorker: true,
        // No low-latency: build a real ~60s forward buffer to ride out upstream
        // hiccups instead of pinning to the live edge with no cushion.
        lowLatencyMode: false,
        maxBufferLength: 60,
        // Cap forward growth for mobile memory. The forward buffer is what rides
        // out relay outages, so keep it generous; it's the BACK buffer that was
        // pure waste — 30s of already-watched media held in memory, making the
        // tab a fat eviction target. Trim the back buffer hard (mobile browsers
        // discard big-memory tabs, which is what made the app "restart").
        maxMaxBufferLength: 90,
        backBufferLength: 6,
        // Stall-recovery tuning for a remuxed flaky-TS origin. Our upstreams
        // are IPTV panels remuxed to HLS by the relay, so the media timeline
        // routinely has sub-second gaps (a dropped TS packet, a segment that's
        // a few ms short) AND full PTS discontinuities when the relay LRU-evicts
        // and respawns a channel's ffmpeg (it emits discont_start for exactly
        // this). At the hls.js default maxBufferHole 0.1s the player STALLS on
        // those and shows the spinner. 1.5s is the value the RELAY was built
        // around (see iptv_relay.py: "the player's maxBufferHole=1.5s ... flushes
        // the MSE source buffer cleanly at the marker instead of stalling on PTS
        // jumps after an LRU-evict + respawn") — it was never actually set on the
        // player until now. Steps over the gap/marker and keeps playing; no added
        // latency, and skipping a <=1.5s hole beats a spinner when we're already
        // 36s behind live.
        maxBufferHole: 1.5,
        nudgeOffset: 0.2,
        nudgeMaxRetry: 5,
        // Sit a fixed 36 SECONDS behind the live edge (not a segment COUNT). The
        // relay's transmux window is 36×3s = 108s, designed for exactly this — but
        // a count of 4 only bought ~12s on those 3s segments, leaving almost no
        // cushion. 36s behind in a 108s window = a deep forward buffer + ~72s of
        // look-back, so the relay's sustained ~30-40s outage windows (every shared
        // source 403s at once — failover is futile) are ridden out by the buffer
        // instead of catching the live edge and stalling. Seconds-based so it's
        // consistent across 3s-segment (transmux) and 10s-segment (passthrough)
        // sources. Resync forward only if >50s behind (stay off the 60s-window back
        // edge of passthrough sources).
        liveSyncDuration: 36,
        liveMaxLatencyDuration: 50,
        // Catch up to the live edge by GENTLY speeding playback (≤1.1×, barely
        // audible) instead of hard-seeking. Without this hls.js does nothing until
        // latency crosses liveMaxLatencyDuration, then jumps forward ~14s+ mid-watch
        // (the "big forward jumps"). The rate nudge holds latency near the 36s target
        // so a hard seek only fires on a genuine outage that blows past 50s behind.
        maxLiveSyncPlaybackRate: 1.1,
        fragLoadPolicy: resilient(dc.fragLoadPolicy),
        playlistLoadPolicy: resilient(dc.playlistLoadPolicy),
        manifestLoadPolicy: resilient(dc.manifestLoadPolicy),
      });
      hlsRef.current = hls;

      // Canonical hls.js recovery: transient network/media errors are recovered
      // in place (startLoad / recoverMediaError) rather than immediately failing
      // over. A time-windowed budget still escalates to the parent (real failover)
      // once a source is genuinely dead, and resets when playback recovers.
      let recoverAttempts = 0;
      let lastRecoverAt = 0;
      const MAX_RECOVERS = 4;

      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!autoPlay) return;
        const p = video.play();
        if (p) {
          p.catch(() => {
            // Play failed — typically segments haven't buffered yet (slow
            // CDN or transient network delay). Retry once after a short wait;
            // this is what the user does manually when they see the still
            // frame and press play.
            if (cancelled) return;
            setTimeout(() => {
              if (cancelled) return;
              video.play().catch(() => {});
            }, 2000);
          });
        }
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        recoverAttempts = 0;
        // If video isn't playing yet (initial play() failed because segments
        // weren't ready), retry now that we have buffered content.
        if (video.paused && autoPlay && !cancelled) {
          video.play().catch(() => {});
        }
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        const now = Date.now();
        if (now - lastRecoverAt > 60000) recoverAttempts = 0; // healthy gap → reset
        if (
          recoverAttempts < MAX_RECOVERS &&
          (data.type === Hls.ErrorTypes.NETWORK_ERROR ||
            data.type === Hls.ErrorTypes.MEDIA_ERROR)
        ) {
          recoverAttempts++;
          lastRecoverAt = now;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();         // resume after transient relay 403 / timeout
          } else {
            hls.recoverMediaError(); // re-init the media pipeline
          }
          return;
        }
        // hls.js is done with this source. On Safari-family browsers the NATIVE
        // HLS engine is a second, more forgiving player for the SAME url — it's
        // exactly what the "Open in new tab" escape hatch uses, and it rides out
        // streams hls.js chokes on. Hand playback over in place (resuming
        // position) before declaring the source dead: press Open for the user,
        // without the tab. VOD only — live failover is cheap (same content on
        // the next source) and the live path is tuned around hls.js buffering.
        // One-shot by construction: hls.destroy() means no further events from
        // this instance; if native then errors/stalls, the element's own error
        // handler / stall watchdog escalate to the parent as before.
        if (!isLive && !cancelled && video.canPlayType("application/vnd.apple.mpegurl")) {
          const at = video.currentTime;
          try { hls.destroy(); } catch {}
          if (hlsRef.current === hls) hlsRef.current = null;
          if (at > 5) {
            restoreSeek = () => {
              restoreSeek = null;
              try { video.currentTime = at; } catch {}
            };
            video.addEventListener("loadedmetadata", restoreSeek, { once: true });
          }
          video.src = src;
          safePlay();
          return;
        }
        // Unrecoverable, or recovery budget exhausted → let the parent fail over.
        onErrorRef.current?.("HLS playback error");
      });
      })();
    } else if (isHlsUrl && video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS (Safari / iOS) — plays .m3u8 without hls.js.
      video.src = src;
      if (autoPlay) safePlay();
    } else {
      // Progressive MP4 (or an HLS url on a browser with neither MSE nor native).
      video.src = src;
      if (autoPlay) safePlay();
    }

    return () => {
      cancelled = true;
      if (restoreSeek) video.removeEventListener("loadedmetadata", restoreSeek);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, autoPlay, isLive]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // setPlaybackActive: tell the deploy-reload gates a stream is on screen so a
    // version-skew reload waits for playback to stop instead of interrupting it.
    const onPlayHandler = () => { setPlaying(true); setAwaitingPlay(false); setPlaybackActive(true); onPlay?.(); };
    const onPauseHandler = () => { setPlaying(false); setPlaybackActive(false); onPause?.(); };
    const onTimeHandler = () => {
      if (video.duration) {
        setProgress(video.currentTime / video.duration);
        onTimeUpdate?.(video.currentTime);
        const now = Date.now();
        if (onProgressRef.current && now - lastProgressSaveRef.current > 8000) {
          lastProgressSaveRef.current = now;
          onProgressRef.current(video.currentTime, video.duration);
        }
      }
    };
    const onEndedHandler = () => { setPlaybackActive(false); onEnded?.(); };
    const onErrorHandler = () => { setAwaitingPlay(false); onError?.("Video playback error"); };

    video.addEventListener("play", onPlayHandler);
    video.addEventListener("pause", onPauseHandler);
    video.addEventListener("timeupdate", onTimeHandler);
    video.addEventListener("ended", onEndedHandler);
    video.addEventListener("error", onErrorHandler);

    return () => {
      video.removeEventListener("play", onPlayHandler);
      video.removeEventListener("pause", onPauseHandler);
      video.removeEventListener("timeupdate", onTimeHandler);
      video.removeEventListener("ended", onEndedHandler);
      video.removeEventListener("error", onErrorHandler);
      // Player torn down (navigated away, source swapped) → no longer watching.
      // Guards against the flag sticking true if the element unmounts without a
      // pause event firing.
      setPlaybackActive(false);
    };
  }, [onPlay, onPause, onTimeUpdate, onEnded, onError]);

  // Rebuffer feedback + recovery. Some sources play, then freeze while the edge
  // restocks, then resume. Drive the ring/notice off ACTUAL playback progress
  // (does currentTime advance?), NOT the media `waiting`/`stalled`/`playing`
  // events: on mobile — especially live — those fire constantly during perfectly
  // smooth playback, and `playing` doesn't reliably fire to clear the ring, so the
  // event-driven version showed "buffering" while the video was fine. We still use
  // `waiting` for the silent hls.startLoad() nudge (pull segments forward), but it
  // never touches the UI.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const onWaiting = () => { try { hlsRef.current?.startLoad(); } catch {} };
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);

    // Only surface UI when currentTime genuinely stops advancing — and hide it the
    // instant it moves again. Thresholds are real wall-clock stalls, so no false
    // positives from segment-boundary `waiting` blips.
    const RING_MS = 4000;    // no progress this long → spinner
    const NOTICE_MS = 9000;  // still stuck → "rebuilding the stream" banner
    let lastTime = video.currentTime;
    let stalledSince = 0; // 0 = progressing
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      // Not expected to be advancing → not "buffering".
      if (v.paused || v.seeking || v.ended) {
        lastTime = v.currentTime;
        stalledSince = 0;
        setBuffering(false);
        setBufferNotice(false);
        return;
      }
      if (v.currentTime > lastTime + 0.05) {
        lastTime = v.currentTime;
        stalledSince = 0;
        setBuffering(false);
        setBufferNotice(false);
        return;
      }
      // Frozen: measure how long.
      if (stalledSince === 0) stalledSince = Date.now();
      const stuck = Date.now() - stalledSince;
      if (stuck >= RING_MS) setBuffering(true);
      if (stuck >= NOTICE_MS) setBufferNotice(true);
    }, 500);

    return () => {
      clearInterval(id);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
    };
  }, [src]);

  // Stall watchdog: a live source can load fine, play a few buffered seconds,
  // then stop producing segments ("plays ~15s then drops"). The fatal-error path
  // doesn't always fire for that — playback just freezes. So we poll progress.
  // Two-strike, to match how production players treat a freeze: on the FIRST
  // stall we self-heal in place (hls.startLoad + play) without disturbing the
  // user; only if it stalls AGAIN without recovering do we report it so the
  // parent fails over. A transient relay hiccup no longer kills a good source.
  // Re-arms whenever `src` changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const STALL_MS = stallMs;
    let lastTime = video.currentTime;
    let lastProgressAt = Date.now();
    let recovering = false; // attempted self-heal, awaiting fresh progress

    const id = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      // Not expected to be progressing → keep resetting the clock.
      if (v.paused || v.seeking || v.ended) {
        lastTime = v.currentTime;
        lastProgressAt = Date.now();
        return;
      }
      if (v.currentTime > lastTime + 0.05) {
        lastTime = v.currentTime;
        lastProgressAt = Date.now();
        recovering = false; // progress resumed
        return;
      }
      if (Date.now() - lastProgressAt <= STALL_MS) return;

      // No forward progress past the threshold.
      if (!recovering) {
        // First strike: try to recover in place; give it a fresh window. Native
        // playback (iOS Safari HLS, progressive MP4 — hlsRef null) gets the same
        // second chance: it used to fail over on the FIRST freeze, which turned
        // an ordinary 10-20s rebuffer on a cold proxied source into a source
        // switch + restart ("the movie keeps restarting"). The browser's own
        // fetcher usually rides a freeze out — same as when the raw URL is
        // opened in a new tab, which is why "Open" worked when in-app didn't.
        recovering = true;
        lastProgressAt = Date.now();
        try { hlsRef.current?.startLoad(); } catch {}
        v.play().catch(() => {});
        return;
      }
      // Second strike → genuine drop, fail over once.
      lastProgressAt = Date.now(); // avoid re-firing every tick before src swaps
      onStallRef.current?.();
    }, 1000);

    return () => clearInterval(id);
  }, [src, stallMs]);

  // Background/foreground lifecycle — the core anti-eviction fix. When the tab is
  // backgrounded, a playing video keeps a decoder + big buffer alive, making the
  // OS far more likely to discard the tab (the "restart"). So on hide we pause and
  // stop pulling segments (frees memory/CPU); on show we resume — and for LIVE we
  // jump back to the edge rather than resuming stale.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) {
        // Picture-in-picture IS backgrounded viewing — pausing on hide would
        // freeze the floating window the moment the user switches apps/tabs,
        // which is the whole thing PiP exists for. Keep playing.
        if (pipActiveRef.current) return;
        wasPlayingRef.current = !video.paused;
        if (!video.paused) video.pause();
        try { hlsRef.current?.stopLoad(); } catch {}
      } else {
        try { hlsRef.current?.startLoad(); } catch {}
        if (isLive && hlsRef.current) {
          // Only ever catch UP to the live edge, never jump backward, and only when
          // we've genuinely fallen behind (stale after a real background). Resyncing
          // when already near the edge is what made live lurch forward OR backward on
          // every incidental tab blur (lock screen, notification shade) on mobile.
          const pos = hlsRef.current.liveSyncPosition;
          if (typeof pos === "number" && isFinite(pos) && pos > video.currentTime + 10) {
            try { video.currentTime = pos; } catch {}
          }
        }
        if (wasPlayingRef.current) video.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isLive]);

  // MediaSession — lock-screen / notification controls, and a signal to the OS
  // that this is active media (reduces background kills).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const label = title || channelName;
    if (label) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: label,
          artist: isLive ? "Live" : "TVSPOT",
          artwork: poster ? [{ src: poster, sizes: "512x512" }] : undefined,
        });
      } catch {}
    }
    const actions: [MediaSessionAction, () => void][] = [
      ["play", () => { videoRef.current?.play().catch(() => {}); }],
      ["pause", () => { videoRef.current?.pause(); }],
      ["stop", () => { videoRef.current?.pause(); }],
    ];
    for (const [action, handler] of actions) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    }
    return () => {
      for (const [action] of actions) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch {}
      }
    };
  }, [title, channelName, poster, isLive, src]);

  // Resume-where-you-left-off: seek to initialTime once metadata is available.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !initialTime || initialTime < 1) return;
    let done = false;
    const seek = () => {
      if (done) return;
      done = true;
      // Don't resume within the last 5s (basically the end) — start fresh instead.
      if (!video.duration || initialTime < video.duration - 5) {
        try { video.currentTime = initialTime; } catch {}
      }
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    return () => video.removeEventListener("loadedmetadata", seek);
  }, [initialTime, src]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    // play() returns a promise that REJECTS (AbortError) if a load/pause
    // interrupts it before it resolves — e.g. a source swap mid-tap. Always
    // swallow it so it never surfaces as an unhandled rejection in the console.
    if (video.paused) {
      setAwaitingPlay(true);
      onPlayIntent?.();
      const p = video.play();
      if (p) p.catch(() => {});
    } else video.pause();
  }, [onPlayIntent]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    setMuted(next);
    // Unmuting at zero volume would stay silent — restore an audible level.
    if (!next && video.volume === 0) {
      video.volume = 1;
      setVolume(1);
    }
  }, []);

  const changeVolume = useCallback((v: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(1, v));
    video.volume = clamped;
    video.muted = clamped === 0;
    setVolume(clamped);
    setMuted(clamped === 0);
  }, []);

  // Reflect volume/mute changes (including from native/OS controls) in the UI.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onVol = () => { setMuted(video.muted); setVolume(video.volume); };
    video.addEventListener("volumechange", onVol);
    return () => video.removeEventListener("volumechange", onVol);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current as any;
    const video = videoRef.current as any;
    const doc = document as any;

    const isFs = document.fullscreenElement || doc.webkitFullscreenElement;
    if (isFs) {
      (document.exitFullscreen || doc.webkitExitFullscreen)?.call(document);
      setFullscreen(false);
      return;
    }

    // Standard Fullscreen API (Android Chrome, desktop) on the container so the
    // custom controls go fullscreen too.
    if (container?.requestFullscreen) {
      container.requestFullscreen().catch(() => {});
      setFullscreen(true);
      return;
    }
    // Older WebKit container fullscreen.
    if (container?.webkitRequestFullscreen) {
      container.webkitRequestFullscreen();
      setFullscreen(true);
      return;
    }
    // iOS Safari (iPhone): element fullscreen is unsupported — only the <video>
    // element can go native-fullscreen. This is the path that was missing.
    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
      setFullscreen(true);
      return;
    }
  }, []);

  // Keep the fullscreen flag in sync when the user exits via the system UI
  // (Esc, swipe-down, or the native iOS video fullscreen controls).
  useEffect(() => {
    const onFsChange = () => {
      const doc = document as any;
      setFullscreen(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
    };
    const video = videoRef.current as any;
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    video?.addEventListener?.("webkitbeginfullscreen", () => setFullscreen(true));
    video?.addEventListener?.("webkitendfullscreen", () => setFullscreen(false));
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 4000);
  }, []);

  // Auto-hide the controls a few seconds after playback starts/resumes (they used
  // to stay up forever until the first tap). While paused, keep them visible.
  useEffect(() => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    if (playing) {
      controlsTimer.current = setTimeout(() => setControlsVisible(false), 4000);
    } else {
      setControlsVisible(true);
    }
    return () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); };
  }, [playing]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;
    // Live streams report a non-finite duration (Infinity/NaN) — seeking by ratio
    // would set currentTime to a non-finite value and throw. Only seek on a real
    // (finite, seekable) duration; clamp the ratio to [0,1].
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    video.currentTime = pos * d;
  }, []);

  // AirPlay support (Safari/iOS) — detect via video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if ("webkitShowPlaybackTargetPicker" in video) {
      video.setAttribute("x-webkit-airplay", "allow");
      setAirPlaySupported(true);
    }
  }, []);

  if (!src) {
    return (
      <div className="w-full aspect-video bg-surface rounded-lg flex items-center justify-center">
        <p className="text-text-muted text-sm">No stream available</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-black rounded-lg overflow-hidden group"
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain cursor-pointer"
        playsInline
        poster={poster}
        onClick={togglePlay}
        x-webkit-airplay="allow"
      />

      {/* Casting: the stream plays on the TV; local playback is stopped. z-40
          sits above the center play button so a paused local player can't
          invite a tap that double-plays. */}
      {casting && (
        <div className="absolute inset-0 z-40 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
          <Cast className="w-10 h-10 text-brand" />
          <p className="text-white text-sm font-medium">
            Playing on TV{channelName ? ` — ${channelName}` : ""}
          </p>
          <button
            onClick={() => endCastSession()}
            className="mt-1 text-xs font-medium bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl min-h-[44px] transition-colors"
          >
            Stop casting · play here
          </button>
        </div>
      )}

      {/* Picture-in-picture: playback continues in the floating window; the
          inline area is intentionally parked. Below the controls so the PiP
          button stays reachable to bring it back. */}
      {pipActive && !casting && (
        // Opaque: Chrome paints its own placeholder text on the video surface
        // in PiP; anything translucent double-exposes it through ours.
        <div className="absolute inset-0 z-10 bg-black flex flex-col items-center justify-center gap-3 pointer-events-none">
          <PictureInPicture2 className="w-10 h-10 text-brand" />
          <p className="text-white text-sm font-medium">Playing in picture-in-picture</p>
          <button
            onClick={togglePip}
            className="mt-1 text-xs font-medium bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl min-h-[44px] transition-colors pointer-events-auto"
          >
            Bring it back
          </button>
        </div>
      )}

      {/* Buffering ring — shown whenever the stream is rebuffering */}
      {buffering && playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-14 h-14 rounded-full border-[3px] border-white/15 border-t-cyan-400 border-r-brand animate-spin" />
        </div>
      )}

      {/* Sustained-rebuffer notice */}
      {bufferNotice && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-black/75 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full animate-fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 live-dot" />
          Buffering — rebuilding the stream…
        </div>
      )}

      {/* Channel name overlay */}
      {channelName && controlsVisible && (
        <div className="absolute top-4 left-4 bg-black/70 text-white text-sm font-medium px-3 py-1.5 rounded-full animate-fade-in">
          {channelName}
        </div>
      )}

      {/* Center play button when paused. z-30 + pointer-events so it sits ABOVE the
          bottom controls overlay — on the short VOD/series player that overlay
          otherwise reached the center and swallowed the tap. After a tap, the
          icon becomes a spinner until playback actually starts (or errors) —
          a slow source must never look like a dead button. */}
      {!playing && !casting && (
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
          <button
            onClick={togglePlay}
            className="w-16 h-16 rounded-full bg-brand/90 flex items-center justify-center backdrop-blur-sm pointer-events-auto"
            aria-label="Play"
          >
            {awaitingPlay ? (
              <span className="w-8 h-8 rounded-full border-[3px] border-white/30 border-t-white animate-spin" />
            ) : (
              <Play className="w-8 h-8 text-white fill-white" />
            )}
          </button>
        </div>
      )}

      {/* Bottom controls overlay */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 pt-12 transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Progress bar */}
        <div
          className="w-full h-1 bg-white/20 rounded-full mb-3 cursor-pointer"
          onClick={seek}
        >
          <div
            className="h-full bg-brand rounded-full transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {channelDown && (
              <button
                onClick={channelDown}
                className="text-white/80 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Previous channel"
              >
                <SkipBack className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={togglePlay}
              className="text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </button>
            {channelUp && (
              <button
                onClick={channelUp}
                className="text-white/80 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Next channel"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            )}

            {/* Volume / mute — mute toggle always shown (primary control on mobile),
                slider on larger screens. */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleMute}
                className="text-white/80 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(parseFloat(e.target.value))}
                aria-label="Volume"
                className="hidden sm:block w-16 accent-brand cursor-pointer"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Picture-in-picture (live TV) — the stream keeps playing in the
                floating window; the inline area shows the placeholder overlay. */}
            {isLive && pipSupported && (
              <button
                onClick={togglePip}
                className={`min-w-[44px] min-h-[44px] flex items-center justify-center ${
                  pipActive ? "text-brand" : "text-white/80 hover:text-white"
                }`}
                aria-label={pipActive ? "Exit picture-in-picture" : "Picture-in-picture"}
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>
            )}
            {/* Cast button (Chrome/Android) */}
            {castAvailable && src && (
              <button
                onClick={startCast}
                className={`min-w-[44px] min-h-[44px] flex items-center justify-center ${
                  casting ? "text-brand" : "text-white/80 hover:text-white"
                }`}
                aria-label="Cast"
              >
                <Cast className="w-4 h-4" />
              </button>
            )}
            {/* AirPlay button (Safari/iOS) */}
            {airPlaySupported && (
            <button
              onClick={() => {
                const video = videoRef.current;
                if (video && "webkitShowPlaybackTargetPicker" in video) {
                  (video as any).webkitShowPlaybackTargetPicker();
                }
              }}
              className="text-white/80 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="AirPlay"
            >
              <Monitor className="w-4 h-4" />
            </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="text-white/80 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}