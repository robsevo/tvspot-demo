"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type Hls from "hls.js"; // type only — the library is imported lazily below
import { Play, Pause, Maximize, Minimize, SkipBack, SkipForward, Monitor, Cast, Volume2, VolumeX, Volume1, PictureInPicture2, Captions, Languages } from "lucide-react";
import { castMedia, loadCastSDK, endCastSession } from "@/lib/cast";
import { setPlaybackActive } from "@/lib/playbackState";
import type { SubtitleTrack } from "@/lib/subtitles";

/** A caption/subtitle track the <video> element is already carrying — hls.js's
 *  decoded CEA-608, or a track iOS's native HLS engine built itself. */
interface CcTrack {
  /** Index into video.textTracks — the handle we set `mode` on. */
  index: number;
  label: string;
  lang: string;
}

/** One row in the CC menu. Native tracks already exist on the element; external
 *  ones are subtitle FILES that aren't downloaded until picked. */
type CcOption =
  | { key: string; label: string; lang: string; kind: "native"; index: number }
  | { key: string; label: string; lang: string; kind: "ext"; url: string };

/** Remembered CC choice, so turning captions on survives channel/title changes. */
const CC_PREF_KEY = "tvspot_cc_pref";

interface CcPref {
  enabled: boolean;
  /** Preferred language code; we re-match by language on the next stream. */
  lang: string;
}

function readCcPref(): CcPref {
  if (typeof window === "undefined") return { enabled: false, lang: "en" };
  try {
    const raw = localStorage.getItem(CC_PREF_KEY);
    if (!raw) return { enabled: false, lang: "en" };
    const p = JSON.parse(raw);
    return { enabled: Boolean(p?.enabled), lang: typeof p?.lang === "string" ? p.lang : "en" };
  } catch {
    return { enabled: false, lang: "en" };
  }
}

function writeCcPref(pref: CcPref) {
  try { localStorage.setItem(CC_PREF_KEY, JSON.stringify(pref)); } catch {}
}

/** Resting caption offset when the video frame hasn't been measured yet.
 *  env() is Chrome 69+, and an engine that doesn't understand a value DROPS THE
 *  WHOLE DECLARATION — on the TV's Chromium 63 that removed `bottom` entirely
 *  and the absolutely-positioned overlay fell back to its static position, i.e.
 *  captions rendered at the TOP of the picture. Only use env() where it parses. */
const CC_BOTTOM_FALLBACK =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" &&
  CSS.supports("bottom", "calc(0.75rem + env(safe-area-inset-bottom, 0px))")
    ? "calc(0.75rem + env(safe-area-inset-bottom, 0px))"
    : "0.75rem";

/** One styled run of caption text; a rendered caption line is a list of these. */
interface CcSeg { text: string; i: boolean; b: boolean; u: boolean }
type CcLine = CcSeg[];

/**
 * Cue → display lines, keeping only the formatting we draw (italic/bold/
 * underline — italics matter: subtitle files use them for off-screen voices).
 * getCueAsHTML() is the reliable reader: the browser has already parsed the
 * VTT markup, decoded entities, and (for CEA-608) assembled the row text, so
 * walking its fragment beats regexing cue.text. Whitespace runs collapse to a
 * single space — 608 rows arrive padded with alignment spaces from the
 * broadcast 32-column grid, which only make sense in that grid's monospace
 * layout, not in ours.
 */
function cueToLines(cue: TextTrackCue): CcLine[] {
  const lines: CcLine[] = [[]];
  const pushText = (raw: string, fmt: { i: boolean; b: boolean; u: boolean }) => {
    raw.split("\n").forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      const text = part.replace(/\s+/g, " ");
      if (text) lines[lines.length - 1].push({ text, ...fmt });
    });
  };
  const walk = (node: Node, fmt: { i: boolean; b: boolean; u: boolean }) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.nodeValue ?? "", fmt);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.nodeName.toLowerCase();
    if (tag === "br") { lines.push([]); return; }
    const next = {
      i: fmt.i || tag === "i" || tag === "em",
      b: fmt.b || tag === "b" || tag === "strong",
      u: fmt.u || tag === "u",
    };
    node.childNodes.forEach((c) => walk(c, next));
  };

  const none = { i: false, b: false, u: false };
  const c = cue as VTTCue & { getCueAsHTML?: () => DocumentFragment; text?: string };
  let walked = false;
  if (typeof c.getCueAsHTML === "function") {
    try {
      c.getCueAsHTML().childNodes.forEach((n) => walk(n, none));
      walked = true;
    } catch {}
  }
  if (!walked && typeof c.text === "string") {
    pushText(c.text.replace(/<[^>]*>/g, ""), none);
  }

  // Trim line edges (interior spacing between runs stays), drop blank lines.
  const out: CcLine[] = [];
  for (const line of lines) {
    const segs = line.map((s) => ({ ...s }));
    while (segs.length) {
      segs[0].text = segs[0].text.replace(/^\s+/, "");
      if (segs[0].text) break;
      segs.shift();
    }
    while (segs.length) {
      const last = segs[segs.length - 1];
      last.text = last.text.replace(/\s+$/, "");
      if (last.text) break;
      segs.pop();
    }
    if (segs.length) out.push(segs);
  }
  return out;
}

/** Same flattening as linesFromActiveCues, but for the cues active at an
 *  EXPLICIT time rather than the browser's `track.activeCues`. Used when the
 *  media clock and the cue clock don't share a zero — a resumed relay remux
 *  plays from &start=<offset> so video.currentTime is 0-based from there, while
 *  the WebVTT cues are episode-absolute. We look up cues at currentTime+offset
 *  instead of trusting activeCues, which would show the wrong line. */
function linesAtTime(track: TextTrack, t: number): CcLine[] {
  const cues = track.cues;
  if (!cues) return [];
  const out: CcLine[] = [];
  let prev = "";
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i] as VTTCue;
    if (!(c.startTime <= t && t < c.endTime)) continue;
    for (const line of cueToLines(c)) {
      const key = line.map((s) => s.text).join(" ");
      if (key === prev) continue;
      prev = key;
      out.push(line);
    }
  }
  return out.slice(-4);
}

/**
 * Flatten a track's active cues into the lines to draw. CEA-608 roll-up
 * re-emits lines it has already shown as the window scrolls (hls.js cuts a new
 * cue per scroll step, and both are briefly active), so consecutive duplicate
 * lines collapse. The cap matches the 4-row 608 roll-up window and keeps a
 * pathological cue pile-up from filling the screen — newest lines win.
 */
