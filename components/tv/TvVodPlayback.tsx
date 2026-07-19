"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Pause, SkipForward } from "lucide-react";
import VodPlayer from "@/components/VodPlayer";
import type { TvCcHandle } from "@/components/VideoPlayer";
import { useTvBack } from "@/components/tv/TvNav";
import { TVKEY } from "@/lib/tv";
import type { PlayableSource } from "@/lib/sources";
import type { SubtitleTrack } from "@/lib/subtitles";
import {
  AUTO_NEXT_SECONDS,
  introEndFor,
  showNextUp,
  showSkipIntro,
} from "@/lib/episodeMarkers";

const SEEK_STEP_S = 15;
const OSD_MS = 3500;
/** Marker polling cadence. Independent of the OSD tick, which only runs while
 *  the OSD is visible — these buttons must appear with the OSD hidden. */
const MARKER_TICK_MS = 500;

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
  /** The following episode, when there is one. Drives the "Next up" card, its
   *  auto-advance countdown, and the play-on-end behaviour. Omit for movies or
   *  for the last episode of a series — everything episode-specific then stays
   *  off and this behaves exactly as before. */
  nextUp?: {
    /** Shown on the card, e.g. "S2 E4 · The Constant". */
    label: string;
    /** Switch playback to that episode. */
    play: () => void;
  } | null;
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
  nextUp,
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

  // ── Skip intro / Next up ──────────────────────────────────────────────────
  // Dismissals are stamped with the source `index` they were made against and
  // compared during render, rather than reset by an effect: a failover restarts
  // the episode on a new source, and a card waved away on the dead one should
  // come back. (Deriving it also keeps the React-compiler lint happy — a
  // setState inside an effect is an error in this repo.)
  const [marks, setMarks] = useState({ skip: false, next: false });
  const [dismissed, setDismissed] = useState({ src: -1, skip: false, next: false });
  const [countdown, setCountdown] = useState<number | null>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);

  const dismiss = useCallback((which: "skip" | "next") => {
    setDismissed((d) => ({
      ...(d.src === index ? d : { src: index, skip: false, next: false }),
      src: index,
      [which]: true,
    }));
  }, [index]);

  const skipVisible = marks.skip && !(dismissed.src === index && dismissed.skip);
  const nextVisible = marks.next && !(dismissed.src === index && dismissed.next) && !!nextUp;
  const actionVisible = skipVisible || nextVisible;

  // Poll the element rather than driving off timeupdate: timeupdate stops
  // firing while paused, and the card must stay put if someone pauses on the
  // credits. Booleans only change a handful of times per episode, so the
  // early-out keeps this from re-rendering 2x/second.
  useEffect(() => {
    const tick = () => {
      const v = videoElRef.current;
      if (!v) return;
      const skip = showSkipIntro(v.currentTime, v.duration);
      const next = showNextUp(v.currentTime, v.duration);
      setMarks((m) => (m.skip === skip && m.next === next ? m : { skip, next }));
    };
    tick();
    const id = setInterval(tick, MARKER_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const playNext = useCallback(() => {
    nextUp?.play();
  }, [nextUp]);

  const skipIntro = useCallback(() => {
    const v = videoElRef.current;
    if (!v) return;
    // Seek to an ABSOLUTE target, never a relative jump — repeated presses (an
    // easy thing to do on a remote) would otherwise walk into the episode.
    v.currentTime = introEndFor(v.duration);
    dismiss("skip");
    raiseOsd(v.paused);
  }, [raiseOsd, dismiss]);

  // Auto-advance countdown. Deadline-based rather than a decrementing counter:
  // the remaining value is computed from wall-clock inside the tick, so nothing
  // is written to state during the effect body, and a webview that throttles
  // timers can't stretch a 15s countdown into 40s of real time.
  useEffect(() => {
    if (!nextVisible) return;
    const deadline = Date.now() + AUTO_NEXT_SECONDS * 1000;
    const id = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(id);
        playNext();
      } else {
        setCountdown(left);
      }
    }, 250);
    return () => clearInterval(id);
  }, [nextVisible, playNext]);

  // Shown value: fall back to the full count for the sub-tick before the first
  // interval fires, so the card never paints a blank or a stale number.
  const shownCount = nextVisible ? (countdown ?? AUTO_NEXT_SECONDS) : null;

  // Move focus onto whichever action is showing so Enter activates it, and
  // hand focus back to the player when it goes away.
  useEffect(() => {
    if (actionVisible) actionRef.current?.focus();
  }, [actionVisible, skipVisible, nextVisible]);

  const dismissAction = useCallback(() => {
    if (nextVisible) dismiss("next");
    else if (skipVisible) dismiss("skip");
    actionRef.current?.blur();
  }, [nextVisible, skipVisible, dismiss]);

  // Back dismisses the card first, and only exits playback once nothing is up —
  // otherwise waving away "Next up" would quit the episode.
  useTvBack(actionVisible ? dismissAction : onClose);

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
      // An on-screen action owns Enter while it's focused. This listener is on
      // window and would otherwise swallow the keypress into play/pause before
      // the button's native activation ever ran.
      const onAction =
        document.activeElement instanceof HTMLElement &&
        document.activeElement.hasAttribute("data-tv-overlay-action");
      if (onAction && (code === TVKEY.enter || code === TVKEY.play || code === TVKEY.playPause)) {
        return;
      }
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
            onEnded={nextUp ? playNext : undefined}
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

      {/* Skip intro / Next up. Bottom-right, above the OSD so the two never
          collide. Only one is ever up: the windows can't overlap (intro ends
          inside the first ~95s, credits open in the last ~50s). */}
      {actionVisible && !exhausted && (
        <div className="absolute right-14 bottom-40 z-10">
          {nextVisible ? (
            <div className="tv-glass rounded-2xl px-7 py-5 shadow-2xl shadow-black/70 min-w-[22rem]">
              <p className="text-sm font-semibold tracking-wide text-[#8197a4] mb-1">NEXT EPISODE</p>
              <p className="text-2xl font-bold text-white truncate mb-4">{nextUp!.label}</p>
              <button
                ref={actionRef}
                data-tv
                data-tv-overlay-action
                onClick={playNext}
                className="tv-pill tv-menu-item w-full flex items-center justify-center gap-3 px-6 py-3 rounded-xl bg-white/10 text-xl font-bold text-white focus:outline-none"
              >
                <SkipForward className="w-6 h-6" />
                <span>
                  Watch next
                  {shownCount !== null ? ` · ${shownCount}` : ""}
                </span>
              </button>
              <p className="text-sm text-[#8197a4] mt-3 text-center">Press Back to stay</p>
            </div>
          ) : (
            <button
              ref={actionRef}
              data-tv
              data-tv-overlay-action
              onClick={skipIntro}
              className="tv-pill tv-menu-item flex items-center gap-3 px-8 py-4 rounded-xl bg-white/10 text-xl font-bold text-white shadow-2xl shadow-black/70 focus:outline-none"
            >
              <SkipForward className="w-6 h-6" />
              Skip intro
            </button>
          )}
        </div>
      )}

      {/* Prime-style bottom OSD: title, seek bar, timecodes */}
      {osdVisible && !exhausted && (
        <div className="tv-fade-osd absolute inset-x-0 bottom-0 px-14 pt-20 pb-10">
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
