"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Pause, SkipForward, RefreshCw, ListVideo, Languages } from "lucide-react";
import { fetchWithDeadline, DEADLINE } from "@/lib/fetchDeadline";
import VodPlayer, { isRemuxSource, remuxStartFor, REMUX_SEEK_MIN_S } from "@/components/VodPlayer";
import type { TvAudioHandle } from "@/components/VideoPlayer";
import { isEnglishLang } from "@/lib/audioLang";
import type { TvCcHandle } from "@/components/VideoPlayer";
import { useTvBack } from "@/components/tv/TvNav";
import TvKeyHints from "@/components/tv/TvKeyHints";
import { TVKEY } from "@/lib/tv";
import type { PlayableSource } from "@/lib/sources";
import { useStreamCheck } from "@/hooks/useStreamCheck";
import type { SubtitleTrack } from "@/lib/subtitles";
import { useEpisodeMarkers } from "@/hooks/useEpisodeMarkers";

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
  /** Re-ask the backend for this title's sources, bypassing every cache.
   *  Sources rot — upstream panels rate-limit and the nightly job rotates
   *  links — so "the one it picked is dead" is a normal, recoverable state
   *  rather than a dead end. Omit and the refresh control simply isn't shown. */
  onRefreshSources?: () => Promise<void> | void;
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
 *   Up                   source picker (switch source / find new ones)
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
  onRefreshSources,
}: Props) {
  const [index, setIndex] = useState(0);
  const [resumeAt, setResumeAt] = useState(initialTime ?? 0);

  // SERVER-SIDE PROBE — used ONLY to skip definitively-dead sources on failover,
  // never to reorder. It must not reorder: lib/vod-resolve deliberately leads with
  // the relay REMUX ("ENGLISH FIRST, EVERY VOD… Don't 'fix' this ordering by
  // promoting direct files"), and remux is also the only path this 2019 Samsung
  // plays reliably — the relay maps English audio and transcodes AC-3 (which the
  // box cannot decode) to AAC. Ranking by probe verdict demoted remux (each remux
  // probe has to spin up ffmpeg, so it answers slowly or not at all) and promoted
  // raw progressive mp4s: foreign audio, and mid-playback freezing/stopping.
  //
  // Remux URLs are therefore NOT probed at all — a probe of one costs a relay
  // ffmpeg session for no verdict we'd act on. Unprobed sources are never judged
  // dead, so they stay exactly where the resolver put them.
  const probeUrls = useMemo(
    () => sources.filter((x) => !x.url.includes("remux")).map((x) => x.url),
    [sources],
  );
  const { statusOf } = useStreamCheck(probeUrls, { mode: "vod" });

  // Playback order is the RESOLVER's order, untouched.
  const ordered = sources;
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

  // Sources the player has already given up on this session. Kept as URLs, not
  // indices, so the marks survive a refresh reordering the list.
  const [deadUrls, setDeadUrls] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Audio-language menu. English is always the default (the relay auto-picks it),
  // so this only exists for someone who wants to change it. `audioTracks` is
  // fetched lazily the first time the picker opens on a remux source; `audioUrl`
  // is a chosen track's signed source, played in place of the plain source when set.
  const [audioTracks, setAudioTracks] = useState<
    { rel: number; lang: string; label: string; url: string }[]
  >([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const audioFetchedFor = useRef<string | null>(null);
  // Languages carried by the STREAM (provider-a, Origin, Provider B, any multi-audio
  // HLS) rather than produced by the relay. Without these the OSD had nothing
  // to show the moment failover moved off a remux — the Audio section simply
  // disappeared and whatever the stream defaulted to played. The player already
  // forces English on these; this is the manual override.
  const audioHandleRef = useRef<TvAudioHandle | null>(null);
  const [streamAudio, setStreamAudio] = useState<{ id: number; lang: string; label: string }[]>([]);
  const [streamAudioId, setStreamAudioId] = useState<number | null>(null);
  // Runtime of the underlying file, for remux sources only. The rolling remux
  // playlist never ends, so the <video> reports no usable duration — this is
  // what gives the OSD a real scale and bounds a seek. null → seeking stays off.
  const [remuxDuration, setRemuxDuration] = useState<number | null>(null);
  // A remux seek respawns the relay's ffmpeg at the new offset, which takes a
  // few seconds; without a marker the screen just freezes and looks broken.
  const [seeking, setSeeking] = useState(false);

  const source = ordered[index];
  // What actually plays: a chosen audio track's URL overrides the plain source.
  const activeUrl = audioUrl ?? source?.url ?? "";
  const isRemux = isRemuxSource(source?.url);
  // The second the relay's ffmpeg was told to start reading at. Playback clocks
  // from 0 there, so absolute position is remuxBase + video.currentTime.
  // Computed with the SAME helper VodPlayer uses to build the URL, so the two
  // can never disagree about where we are in the file.
  const remuxBase = remuxStartFor(activeUrl, resumeAt);

  /**
   * Where we actually are in the FILE, in seconds.
   *
   * A remux clocks from 0 at its baked offset, so the element's own currentTime
   * is NOT the position — reading it directly is what made switching away from a
   * remux mid-film restart near the beginning.
   */
  const absolutePosition = useCallback(
    () => (isRemux ? remuxBase : 0) + (videoElRef.current?.currentTime ?? 0),
    [isRemux, remuxBase],
  );

  /**
   * Seek a remux source. There is nothing to seek IN — the playlist is a
   * rolling live window — so instead we move the offset the relay starts its
   * ffmpeg at and let the player remount there. That respawn costs a few
   * seconds, which is why it announces itself rather than looking frozen.
   *
   * This is the whole reason VOD can be English AND seekable: the remux is the
   * only source whose audio track we control, and &start= gives it the one
   * thing it was missing.
   */
  const seekRemux = useCallback(
    (deltaS: number) => {
      if (!remuxDuration) return; // no runtime → no scale to seek against
      const abs = absolutePosition();
      // Leave a little headroom at the end: starting ffmpeg in the last seconds
      // produces a stream that ends before it can play.
      const target = Math.max(0, Math.min(remuxDuration - 10, abs + deltaS));
      if (Math.abs(target - abs) < 1) return;
      setSeeking(true);
      setResumeAt(target);
    },
    [absolutePosition, remuxDuration],
  );

  const refresh = useCallback(async () => {
    if (!onRefreshSources || refreshing) return;
    setRefreshing(true);
    setNotice("Looking for new sources…");
    try {
      await onRefreshSources();
      // A refresh is a fresh start: forget what died and re-enter the chain at
      // the top, otherwise the newly-fetched list is judged by the old verdicts.
      setDeadUrls([]);
      setExhausted(false);
      setIndex(0);
      setNotice("Sources refreshed");
    } catch {
      setNotice("Couldn't refresh sources");
    } finally {
      setRefreshing(false);
      setTimeout(() => setNotice(null), 3000);
    }
  }, [onRefreshSources, refreshing]);

  /** Jump straight to a source the user picked, keeping their place. */
  const pickSource = useCallback(
    (i: number) => {
      const at = absolutePosition();
      setResumeAt(at > REMUX_SEEK_MIN_S ? at : 0);
      setExhausted(false);
      setAudioUrl(null); // a different source has its own audio; forget the override
      setIndex(i);
      setPickerOpen(false);
    },
    [absolutePosition],
  );

  /** Switch the audio language: play the chosen track's remux, keeping position.
   *  Only offered for remux sources (a direct mp4 is one baked-in track). */
  const pickAudio = useCallback(
    (track: { url: string }) => {
      const at = absolutePosition();
      setResumeAt(at > REMUX_SEEK_MIN_S ? at : 0);
      setExhausted(false);
      setAudioUrl(track.url);
      setPickerOpen(false);
    },
    [absolutePosition],
  );

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
      if (v) {
        // A remux clocks from 0 at the baked offset and its playlist never ends,
        // so the element's own currentTime/duration describe the WINDOW, not the
        // film. Report absolute position against the file's real runtime instead.
        setClock(
          isRemux
            ? { t: remuxBase + v.currentTime, d: remuxDuration ?? NaN }
            : { t: v.currentTime, d: v.duration },
        );
      }
      if (ccRef.current) setCc(ccRef.current.state());
      // In-stream languages arrive asynchronously (manifest parse), so read the
      // handle on the same tick rather than once at open.
      const ah = audioHandleRef.current;
      setStreamAudio(ah ? ah.tracks() : []);
      setStreamAudioId(ah ? ah.activeId() : null);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [osdVisible, isRemux, remuxBase, remuxDuration]);

  // ── Skip intro / Next up ──────────────────────────────────────────────────
  // Timing, dismissal and auto-advance live in the shared hook so the TV and
  // mobile shells can't drift; everything below is TV-specific presentation
  // (focusable pills, Enter/Back handling).
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const {
    skipVisible,
    nextVisible,
    countdown: shownCount,
    skipIntro: seekPastIntro,
    playNext,
    dismiss: dismissAction,
    // Rolling relay-remux sources have no reliable episode length, so Skip
    // intro / Next up are suppressed on them (they'd otherwise fire mid-episode
    // — see useEpisodeMarkers). `isRemux` below reuses this same test.
  } = useEpisodeMarkers(
    videoElRef,
    nextUp ? nextUp.play : null,
    index,
    !/remux\.m3u8/.test(ordered[index]?.url ?? ""),
  );
  const actionVisible = skipVisible || nextVisible;

  const skipIntro = useCallback(() => {
    seekPastIntro();
    raiseOsd(videoElRef.current?.paused);
  }, [seekPastIntro, raiseOsd]);

  // Move focus onto whichever action is showing so Enter activates it, and
  // hand focus back to the player when it goes away.
  useEffect(() => {
    if (actionVisible) actionRef.current?.focus();
  }, [actionVisible, skipVisible, nextVisible]);

  const dismissAndBlur = useCallback(() => {
    dismissAction();
    actionRef.current?.blur();
  }, [dismissAction]);

  // Back unwinds one layer at a time: the source picker, then a Skip/Next card,
  // and only quits playback once nothing is up — otherwise waving away "Next up"
  // (or closing the picker) would drop the user out of the episode entirely.
  useTvBack(
    pickerOpen ? () => setPickerOpen(false) : actionVisible ? dismissAndBlur : onClose,
  );

  // This source is dead — resume the next one where playback left off.
  const fail = useCallback(
    (lastTime: number) => {
      setResumeAt(lastTime > 5 ? lastTime : 0);
      // An audio override belongs to the FAILED source's file; the next source is
      // a different file, so drop it and let that source's English default stand.
      setAudioUrl(null);
      setIndex((i) => {
        // Remember what died so the picker can grey it out — otherwise the user
        // is invited to hand-pick sources the player has already ruled out.
        const dead = ordered[i]?.url;
        if (dead) setDeadUrls((prev) => (prev.indexOf(dead) === -1 ? [...prev, dead] : prev));
        // Skip straight past sources the PROBE already judged dead. Landing on
        // one costs the full never-started watchdog (25s, 35s for remux) to learn
        // what we already know — six of those in a row is the 3+ minute hunt this
        // path used to do. A probe verdict of "dead" is only trusted for skipping,
        // never for hiding: if everything is judged dead we still try the next one.
        let n = i + 1;
        while (n < ordered.length && statusOf(ordered[n].url) === "dead") n += 1;
        if (n >= ordered.length) n = i + 1;   // all dead ahead → try anyway
        if (n < ordered.length) {
          setNotice(`Source failed — trying ${ordered[n].label}`);
          setTimeout(() => setNotice(null), 4000);
          return n;
        }
        setExhausted(true);
        return i;
      });
    },
    [ordered, statusOf],
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
      // While the picker is up it owns the remote: arrows move between source
      // buttons (TvNav) and Enter activates one. Without this, Enter would be
      // swallowed into play/pause and Left/Right would seek the video behind it.
      if (pickerOpen) return;
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
          const back = code === TVKEY.left || code === TVKEY.rewind;
          if (isRemux) {
            // Rolling playlist — seek by respawning the relay at a new offset.
            seekRemux(back ? -SEEK_STEP_S : SEEK_STEP_S);
            raiseOsd(true); // hold the OSD up across the respawn
            return;
          }
          if (!v || !isFinite(v.duration) || v.duration <= 0) return;
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
          // Up opens the source picker. Every other direction is already spoken
          // for (Left/Right seek, Down captions), and a stuck or stuttering
          // source is exactly when someone reaches for the remote — so the
          // escape hatch gets the one free key rather than being buried.
          e.preventDefault();
          setPickerOpen(true);
          raiseOsd(true);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [raiseOsd, paused, pickerOpen, isRemux, seekRemux]);

  const pct = clock.d > 0 && isFinite(clock.d) ? (clock.t / clock.d) * 100 : 0;

  // Probe a remux source once per URL: the language list AND the file's runtime
  // come back from the same relay call. Eager rather than lazy-on-picker,
  // because the runtime is what makes Left/Right seek work at all — it has to be
  // loaded before the user reaches for the remote. The relay caches the probe,
  // so replaying the same file doesn't pay for it again.
  useEffect(() => {
    if (!isRemux || !source) {
      setRemuxDuration(null);
      return;
    }
    if (audioFetchedFor.current === source.url) return;
    audioFetchedFor.current = source.url;
    setAudioLoading(true);
    fetchWithDeadline(
      `/api/vod-audio-tracks?src=${encodeURIComponent(source.url)}`,
      { credentials: "include" },
      DEADLINE.stream,
    )
      .then((r) => (r.ok ? r.json() : { tracks: [], duration: null }))
      .then((d) => {
        setAudioTracks(Array.isArray(d.tracks) ? d.tracks : []);
        const dur = Number(d?.duration);
        setRemuxDuration(Number.isFinite(dur) && dur > 0 ? dur : null);
      })
      .catch(() => {
        setAudioTracks([]);
        setRemuxDuration(null);
      })
      .finally(() => setAudioLoading(false));
  }, [isRemux, source]);

  return (
    <div data-tv-trap className="fixed inset-0 z-50 bg-black">
      {source && !exhausted ? (
        <div className="w-full h-full flex items-center justify-center [&>div]:rounded-none">
          <VodPlayer
            // Remount when the audio track changes too, not just the source
            // index — a new src needs a fresh <video>/hls.js (resume is carried
            // by initialTime).
            // Remount when the baked remux offset changes too: a seek rewrites
            // the src (&start=), and that needs a fresh <video>/hls.js.
            key={`${index}:${audioUrl ?? ""}:${remuxBase}`}
            src={activeUrl}
            poster={poster}
            title={title}
            autoPlay
            hideControls
            initialTime={resumeAt > REMUX_SEEK_MIN_S ? resumeAt : undefined}
            subtitles={subtitles}
            ccRef={ccRef}
            audioRef={audioHandleRef}
            videoElRef={videoElRef}
            onSourceFail={fail}
            onPlay={() => {
              setPaused(false);
              setSeeking(false);
            }}
            onEnded={nextUp ? playNext : undefined}
            onProgress={onProgress}
          />
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-6 px-16">
          <p className="text-2xl text-white">No source could play {title}.</p>
          <p className="text-xl text-[#8197a4] text-center max-w-2xl">
            Sources go offline and get replaced — asking again often finds a
            working one.
          </p>
          <div className="flex items-center gap-5 mt-2">
            {onRefreshSources && (
              <button
                data-tv
                data-tv-autofocus
                data-tv-overlay-action
                onClick={refresh}
                disabled={refreshing}
                className="tv-menu-item flex items-center gap-3 px-9 py-4 rounded-xl bg-white text-black text-xl font-bold disabled:opacity-50 focus:outline-none"
              >
                <RefreshCw className={`w-6 h-6 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Looking…" : "Find new sources"}
              </button>
            )}
            {ordered.length > 1 && (
              <button
                data-tv
                data-tv-overlay-action
                onClick={() => setPickerOpen(true)}
                className="tv-menu-item flex items-center gap-3 px-9 py-4 rounded-xl bg-[#223243] text-white text-xl font-semibold focus:outline-none"
              >
                <ListVideo className="w-6 h-6" />
                Choose a source
              </button>
            )}
          </div>
          <p className="text-lg text-[#5a6b78] mt-2">Press Back to return.</p>
        </div>
      )}

      {/* Source picker. The player already fails over on its own, but that only
          helps when a source FAILS loudly — the common TV case is one that
          stalls without ever erroring, where only the person watching knows
          it's stuck. This is their way out. */}
      {pickerOpen && (
        <div data-tv-trap className="absolute inset-0 z-20 bg-black/85 flex flex-col justify-end">
          <div className="px-14 pb-14">
            <p className="text-3xl font-bold text-white mb-2">Sources</p>
            <p className="text-lg text-[#8197a4] mb-7">
              {ordered.length} available
              {deadUrls.length > 0 ? ` · ${deadUrls.length} stopped working` : ""}
            </p>

            <div className="flex items-center gap-4 flex-wrap">
              {/* "Find new" leads the row, matching the live picker (8024d8b).
                  The overlay is opened BECAUSE something is wrong, and this is
                  the one control that goes and fetches sources we don't have
                  yet — behind up to ten chips it was the furthest thing from the
                  remote at the moment it's most wanted, and with a full list it
                  wrapped onto a second line entirely.

                  Unlike live, we canNOT sort the playing source to the front to
                  keep it one press away: `ordered` IS the resolver's order and
                  `index` points into it (7780371 — reordering VOD sources
                  demoted remux and froze the Samsung). In practice the player
                  starts at index 0 and stays there unless a source fails, so the
                  autofocused chip is normally the first one anyway. */}
              {onRefreshSources && (
                <button
                  data-tv
                  onClick={refresh}
                  disabled={refreshing}
                  className="tv-menu-item flex items-center gap-3 px-7 py-4 rounded-lg text-xl font-medium bg-[#1a242f] text-[#aebbc5] disabled:opacity-50 focus:outline-none"
                >
                  <RefreshCw className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
                  {refreshing ? "Looking…" : "Find new"}
                </button>
              )}
              {ordered.map((s: PlayableSource, i: number) => {
                const isCurrent = i === index;
                const isDead = deadUrls.indexOf(s.url) !== -1;
                return (
                  <button
                    key={s.url}
                    data-tv
                    {...(isCurrent ? { "data-tv-autofocus": true } : {})}
                    onClick={() => pickSource(i)}
                    className={`tv-menu-item flex items-center gap-3 px-7 py-4 rounded-lg text-xl font-medium focus:outline-none ${
                      isCurrent
                        ? "bg-white text-black"
                        : isDead
                          ? "bg-[#1a242f] text-[#5a6b78]"
                          : "bg-[#1a242f] text-[#aebbc5]"
                    }`}
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isCurrent ? "bg-black" : isDead ? "bg-[#5a6b78]" : "bg-[#28c76f]"
                      }`}
                    />
                    {s.label}
                    {isDead && !isCurrent ? " · failed" : ""}
                  </button>
                );
              })}
            </div>

            {/* Audio language. English is already the default everywhere — the
                relay maps it on a remux, and the player forces it on any stream
                that declares its own renditions. This is the "if the user wants,
                they can change it" path, and it now exists for BOTH kinds of
                source instead of only the remux. */}
            {((isRemux && (audioLoading || audioTracks.length > 1)) || streamAudio.length > 1) && (
              <div className="mt-8">
                <div className="flex items-center gap-2 mb-3">
                  <Languages className="w-6 h-6 text-[#8197a4]" />
                  <p className="text-2xl font-bold text-white">Audio</p>
                </div>
                {isRemux && audioLoading && audioTracks.length === 0 ? (
                  <p className="text-lg text-[#8197a4]">Checking languages…</p>
                ) : audioTracks.length > 1 ? (
                  <div className="flex items-center gap-4 flex-wrap">
                    {audioTracks.map((t) => {
                      const isCurrent = audioUrl === t.url;
                      const isEnglish = isEnglishLang(t.lang, t.label);
                      return (
                        <button
                          key={t.rel}
                          data-tv
                          onClick={() => pickAudio(t)}
                          className={`tv-menu-item flex items-center gap-2 px-7 py-4 rounded-lg text-xl font-medium focus:outline-none ${
                            isCurrent
                              ? "bg-white text-black"
                              : "bg-[#1a242f] text-[#aebbc5]"
                          }`}
                        >
                          {t.label}
                          {isEnglish && !isCurrent ? " · default" : ""}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-4 flex-wrap">
                    {streamAudio.map((t) => {
                      const isCurrent = streamAudioId === t.id;
                      return (
                        <button
                          key={t.id}
                          data-tv
                          onClick={() => {
                            audioHandleRef.current?.select(t.id);
                            setStreamAudioId(t.id);
                            setPickerOpen(false);
                          }}
                          className={`tv-menu-item flex items-center gap-2 px-7 py-4 rounded-lg text-xl font-medium focus:outline-none ${
                            isCurrent ? "bg-white text-black" : "bg-[#1a242f] text-[#aebbc5]"
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <p className="mt-7 text-base text-[#5a6b78]">
              Enter: switch source · Back: close
            </p>
          </div>
        </div>
      )}

      {/* Remote hints (top-right, transient). Up = sources is the one binding
          nobody guesses — Left/Right/Enter behave like every other player, but
          the escape hatch for a stuttering source does not — and it is exactly
          what someone needs when the picture stalls. Clear of the failover
          notice (top-left), the OSD (bottom) and the Skip/Next card
          (bottom-right); hidden while the picker owns the screen. */}
      <TvKeyHints
        id="vod"
        suppressed={pickerOpen || exhausted}
        hints={[
          { keys: "Enter", label: "Play / pause" },
          { keys: "◀ ▶", label: `Skip ${SEEK_STEP_S} seconds` },
          { keys: "▲", label: "Source list" },
          { keys: "▼", label: "Subtitles" },
        ]}
        footer="Buffering or stuck? Press ▲ and pick another source."
      />

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

      {/* Seeking a remux restarts the relay's encoder at the new position, so
          there are a few seconds with no picture. Say so — otherwise it reads
          as the stream having died. */}
      {seeking && !notice && (
        <div className="absolute top-10 left-12 bg-[#0f171e]/90 ring-1 ring-white/10 rounded-xl px-6 py-4 animate-fade-in">
          <p className="text-xl font-semibold text-white">
            Seeking to {fmtClock(remuxBase)}…
          </p>
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