function linesFromActiveCues(track: TextTrack): CcLine[] {
  const cues = track.activeCues;
  if (!cues) return [];
  const out: CcLine[] = [];
  let prev = "";
  for (let i = 0; i < cues.length; i++) {
    for (const line of cueToLines(cues[i])) {
      const key = line.map((s) => s.text).join(" ");
      if (key === prev) continue;
      prev = key;
      out.push(line);
    }
  }
  return out.slice(-4);
}

/**
 * Does this URL serve an HLS manifest?
 *
 * A plain `.m3u8` substring test covers direct manifests AND the proxy URLs that
 * carry the real manifest in a query param (api.example.com/stream-proxy?url=…m3u8,
 * relay /m3u8?u=…m3u8, VOD /remux.m3u8) — so it stays as the first check.
 *
 * But the relay also serves manifests from EXTENSIONLESS endpoints: /hls (the
 * live ffmpeg remux, whose upstream ends in /ts) and /m3u8 fronting a /ts
 * upstream. Those contain no ".m3u8" anywhere, so the substring test missed them
 * and they fell through to `video.src = src` — silently skipping hls.js on ~21
 * channels (CBC, CityTV, FXX, ESPN2…). That cost them every buffer/stall setting
 * tuned for the relay below, and — because hls.js is what decodes CEA-608 out of
 * the H.264 SEI — it's why those channels had no captions at all.
 *
 * Safari/iOS is unaffected either way: it played these natively via the fallback
 * before and still does via the native branch, since Chrome-family MSE is the
 * only engine that routes into hls.js here.
 */
function isHlsSource(src: string | undefined): boolean {
  if (!src) return false;
  if (src.includes(".m3u8")) return true;
  try {
    const { pathname } = new URL(
      src,
      typeof window !== "undefined" ? window.location.href : "https://placeholder.invalid",
    );
    return /^\/(hls|m3u8)$/i.test(pathname);
  } catch {
    return false;
  }
}

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
  /** For a rolling relay remux (VOD only): the stream reports no finite
   *  duration, so the native scrubber can't seek it. Passing this makes the
   *  progress bar seek by MOVING THE RELAY'S START OFFSET instead —
   *    • `duration` is the file's real runtime (scales the bar),
   *    • `baseTime` is the offset the current stream started at, so the on-screen
   *      position is `baseTime + video.currentTime`,
   *    • dragging the bar calls `onSeek(absoluteSeconds)`; the VOD wrapper
   *      remounts the source at that offset (relay respawns ffmpeg there).
   *  Absent (live, or a natively-seekable file) → the bar seeks natively as
   *  before. Live must never pass this: a live stream has no seekable past. */
  virtualSeek?: {
    duration: number;
    baseTime: number;
    onSeek: (absoluteSeconds: number) => void;
  };
  /** Selectable audio-language tracks (VOD remux only). When there's more than
   *  one, an audio button + menu appears in the control bar; picking one calls
   *  onSelectAudio with that track's playable (signed remux) URL, and the VOD
   *  wrapper swaps to it. Live and single-audio VOD pass nothing → no button. */
  audioTracks?: { rel: number; lang: string; label: string; url: string }[];
  /** The audio URL currently playing (a track's url, or null = default English),
   *  so the menu can check the active one. */
  currentAudioUrl?: string | null;
  onSelectAudio?: (url: string) => void;
  /** Stall-watchdog window (ms) before a recovery strike / failover. Live keeps
   *  the tight default (a stalled channel should fail over fast — another source
   *  has the same content); VOD passes a longer window because cold double-proxied
   *  files legitimately rebuffer for 10-20s and a false failover restarts the
   *  movie, which is worse than waiting. */
  stallMs?: number;
  /** External WebVTT subtitle tracks, rendered as <track> children (VOD).
   *  Live passes nothing: those streams carry CEA-608 caption data in the video
   *  SEI, which hls.js (and iOS's native HLS engine) decode into text tracks on
   *  their own — both land in video.textTracks alongside these, so the CC menu
   *  is built from one list either way. */
  subtitles?: SubtitleTrack[];
  /** Seconds to ADD to video.currentTime to reach the caption clock. Non-zero
   *  only for a resumed relay remux, which plays from &start=<offset> so its
   *  currentTime is 0-based while the WebVTT cues are episode-absolute. Aligns
   *  captions with the audio; 0 (default) leaves everything as it was. */
  captionTimeOffset?: number;
  /** Exposes the internal <video> element to a parent that drives playback
   *  from OUTSIDE the touch overlay — the /tv pages, where remote keys (not
   *  taps) do pause/seek and this ref is the only control surface needed. */
  videoElRef?: React.MutableRefObject<HTMLVideoElement | null>;
  /** TV mode: suppress the touch control chrome entirely (bottom bar, volume,
   *  center play button, channel pill). The TV pages draw their own remote-
   *  driven OSD; the webview also synthesizes mouse events from D-pad input,
   *  which made this overlay pop up over live TV uninvited. Buffering ring,
   *  captions, and notices still render. */
  hideControls?: boolean;
  /** TV mode's control surface for captions: with the touch CC menu hidden,
   *  the remote-driven OSD toggles captions through this handle instead. Same
   *  selection + persistence path as the touch menu (selectCc), so the choice
   *  survives title changes on the TV exactly like it does on the phone. */
  ccRef?: React.MutableRefObject<TvCcHandle | null>;
}

