"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Hls from "hls.js";
import { Play, Pause, Maximize, Minimize, SkipBack, SkipForward, Monitor, Cast, Volume2, VolumeX, Volume1 } from "lucide-react";
import { castMedia, loadCastSDK } from "@/lib/cast";

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
  onTimeUpdate?: (time: number) => void;
  onEnded?: () => void;
  channelUp?: () => void;
  channelDown?: () => void;
  channelName?: string;
}

export default function VideoPlayer({
  src,
  poster,
  autoPlay = true,
  onPlay,
  onPause,
  onError,
  onStall,
  onTimeUpdate,
  onEnded,
  channelUp,
  channelDown,
  channelName,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [castAvailable, setCastAvailable] = useState(false);
  const [airPlaySupported, setAirPlaySupported] = useState(false);
  const controlsTimer = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mountedRef = useRef(true);

  // Proactively load Cast SDK so button appears
  useEffect(() => {
    loadCastSDK().then(() => setCastAvailable(true)).catch(() => {});
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Cancel any pending play() from previous src to avoid race
    video.pause();

    // Clean up previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Check if it's an HLS URL
    const isHlsUrl = typeof src === 'string' && src.includes(".m3u8");

    if (isHlsUrl && Hls.isSupported()) {
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
        // No low-latency: build a real ~45s forward buffer to ride out upstream
        // hiccups instead of pinning to the live edge with no cushion.
        lowLatencyMode: false,
        maxBufferLength: 45,
        maxMaxBufferLength: 90, // bound growth for mobile memory
        backBufferLength: 30,
        // Sit ~4 segments behind the live edge so there's a deep forward buffer.
        // The relay has sustained ~30-40s outage windows where every (shared)
        // source 403s at once — failover is futile, so the buffer is what keeps
        // playback alive until the relay recovers. Stay within a typical 60s
        // live window; if the playlist falls too far behind, resync forward.
        liveSyncDurationCount: 4,
        liveMaxLatencyDurationCount: 10,
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
        if (autoPlay) video.play().catch(() => {});
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => { recoverAttempts = 0; });
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
        // Unrecoverable, or recovery budget exhausted → let the parent fail over.
        onError?.("HLS playback error");
      });
    } else if (isHlsUrl && video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS (Safari)
      video.src = src;
      if (autoPlay) video.play().catch(() => {});
    } else {
      // Progressive MP4
      video.src = src;
      if (autoPlay) video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, autoPlay, onError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlayHandler = () => { setPlaying(true); onPlay?.(); };
    const onPauseHandler = () => { setPlaying(false); onPause?.(); };
    const onTimeHandler = () => {
      if (video.duration) {
        setProgress(video.currentTime / video.duration);
        onTimeUpdate?.(video.currentTime);
      }
    };
    const onEndedHandler = () => onEnded?.();
    const onErrorHandler = () => onError?.("Video playback error");

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
    };
  }, [onPlay, onPause, onTimeUpdate, onEnded, onError]);

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

    const STALL_MS = 10000;
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
      if (!recovering && hlsRef.current) {
        // First strike: try to recover in place; give it a fresh window.
        recovering = true;
        lastProgressAt = Date.now();
        try { hlsRef.current.startLoad(); } catch {}
        v.play().catch(() => {});
        return;
      }
      // Second strike (or no hls to recover) → genuine drop, fail over once.
      lastProgressAt = Date.now(); // avoid re-firing every tick before src swaps
      onStall?.();
    }, 1000);

    return () => clearInterval(id);
  }, [src, onStall]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  }, []);

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
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
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

      {/* Channel name overlay */}
      {channelName && controlsVisible && (
        <div className="absolute top-4 left-4 bg-black/70 text-white text-sm font-medium px-3 py-1.5 rounded-full animate-fade-in">
          {channelName}
        </div>
      )}

      {/* Center play button when paused */}
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            onClick={togglePlay}
            className="w-16 h-16 rounded-full bg-brand/90 flex items-center justify-center backdrop-blur-sm"
          >
            <Play className="w-8 h-8 text-white fill-white" />
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
            {/* Cast button (Chrome/Android) */}
            {castAvailable && src && (
              <button
                onClick={async () => {
                  try {
                    await castMedia(src, channelName || "TVSPOT", poster);
                  } catch {}
                }}
                className="text-white/80 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
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