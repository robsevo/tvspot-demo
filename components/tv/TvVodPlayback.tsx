"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Pause } from "lucide-react";
import VodPlayer from "@/components/VodPlayer";
import type { TvCcHandle } from "@/components/VideoPlayer";
import { useTvBack } from "@/components/tv/TvNav";
import { TVKEY } from "@/lib/tv";
import type { PlayableSource } from "@/lib/sources";
import type { SubtitleTrack } from "@/lib/subtitles";

const SEEK_STEP_S = 15;
const OSD_MS = 3500;

interface Props {
  /** Failover chain, best first (stream sources only — embeds are unusable
   *  with a remote, so TV never surfaces them). */
  sources: PlayableSource[];
  title: string;
  poster?: string;
  /** Resume position (continue watching). */
  initialTime?: number;
  /** External caption tracks (useSubtitles) — keyed to the title, so they
   *  survive source failover unchanged. Down on the remote toggles them. */
  subtitles?: SubtitleTrack[];
  onClose: () => void;
  /** Throttled absolute progress, for continue-watching persistence. */
  onProgress?: (currentTime: number, duration: number) => void;
}

function fmtClock(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Full-screen VOD playback for the TV shell, on top of VodPlayer's
 * source-failure detection. Prime-style OSD: any key raises a bottom bar with
 * the title, a seek bar, and timecodes; it fades while playing, stays while
 * paused. Remote controls:
 *
 *   Enter / Play-Pause   pause / resume
 *   Left / Right         seek ∓/± 15s (no-op on unseekable remux streams)
 *   Down                 captions on/off (remembered across titles)
 *   Back                 stop and return to the detail page
 */
export default function TvVodPlayback({
  sources,
  title,
  poster,
  initialTime,
  subtitles,
  onClose,
  onProgress,
}: Props) {
  const [index, setIndex] = useState(0);
  const [resumeAt, setResumeAt] = useState(initialTime ?? 0);
  const [exhausted, setExhausted] = useState(false);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const [osdVisible, setOsdVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [clock, setClock] = useState({ t: 0, d: 0 });
  const osdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ccRef = useRef<TvCcHandle | null>(null);
  // Chip state mirrors the player's caption state on the OSD tick, so the CC
  // badge also reflects an auto-restored "remembered on" without a keypress.
  const [cc, setCc] = useState({ on: false, available: false });

  const raiseOsd = useCallback((holdOpen?: boolean) => {
    setOsdVisible(true);
    if (osdTimer.current) clearTimeout(osdTimer.current);
    if (!holdOpen) osdTimer.current = setTimeout(() => setOsdVisible(false), OSD_MS);
  }, []);
  useEffect(() => () => {
    if (osdTimer.current) clearTimeout(osdTimer.current);
  }, []);

  // Feed the OSD's seek bar while it's up (500ms tick keeps re-renders scoped
  // to the visible OSD; nothing updates while it's hidden).
  useEffect(() => {
    if (!osdVisible) return;
    const tick = () => {
      const v = videoElRef.current;
      if (v) setClock({ t: v.currentTime, d: v.duration });
      if (ccRef.current) setCc(ccRef.current.state());
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [osdVisible]);

  useTvBack(onClose);

  // This source is dead — resume the next one where playback left off.
  const fail = useCallback(
    (lastTime: number) => {
      setResumeAt(lastTime > 5 ? lastTime : 0);
      setIndex((i) => {
        if (i + 1 < sources.length) {
          setNotice(`Source failed — trying ${sources[i + 1].label}`);
          setTimeout(() => setNotice(null), 4000);
          return i + 1;
        }
        setExhausted(true);
        return i;
      });
    },
    [sources],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoElRef.current;
      const code = e.keyCode;
      switch (code) {
        case TVKEY.enter:
        case TVKEY.playPause:
        case TVKEY.play:
        case TVKEY.pause:
          e.preventDefault();
          if (!v) return;
          if (v.paused) {
            void v.play().catch(() => {});
            setPaused(false);
            raiseOsd();
          } else {
            v.pause();
            setPaused(true);
            raiseOsd(true); // stays up while paused
          }
          return;
        case TVKEY.left:
        case TVKEY.rewind:
        case TVKEY.right:
        case TVKEY.fastForward: {
          e.preventDefault();
          if (!v || !isFinite(v.duration) || v.duration <= 0) return; // remux: unseekable
          const back = code === TVKEY.left || code === TVKEY.rewind;
          v.currentTime = Math.max(
            0,
            Math.min(v.duration, v.currentTime + (back ? -SEEK_STEP_S : SEEK_STEP_S)),
          );
          raiseOsd(v.paused);
          return;
        }
        case TVKEY.down: {
          // Captions toggle. Announce the result — on a TV there's no cursor
          // hover to discover state, the OSD notice IS the feedback.
          e.preventDefault();
          const h = ccRef.current;
          if (!h) return;
          const r = h.toggle();
          setCc(r);
          setNotice(!r.available ? "No captions available" : r.on ? "Captions on" : "Captions off");
          setTimeout(() => setNotice(null), 2500);
          raiseOsd(paused);
          return;
        }
        case TVKEY.up:
          e.preventDefault();
          raiseOsd(paused);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [raiseOsd, paused]);

  const source = sources[index];
  const pct = clock.d > 0 && isFinite(clock.d) ? (clock.t / clock.d) * 100 : 0;

  return (
    <div data-tv-trap className="fixed inset-0 z-50 bg-black">
      {source && !exhausted ? (
        <div className="w-full h-full flex items-center justify-center [&>div]:rounded-none">
          <VodPlayer
            key={index}
            src={source.url}
            poster={poster}
            title={title}
            autoPlay
            hideControls
            initialTime={resumeAt > 5 ? resumeAt : undefined}
            subtitles={subtitles}
            ccRef={ccRef}
            videoElRef={videoElRef}
            onSourceFail={fail}
            onPlay={() => setPaused(false)}
            onProgress={onProgress}
          />
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4">
          <p className="text-2xl text-white">No source could play {title}.</p>
          <p className="text-xl text-[#8197a4]">Press Back to return.</p>
        </div>
      )}

      {/* Center pause badge */}
      {paused && !exhausted && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-24 h-24 rounded-full bg-black/60 flex items-center justify-center">
            <Pause className="w-12 h-12 text-white fill-white" />
          </div>
        </div>
      )}

      {/* Failover notice */}
      {notice && (
        <div className="absolute top-10 left-12 bg-[#0f171e]/90 ring-1 ring-white/10 rounded-xl px-6 py-4 animate-fade-in">
          <p className="text-xl font-semibold text-white">{notice}</p>
        </div>
      )}

      {/* Prime-style bottom OSD: title, seek bar, timecodes */}
      {osdVisible && !exhausted && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-14 pt-20 pb-10">
          <p className="text-2xl font-bold text-white mb-4 truncate">{title}</p>
          <div className="h-1.5 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full bg-[#1399ff]" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-base text-[#aebbc5]">{fmtClock(clock.t)}</span>
            <div className="flex items-center gap-4">
              {cc.available && (
                <span
                  className={`text-sm font-bold px-2 py-0.5 rounded ${
                    cc.on ? "bg-[#1399ff] text-black" : "bg-white/15 text-[#aebbc5]"
                  }`}
                >
                  CC
                </span>
              )}
              <span className="text-base text-[#8197a4]">
                {isFinite(clock.d) && clock.d > 0 ? fmtClock(clock.d) : "Live"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