/** Imperative caption control for the TV OSD (see Props.ccRef). */
export interface TvCcHandle {
  /** Cycle captions off→on (remembered language, else first track) or on→off.
   *  Returns the resulting state so the OSD can announce it. */
  toggle(): { on: boolean; available: boolean };
  state(): { on: boolean; available: boolean };
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
  virtualSeek,
  audioTracks,
  currentAudioUrl,
  onSelectAudio,
  captionTimeOffset = 0,
  stallMs = 10000,
  subtitles,
  videoElRef,
  hideControls = false,
  ccRef,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mirror the video element out to a TV parent (see Props.videoElRef).
  useEffect(() => {
    if (!videoElRef) return;
    videoElRef.current = videoRef.current;
    return () => {
      videoElRef.current = null;
    };
  }, [videoElRef]);
  // Was the video playing when the tab was backgrounded? (drives auto-resume).
  const wasPlayingRef = useRef(false);
  // Throttle continue-watching writes so timeupdate (~4Hz) doesn't spam storage.
  const lastProgressSaveRef = useRef(0);
  // Latest onProgress in a ref so the timeupdate effect doesn't re-subscribe when
  // the callback identity changes each render.
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);
  // virtualSeek in a ref too: the timeupdate handler reads it to fill the bar
  // against the file's real runtime, and that effect must not re-subscribe every
  // render (baseTime changes on each seek).
  const virtualSeekRef = useRef(virtualSeek);
  useEffect(() => { virtualSeekRef.current = virtualSeek; }, [virtualSeek]);
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
  // Closed captions. `ccTracks` mirrors the caption tracks the <video> element
  // already carries (hls.js CEA-608 / iOS native HLS) — derived from the element
  // rather than stored, since those producers create tracks on their own
  // schedule. External subtitle FILES are kept separate in `subtitles` and only
  // mounted as a <track> once chosen: attaching hls.js to a <video> makes it
  // walk every text track and briefly flip it out of `disabled` to read cues,
  // which makes the browser download the file. Mounting all of them cost ~690KB
  // of subtitles per movie that nobody asked for (measured), so the selected one
  // is mounted on demand and the rest stay as menu rows.
  const [ccTracks, setCcTracks] = useState<CcTrack[]>([]);
  /** Key of the chosen CcOption, or null for off. */
  const [ccSel, setCcSel] = useState<string | null>(null);
  const [ccMenuOpen, setCcMenuOpen] = useState(false);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const hasAudioChoice = (audioTracks?.length ?? 0) > 1;
  // Which row the menu shows as active. With no explicit pick yet, the relay
  // auto-plays English, so mark the English track rather than leaving the menu
  // with nothing checked while English is clearly playing.
  const activeAudioUrl =
    currentAudioUrl ??
    audioTracks?.find((t) => /^en/.test(t.lang) || /english/i.test(t.label))?.url ??
    null;
  // Captions are drawn by US, not the browser: the selected track runs in
  // `hidden` mode (cues parse and fire cuechange, nothing renders natively) and
  // these are the lines currently on screen. Native ::cue rendering placed
  // CEA-608 cues at the broadcast grid's coordinates — left-cornered, tiny on a
  // phone, jumping between roll-up rows — and sat them behind our control bar,
  // which the browser doesn't know exists.
  const [ccLines, setCcLines] = useState<CcLine[]>([]);
  // Caption font size tracks the player's rendered width (same ~4% ratio the
  // big streaming players use), so text is readable inline on a phone and
  // scales up in fullscreen instead of staying at one CSS size.
  const [ccFontPx, setCcFontPx] = useState(16);
  // Bottom anchor (px from container bottom) placing captions just inside the
  // actual VIDEO FRAME. object-contain letterboxes non-16:9 content, and a
  // container-anchored caption landed in the black bar BELOW a widescreen
  // movie's picture — right where many encodes burn in foreign-language subs,
  // so both caption layers showed at once. Anchoring ~5.5% up into the picture
  // puts our (opaque) box on top of the burned-in line instead of beside it.
  const [ccBottomPx, setCcBottomPx] = useState<number | null>(null);
  // iOS native <video> fullscreen: the video composites outside our DOM there,
  // so the overlay can't follow — tracked to hand rendering back to the browser.
  const [nativeFs, setNativeFs] = useState(false);
  const extTrackRef = useRef<HTMLTrackElement>(null);
  // Preference is applied once per source; after that the user's in-player
  // choice wins and must not be re-overridden by a late-arriving track.
  const ccAutoAppliedRef = useRef(false);
  const controlsTimer = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  // True once THIS source has actually begun rendering frames (first `playing`).
  // FRAG_BUFFERED retries the initial autostart while this is false; once true,
  // a paused element means the user paused on purpose, so nothing re-plays it.
  const startedRef = useRef(false);
  // State mirror of startedRef: a ref can't drive rendering, and we need to know
  // "no frame has appeared for this src yet" to cover the connect window with a
  // branded card instead of a black box (the buffering ring below only renders
  // once `playing` is true, so the FIRST connect showed nothing at all).
  const [started, setStarted] = useState(false);

  // Proactively load Cast SDK so button appears
  useEffect(() => {
    loadCastSDK().then(() => setCastAvailable(true)).catch(() => {});
  }, []);

  // PiP capability — standard API (Chrome/Edge/Android) or WebKit presentation
  // mode (Safari mac/iPhone/iPad). Firefox exposes neither (its PiP is
  // browser-chrome-only), so the button simply doesn't render there.
  //
  // Keyed on `src`, NOT mount: the <video> element only exists once a src is
  // set (the component renders a "No stream available" placeholder while a VOD
  // title resolves or a live channel picks a source), so a mount-only check ran
  // against a null ref and left pipSupported=false forever — the button never
  // appeared. iOS also only reports webkitSupportsPresentationMode reliably once
  // metadata loads, so we re-detect on loadedmetadata too.
  useEffect(() => {
    const video = videoRef.current as any;
    if (!video) return;
    const detect = () => {
      const standard =
        typeof document !== "undefined" &&
        (document as any).pictureInPictureEnabled &&
        !video.disablePictureInPicture;
      const webkit =
        typeof video.webkitSupportsPresentationMode === "function" &&
        video.webkitSupportsPresentationMode("picture-in-picture") &&
        typeof video.webkitSetPresentationMode === "function";
      setPipSupported(Boolean(standard || webkit));
    };
    detect();
    video.addEventListener("loadedmetadata", detect);
    video.addEventListener("canplay", detect);
    return () => {
      video.removeEventListener("loadedmetadata", detect);
      video.removeEventListener("canplay", detect);
    };
  }, [src]);

  // Keep pipActive in sync however PiP is entered/left (our button, the
  // browser's own control, or the PiP window's close button). Keyed on `src`
  // too so the listeners bind to the CURRENT video element (a src→empty→src
  // cycle remounts <video>, giving a fresh ref the mount-only effect missed).
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
  }, [src]);

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
    // Fresh source hasn't started yet — re-arm the FRAG_BUFFERED autostart retry.
    startedRef.current = false;
    setStarted(false);
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

    // Check if it's an HLS URL (see isHlsSource — relay manifests don't all
    // carry a .m3u8 in the URL).
    const isHlsUrl = isHlsSource(src);

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
        // DELIBERATELY NOT SET: highBufferWatchdogPeriod and startFragPrefetch.
        // Both were tried on 2026-07-26 against the rare few-second freeze and
        // reverted the same day when live started skipping. Recorded so the same
        // two knobs don't get re-tried:
        //
        //  - highBufferWatchdogPeriod 2 → 1. The nudge it gates is NOT a free
        //    "step over the gap": gap-controller does
        //    `media.currentTime += (retry + 1) * nudgeOffset`, so with
        //    nudgeMaxRetry 5 a stubborn stall walks the playhead forward
        //    0.2 → 0.4 → 0.6 → 0.8 → 1.0s — up to ~3s of content silently
        //    discarded, each step a visible skip. Halving the window arms that on
        //    the brief hiccups this origin has constantly. (Measured caveat: over
        //    ~9 min across 4 channels the nudge never actually fired at either
        //    value, so this was reverted on mechanism + the report, not on a
        //    reproduction.)
        //  - startFragPrefetch false → true. Reverted because it never did what
        //    it was added for: its guard is `!media && … !config.startFragPrefetch`,
        //    i.e. it only lets the FIRST fragment load before the media element is
        //    attached. It is a startup optimisation, not an ongoing "fetch the
        //    next fragment early", so it cannot deepen the cushion mid-playback.
        //
        // The freeze this was chasing stays handled by the settings above:
        // maxBufferHole 1.5 steps over real holes WITHOUT seeking, and the
        // two-strike stall watchdog below recovers a genuinely dead source.
        // Neither discards content the way a nudge does.
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
        // TV memory diet (hideControls = the 10-foot shell). The 2019 RU7100's
        // webview hard-wedged its renderer mid-movie under the buffer sizing
        // above (60-90s forward + the 60MB default byte cap is more media than
        // that 1GB device survives). Half the runway and a hard byte cap: still
        // rides ~30s upstream blips, but stays inside the TV's memory envelope.
        // Mobile/desktop keep the full cushion.
        ...(hideControls
          ? {
              maxBufferLength: 30,
              maxMaxBufferLength: 45,
              maxBufferSize: 25 * 1000 * 1000,
            }
          : {}),
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
        // If the INITIAL play() failed because segments weren't ready, retry now
        // that we have buffered content. Guarded by startedRef: hls keeps
        // buffering for ~60-90s AFTER a pause, and without this guard every one
        // of those FRAG_BUFFERED events re-issued play() — so pausing a VOD
        // source silently resumed itself a moment later. Once playback has begun,
        // a paused element is the user's choice; leave it paused.
        if (!startedRef.current && video.paused && autoPlay && !cancelled) {
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
  }, [src, autoPlay, isLive, hideControls]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // setPlaybackActive: tell the deploy-reload gates a stream is on screen so a
    // version-skew reload waits for playback to stop instead of interrupting it.
    const onPlayHandler = () => { setPlaying(true); setAwaitingPlay(false); setPlaybackActive(true); onPlay?.(); };
    const onPauseHandler = () => { setPlaying(false); setPlaybackActive(false); onPause?.(); };
    // `playing` (frames actually rendering), not `play` (which fires on the play()
    // CALL, before the initial autostart has really taken) — this is the point
    // after which FRAG_BUFFERED must stop resuming a paused element.
    const onPlayingHandler = () => { startedRef.current = true; setStarted(true); };
    const onTimeHandler = () => {
      // A rolling remux has no finite video.duration, so the bar would sit empty
      // and never fill. With virtualSeek we know the file's real runtime and the
      // offset this stream started at, so position = baseTime + currentTime over
      // the true duration. onTimeUpdate/onProgress stay RELATIVE (video.currentTime):
      // the VOD wrapper adds the offset itself, and double-adding it here would
      // corrupt continue-watching.
      const vs = virtualSeekRef.current;
      if (vs && vs.duration > 0) {
        setProgress(Math.min(1, Math.max(0, (vs.baseTime + video.currentTime) / vs.duration)));
        onTimeUpdate?.(video.currentTime);
        const now = Date.now();
        if (onProgressRef.current && now - lastProgressSaveRef.current > 8000) {
          lastProgressSaveRef.current = now;
          onProgressRef.current(video.currentTime, video.duration);
        }
        return;
      }
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
    video.addEventListener("playing", onPlayingHandler);
    video.addEventListener("timeupdate", onTimeHandler);
    video.addEventListener("ended", onEndedHandler);
    video.addEventListener("error", onErrorHandler);

    return () => {
      video.removeEventListener("play", onPlayHandler);
      video.removeEventListener("pause", onPauseHandler);
      video.removeEventListener("playing", onPlayingHandler);
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

  // The CC menu: tracks already on the element, then subtitle files we could
  // fetch. Labels genuinely collide (hls.js calls its CEA-608 track "English"
  // and an English subtitle file is also "English"), and two identical rows are
  // unpickable — so repeats get numbered.
  const ccOptions = useMemo<CcOption[]>(() => {
    const out: CcOption[] = [];
    const seen = new Map<string, number>();
    const push = (o: CcOption) => {
      const n = (seen.get(o.label) ?? 0) + 1;
      seen.set(o.label, n);
      out.push(n > 1 ? { ...o, label: `${o.label} ${n}` } : o);
    };
    for (const t of ccTracks) {
      push({ key: `n${t.index}`, label: t.label, lang: t.lang, kind: "native", index: t.index });
    }
    for (const s of subtitles ?? []) {
      push({ key: `e${s.id}`, label: s.label, lang: s.lang, kind: "ext", url: s.url });
    }
    return out;
  }, [ccTracks, subtitles]);

  // Memoized: the cuechange effect below keys on this, and a fresh object per
  // render would detach/re-attach the listener (and blank the on-screen lines)
  // every render.
  const ccSelected = useMemo(
    () => ccOptions.find((o) => o.key === ccSel) ?? null,
    [ccOptions, ccSel],
  );
  const ccExt = ccSelected?.kind === "ext" ? ccSelected : null;
  // Surfaces composited outside our DOM (iOS native video fullscreen, the PiP
  // window) can't show the overlay — hand rendering back to the browser there.
  const ccNativeSurface = pipActive || nativeFs;

  // Turn every native caption track off. `disabled` rather than `hidden` is
  // deliberate: hls.js skips parsing cues into a disabled track, so live
  // captions cost nothing while switched off. The SELECTED track gets `hidden`,
  // not `showing` — cues still parse and fire cuechange, but the browser draws
  // nothing; the overlay below is the renderer. (The mode-owner effect flips it
  // to `showing` on native surfaces.)
  const disableNative = useCallback((except = -1) => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.kind !== "captions" && t.kind !== "subtitles") continue;
      if (t === extTrackRef.current?.track) continue; // ours; driven by mount
      t.mode = i === except ? "hidden" : "disabled";
    }
  }, []);

  // Pick a menu option (or null for off).
  const selectCc = useCallback(
    (opt: CcOption | null) => {
      ccAutoAppliedRef.current = true;
      setCcSel(opt ? opt.key : null);
      // An external pick mounts its <track> (below); natives all go off.
      disableNative(opt && opt.kind === "native" ? opt.index : -1);
      writeCcPref({ enabled: Boolean(opt), lang: opt?.lang || readCcPref().lang || "en" });
    },
    [disableNative],
  );

  // New source → the remembered preference gets one fresh chance to apply
  // (e.g. captions stay on when the user changes channel).
  //
  // Declared BEFORE the track-sync effect on purpose: effects run in declaration
  // order, so this clears the flag before sync() reads it. Reversed, sync() sees
  // the previous source's `true`, skips the auto-apply, and captions only come
  // back on the next poll tick.
  useEffect(() => {
    ccAutoAppliedRef.current = false;
    setCcMenuOpen(false);
  }, [src]);

  // Mirror the element's NATIVE text tracks into state.
  //
  // Live captions arrive LATE and unpredictably: hls.js only creates the CEA-608
  // track when it parses the first caption cue, which may be many seconds into
  // playback (or never, on a channel with no captions). So this can't be a
  // one-shot read on mount — it has to keep listening, which is also what makes
  // the CC button appear only on channels that genuinely have captions.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;

    const sync = () => {
      const list: CcTrack[] = [];
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t.kind !== "captions" && t.kind !== "subtitles") continue;
        if (t === extTrackRef.current?.track) continue; // our <track>, listed separately
        list.push({ index: i, label: t.label || t.language || `Track ${i + 1}`, lang: t.language });
      }
      setCcTracks((prev) =>
        prev.length === list.length &&
        prev.every((p, i) => p.index === list[i].index && p.label === list[i].label)
          ? prev // identical → keep the reference so dependents don't re-run
          : list,
      );
    };

    sync();
    tracks.addEventListener("addtrack", sync);
    tracks.addEventListener("removetrack", sync);
    tracks.addEventListener("change", sync);
    // Native iOS HLS can populate tracks without firing addtrack reliably; a
    // couple of cheap re-reads around startup cover it.
    const poll = setInterval(sync, 2000);
    return () => {
      tracks.removeEventListener("addtrack", sync);
      tracks.removeEventListener("removetrack", sync);
      tracks.removeEventListener("change", sync);
      clearInterval(poll);
    };
  }, [src]);

  // Single owner of the SELECTED track's mode. Normally `hidden` (cues parse,
  // cuechange fires, the overlay draws); on a native surface (iOS video
  // fullscreen, PiP window) `showing`, because those composite outside our DOM
  // and the browser's own renderer — styled via ::cue — is the only one that
  // can follow the video there. An effect rather than part of selectCc because
  // setting mode before the browser has the element does nothing, and Safari
  // can attach an ext <track>'s TextTrack a tick after the element mounts —
  // hence the load listener + short retry.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ccSelected) return;
    const mode: TextTrackMode = ccNativeSurface ? "showing" : "hidden";
    const apply = () => {
      try {
        const t =
          ccSelected.kind === "native"
            ? video.textTracks[ccSelected.index]
            : extTrackRef.current?.track;
        if (t && t.mode !== mode) t.mode = mode;
      } catch {}
    };
    apply();
    const el = ccSelected.kind === "ext" ? extTrackRef.current : null;
    el?.addEventListener("load", apply);
    const t = setTimeout(apply, 300);
    return () => { el?.removeEventListener("load", apply); clearTimeout(t); };
  }, [ccSelected, ccNativeSurface, ccTracks, src]);

  // The renderer's input: mirror the selected track's active cues into state.
  // cuechange fires on hidden tracks, so this works identically for hls.js
  // CEA-608, iOS-native caption tracks, and our ext WebVTT <track>.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ccSelected) {
      setCcLines([]);
      return;
    }
    const track =
      ccSelected.kind === "native"
        ? video.textTracks[ccSelected.index]
        : extTrackRef.current?.track;
    if (!track) {
      setCcLines([]);
      return;
    }
    // Hold a caption through the GAP to the next one rather than blinking to
    // blank the instant its own cue's endTime passes. Cues (especially CEA-608
    // roll-up and tightly-timed subtitle files) often end a beat before the
    // next begins, so the raw activeCues signal flickers off-and-on and reads
    // as captions "switching too fast". New cue content still swaps in
    // immediately — only the TRAILING edge lingers, and only up to LINGER_MS,
    // so genuine silence still clears the screen. No latency or desync is
    // added to captions themselves; this only extends how long the last one
    // stays up during a pause, matching how streaming players present them.
    const LINGER_MS = 1200;
    let lingerTimer: ReturnType<typeof setTimeout> | null = null;
    const apply = (lines: CcLine[]) => {
      if (lingerTimer) { clearTimeout(lingerTimer); lingerTimer = null; }
      if (lines.length) setCcLines(lines);
      else lingerTimer = setTimeout(() => setCcLines([]), LINGER_MS);
    };

    // When the media clock and the cue clock DON'T share a zero (a resumed remux
    // — see captionTimeOffset), the browser's own activeCues/cuechange are
    // computed against currentTime and would surface the wrong line, so poll and
    // look cues up at currentTime+offset ourselves. With no offset (the usual
    // case) keep the cheap cuechange path, which only fires on cue boundaries.
    if (captionTimeOffset) {
      const tick = () => apply(linesAtTime(track, (video.currentTime || 0) + captionTimeOffset));
      tick();
      const id = setInterval(tick, 300);
      return () => {
        clearInterval(id);
        if (lingerTimer) clearTimeout(lingerTimer);
        setCcLines([]);
      };
    }

    const update = () => apply(linesFromActiveCues(track));
    update();
    track.addEventListener("cuechange", update);
    return () => {
      if (lingerTimer) clearTimeout(lingerTimer);
      track.removeEventListener("cuechange", update);
      setCcLines([]);
    };
  }, [ccSelected, ccTracks, src, captionTimeOffset]);

  // Caption geometry: font scales with the player's on-screen width (~4%,
  // clamped — one size did not fit both a 375px inline player and fullscreen),
  // and the bottom anchor is computed from the letterboxed video frame (see
  // ccBottomPx). Recomputed on container resize AND loadedmetadata, since the
  // frame rect needs videoWidth/videoHeight.
  useEffect(() => {
    const el = containerRef.current;
    const video = videoRef.current;
    // ResizeObserver is Chrome 64+. Bailing when it's missing meant this whole
    // effect never ran on the TV's Chromium 63: ccFontPx stayed at its initial
    // 16px (unreadably small across a room) and ccBottomPx stayed null. It is an
    // OPTIONAL upgrade here, not a prerequisite — the measurement itself only
    // needs clientWidth/Height, which every engine has.
    if (!el || !video) return;
    const compute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      // A 10-foot screen needs bigger text than a 375px phone, but 52px filled
      // too much of the frame across a room — pulled back to a 40px TV ceiling
      // (and a slightly gentler width factor) so captions read without dominating
      // the picture. `hideControls` is the TV shell's signal.
      const maxPx = hideControls ? 40 : 26;
      if (w > 0) setCcFontPx(Math.round(Math.min(maxPx, Math.max(13, w * 0.03))));
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw > 0 && vh > 0 && w > 0 && h > 0) {
        const scale = Math.min(w / vw, h / vh);
        const contentH = vh * scale;
        const letterbox = (h - contentH) / 2;
        setCcBottomPx(Math.round(letterbox + contentH * 0.055));
      } else {
        setCcBottomPx(null);
      }
    };
    compute();
    // Prefer ResizeObserver where it exists; fall back to window resize so
    // legacy engines still track orientation/fullscreen changes.
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(compute) : null;
    if (ro) ro.observe(el);
    else window.addEventListener("resize", compute);
    video.addEventListener("loadedmetadata", compute);
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", compute);
      video.removeEventListener("loadedmetadata", compute);
    };
  }, [src, hideControls]);

  // Auto-apply the remembered preference once per source, as soon as there's
  // something to apply it to. Prefers a real embedded caption track (live
  // CEA-608) over an external subtitle file, then falls back to language match.
  useEffect(() => {
    if (ccAutoAppliedRef.current) return;
    const pref = readCcPref();
    if (!pref.enabled) return;
    const opts = ccOptions;
    if (!opts.length) return;
    const byLang = (o: CcOption) =>
      o.lang && o.lang.toLowerCase().startsWith(pref.lang.toLowerCase());
    const match =
      opts.find((o) => o.kind === "native" && byLang(o)) ??
      opts.find(byLang) ??
      opts[0];
    selectCc(match);
  }, [ccOptions, selectCc]);

  // TV caption handle (see Props.ccRef): kept fresh with the current options/
  // selection so the remote OSD's toggle always acts on live state.
  useEffect(() => {
    if (!ccRef) return;
    const snapshot = () => ({ on: ccSel !== null, available: ccOptions.length > 0 });
    ccRef.current = {
      state: snapshot,
      toggle: () => {
        if (ccSel !== null) {
          selectCc(null);
          return { on: false, available: ccOptions.length > 0 };
        }
        const lang = readCcPref().lang;
        const byLang = (o: CcOption) =>
          o.lang && o.lang.toLowerCase().startsWith(lang.toLowerCase());
        const match =
          ccOptions.find((o) => o.kind === "native" && byLang(o)) ??
          ccOptions.find(byLang) ??
          ccOptions[0] ??
          null;
        if (match) selectCc(match);
        return { on: match !== null, available: ccOptions.length > 0 };
      },
    };
    return () => {
      ccRef.current = null;
    };
  }, [ccRef, ccSel, ccOptions, selectCc]);

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
  // (Esc, swipe-down, or the native iOS video fullscreen controls). Keyed on
  // `src` so the webkit listeners bind to the CURRENT video element — the
  // <video> only exists once a src is set, so a mount-only effect ran against
  // a null ref and iOS's begin/endfullscreen events were never observed.
  // Those events also drive `nativeFs`: iOS video fullscreen is the one
  // fullscreen where our DOM (caption overlay included) can't follow.
  useEffect(() => {
    const onFsChange = () => {
      const doc = document as any;
      setFullscreen(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
    };
    const onBegin = () => { setFullscreen(true); setNativeFs(true); };
    const onEnd = () => { setFullscreen(false); setNativeFs(false); };
    const video = videoRef.current as any;
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    video?.addEventListener?.("webkitbeginfullscreen", onBegin);
    video?.addEventListener?.("webkitendfullscreen", onEnd);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      video?.removeEventListener?.("webkitbeginfullscreen", onBegin);
      video?.removeEventListener?.("webkitendfullscreen", onEnd);
    };
  }, [src]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    // The CC / audio menus live inside the controls overlay — auto-hiding while
    // the user is picking a track would snatch it away mid-read.
    if (ccMenuOpen || audioMenuOpen) return;
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 4000);
  }, [ccMenuOpen, audioMenuOpen]);

  // Auto-hide the controls a few seconds after playback starts/resumes (they used
  // to stay up forever until the first tap). While paused, keep them visible.
  useEffect(() => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    if (playing && !ccMenuOpen && !audioMenuOpen) {
      controlsTimer.current = setTimeout(() => setControlsVisible(false), 4000);
    } else {
      // Paused, or a menu is open and needs its container to stay put.
      setControlsVisible(true);
    }
    return () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); };
  }, [playing, ccMenuOpen, audioMenuOpen]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    // Remux (rolling HLS): there is nothing to seek IN — hand the absolute target
    // to the wrapper, which remounts the source at a new relay start offset.
    const vs = virtualSeekRef.current;
    if (vs && vs.duration > 0) {
      // Leave a little headroom: starting the relay in the final seconds yields a
      // stream that ends before it can play.
      vs.onSeek(Math.min(vs.duration - 10, pos * vs.duration));
      return;
    }
    // Native path: live reports a non-finite duration (Infinity/NaN) — seeking by
    // ratio would set currentTime to a non-finite value and throw. Only seek on a
    // real (finite, seekable) duration.
    const d = video.duration;
    if (!Number.isFinite(d) || d <= 0) return;
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
      onMouseMove={hideControls ? undefined : showControls}
      onTouchStart={hideControls ? undefined : showControls}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain cursor-pointer"
        playsInline
        poster={poster}
        onClick={hideControls ? undefined : togglePlay}
        x-webkit-airplay="allow"
      >
        {/* Only the CHOSEN subtitle file is mounted — see the ccSel state note:
            hls.js touching a text track is enough to make the browser fetch it,
            so unmounted options cost nothing until picked. Same-origin WebVTT
            (/api/subtitles/vtt), hence no crossOrigin: setting it would force a
            CORS mode the auth cookie wouldn't ride along with. Keyed by url so
            switching subtitle picks remounts a clean element. */}
        {ccExt && (
          <track
            key={ccExt.url}
            ref={extTrackRef}
            kind="subtitles"
            src={ccExt.url}
            srcLang={ccExt.lang}
            label={ccExt.label}
          />
        )}
      </video>

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

      {/* CONNECTING cover — the window between choosing a source and the first
          frame. Without it the user stares at a black box: the buffering ring
          below is gated on `playing`, which is false until playback actually
          begins, so the initial tune-in had NO indicator at all. Branded with the
          channel/title so a zap looks like a channel change rather than a crash,
          and it disappears the instant a frame lands.

          LIVE ONLY. VOD already shows an indicator during its connect — the center
          play button turns into an awaitingPlay spinner — so rendering this on top
          of it put TWO spinners on screen at once. Live is the case that had none. */}
      {isLive && src && !started && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#0b1016] pointer-events-none">
          {poster ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={poster}
              alt=""
              className="max-h-[28%] max-w-[45%] object-contain opacity-90"
            />
          ) : null}
          <div className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full border-[3px] border-white/20 border-t-cyan-400 border-r-brand animate-spin" />
            <span className="text-white/80 text-sm sm:text-base font-medium">
              {channelName || title ? `Tuning ${channelName || title}…` : "Tuning…"}
            </span>
          </div>
          {/* Rebuffering DURING tune-in reads as three dots under the channel
              name, not a second ring. See the buffering block below for why two
              rings could appear at once; this is the same information in a form
              that doesn't look like the app double-loading. */}
          {buffering && (
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-white/45 animate-pulse"
                  style={{ animationDelay: `${i * 180}ms`, animationDuration: "1.2s" }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Buffering ring — shown whenever the stream is rebuffering.
          `started` is required, not just `playing`: those come from DIFFERENT
          media events. `playing` is set by the `play` event, which fires when
          playback is REQUESTED; `started` by the `playing` event, which fires
          when frames actually roll. On a slow live tune-in the gap between them
          is exactly when buffering kicks in — so `buffering && playing` was true
          while the Tuning overlay (gated on `!started`) was still up, and the
          user saw TWO loading circles. Requiring `started` makes the two states
          mutually exclusive: the overlay owns tune-in (with the dots above), the
          ring owns rebuffering after playback has begun. */}
      {buffering && playing && started && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-14 h-14 rounded-full border-[3px] border-white/15 border-t-cyan-400 border-r-brand animate-spin" />
        </div>
      )}

      {/* Caption overlay — OUR renderer for the hidden selected track. Bottom-
          centered stacked lines (broadcast-grid positioning is deliberately
          discarded), font scaled to player width, lifted clear of the control
          bar while it's up. Hidden on native surfaces (iOS fullscreen / PiP),
          where the track flips to `showing` and ::cue takes over, and while
          casting (local playback is stopped). pointer-events-none: taps pass
          through to play/pause exactly as before. */}
      {ccLines.length > 0 && !casting && !ccNativeSurface && (
        <div
          className="tv-cc-overlay absolute inset-x-3 z-10 flex flex-col items-center justify-end pointer-events-none transition-[bottom] duration-200"
          style={{
            fontSize: `${ccFontPx}px`,
            // Inside the picture (ccBottomPx accounts for letterboxing), but
            // never behind the control bar while it's up.
            bottom: controlsVisible
              ? `${Math.max(84, ccBottomPx ?? 0)}px`
              : ccBottomPx != null
                ? `${ccBottomPx}px`
                : CC_BOTTOM_FALLBACK,
          }}
        >
          {/* One OPAQUE box around all lines: some movie/series encodes carry
              burned-in foreign-language subs in the picture at this exact
              spot — a translucent per-line pill let them bleed through and
              read as two caption layers. Solid black masks them. */}
          <div className="cc-box">
            {ccLines.map((line, i) => (
              <span key={i} className="cc-line">
                {line.map((seg, j) => (
                  <span
                    key={j}
                    className={`${seg.i ? "italic" : ""} ${seg.b ? "font-bold" : ""} ${seg.u ? "underline" : ""}`}
                  >
                    {seg.text}
                  </span>
                ))}
              </span>
            ))}
          </div>
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
      {channelName && controlsVisible && !hideControls && (
        <div className="absolute top-4 left-4 bg-black/70 text-white text-sm font-medium px-3 py-1.5 rounded-full animate-fade-in">
          {channelName}
        </div>
      )}

      {/* Center play button when paused. z-30 + pointer-events so it sits ABOVE the
          bottom controls overlay — on the short VOD/series player that overlay
          otherwise reached the center and swallowed the tap. After a tap, the
          icon becomes a spinner until playback actually starts (or errors) —
          a slow source must never look like a dead button. */}
      {!playing && !casting && !hideControls && (
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
      {!hideControls && (
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
          {/* gap-0.5 + 40px-wide buttons below 640px: with captions the row is
              8 buttons, and at the old 44px + gap-3/gap-2 spacing it measured
              412px — on a 375px phone that pushed Cast half off-screen and
              Fullscreen fully off (the CC button popping in mid-watch is what
              tipped it over). 40×44 tap targets, everything fits at 360px. */}
          <div className="flex items-center gap-0.5 sm:gap-3">
            {channelDown && (
              <button
                onClick={channelDown}
                className="text-white/80 hover:text-white min-w-[40px] min-h-[44px] sm:min-w-[44px] flex items-center justify-center"
                aria-label="Previous channel"
              >
                <SkipBack className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={togglePlay}
              className="text-white min-w-[40px] min-h-[44px] sm:min-w-[44px] flex items-center justify-center"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
            </button>
            {channelUp && (
              <button
                onClick={channelUp}
                className="text-white/80 hover:text-white min-w-[40px] min-h-[44px] sm:min-w-[44px] flex items-center justify-center"
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
                className="text-white/80 hover:text-white min-w-[40px] min-h-[44px] sm:min-w-[44px] flex items-center justify-center"
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

          <div className="flex items-center gap-0.5 sm:gap-2">
            {/* Closed captions. On LIVE the button is ALWAYS there: caption
                tracks only materialize once the first cue parses, which can be
                seconds-to-never depending on what's airing — and a button that
                appears only then is invisible at the exact moment a user goes
                looking for it ("don't see the option to turn on captions").
                With no track yet, the menu explains instead of doing nothing.
                VOD keeps the offer-gated button: its subtitle list arrives
                up-front from the API, so absence genuinely means none exist. */}
            {/* Audio-language menu — VOD remux with more than one track. Mirrors
                the CC menu; picking a language swaps the source to that track's
                remux (the wrapper keeps the playback position). */}
            {hasAudioChoice && (
              <div className="relative">
                {audioMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setAudioMenuOpen(false)}
                      aria-hidden="true"
                    />
                    <div
                      role="menu"
                      aria-label="Audio language"
                      className="absolute bottom-full right-0 mb-2 z-50 min-w-[10rem] max-h-56 overflow-y-auto rounded-xl bg-black/95 backdrop-blur-sm border border-white/10 py-1 shadow-xl"
                    >
                      <p className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-wide text-white/40">Audio</p>
                      {audioTracks!.map((t) => {
                        const active = activeAudioUrl === t.url;
                        return (
                          <button
                            key={t.rel}
                            role="menuitemradio"
                            aria-checked={active}
                            onClick={() => { onSelectAudio?.(t.url); setAudioMenuOpen(false); }}
                            className={`w-full text-left px-4 py-2 min-h-[44px] text-sm transition-colors ${
                              active ? "text-brand font-medium" : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                <button
                  onClick={() => setAudioMenuOpen((o) => !o)}
                  className="min-w-[40px] min-h-[44px] sm:min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  aria-label="Audio language"
                  aria-haspopup="menu"
                  aria-expanded={audioMenuOpen}
                >
                  <Languages className="w-4 h-4" />
                </button>
              </div>
            )}
            {(ccOptions.length > 0 || isLive) && (
              <div className="relative">
                {ccMenuOpen && (
                  <>
                    {/* Tap-away closer sized to the player, so the menu doesn't
                        get stuck open behind the auto-hiding controls. */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setCcMenuOpen(false)}
                      aria-hidden="true"
                    />
                    <div
                      role="menu"
                      aria-label="Closed captions"
                      className="absolute bottom-full right-0 mb-2 z-50 min-w-[10rem] max-h-56 overflow-y-auto rounded-xl bg-black/95 backdrop-blur-sm border border-white/10 py-1 shadow-xl"
                    >
                      {ccOptions.length === 0 ? (
                        // Live, no caption track yet. Left open, this swaps to
                        // real rows the moment the first cue parses. Mentions
                        // the source picker because caption presence is a
                        // per-SOURCE property: providers that re-encode video
                        // strip CEA-608 (verified: fox-news sources 1-2 none,
                        // 3-4 captioned, same minute) — switching sources is
                        // the actual remedy, not waiting.
                        <p className="px-4 py-3 text-xs leading-relaxed text-white/60 w-56">
                          No captions in this stream yet. Not every source
                          carries them — try another source below the player,
                          or wait a moment after a captioned show starts.
                        </p>
                      ) : (
                        <>
                          <button
                            role="menuitemradio"
                            aria-checked={ccSel === null}
                            onClick={() => { selectCc(null); setCcMenuOpen(false); }}
                            className={`w-full text-left px-4 py-2 min-h-[44px] text-sm transition-colors ${
                              ccSel === null ? "text-brand font-medium" : "text-white/80 hover:bg-white/10"
                            }`}
                          >
                            Off
                          </button>
                          {ccOptions.map((o) => (
                            <button
                              key={o.key}
                              role="menuitemradio"
                              aria-checked={ccSel === o.key}
                              onClick={() => { selectCc(o); setCcMenuOpen(false); }}
                              className={`w-full text-left px-4 py-2 min-h-[44px] text-sm transition-colors ${
                                ccSel === o.key ? "text-brand font-medium" : "text-white/80 hover:bg-white/10"
                              }`}
                            >
                              {o.label}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                )}
                <button
                  onClick={() => {
                    // One option (the common case: a single CEA-608 feed) → the
                    // menu would be a two-item formality. Toggle it directly.
                    // Zero options (live, no track yet) → the menu, which
                    // explains where captions are.
                    if (ccOptions.length === 1) selectCc(ccSel ? null : ccOptions[0]);
                    else setCcMenuOpen((o) => !o);
                  }}
                  className={`min-w-[40px] min-h-[44px] sm:min-w-[44px] flex items-center justify-center ${
                    ccSel ? "text-brand" : "text-white/80 hover:text-white"
                  }`}
                  aria-label={ccSel ? "Closed captions on" : "Closed captions off"}
                  aria-haspopup={ccOptions.length !== 1 ? "menu" : undefined}
                  aria-expanded={ccOptions.length !== 1 ? ccMenuOpen : undefined}
                >
                  <Captions className="w-4 h-4" />
                </button>
              </div>
            )}
            {/* Picture-in-picture (live TV) — the stream keeps playing in the
                floating window; the inline area shows the placeholder overlay. */}
            {isLive && pipSupported && (
              <button
                onClick={togglePip}
                className={`min-w-[40px] min-h-[44px] sm:min-w-[44px] flex items-center justify-center ${
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
                className={`min-w-[40px] min-h-[44px] sm:min-w-[44px] flex items-center justify-center ${
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
              className="text-white/80 hover:text-white min-w-[40px] min-h-[44px] sm:min-w-[44px] flex items-center justify-center"
              aria-label="AirPlay"
            >
              <Monitor className="w-4 h-4" />
            </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="text-white/80 hover:text-white min-w-[40px] min-h-[44px] sm:min-w-[44px] flex items-center justify-center"
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}