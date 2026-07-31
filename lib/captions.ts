/**
 * Shared live/VOD caption engine.
 *
 * Lifted verbatim out of VideoPlayer so the channel PREVIEW can render the same
 * captions the full player does. Everything here is pure and module-level — cue
 * parsing, the reading-paced re-wrap, roll-up collapsing — so there is exactly
 * ONE implementation of the 608 layout rules to keep tuned, not two that drift.
 *
 * See VideoPlayer for how these compose at runtime; the comments below are the
 * original ones and still describe the only copy of this logic.
 */

/** A caption/subtitle track the <video> element is already carrying — hls.js's
 *  decoded CEA-608, or a track iOS's native HLS engine built itself. */
export interface CcTrack {
  /** Index into video.textTracks — the handle we set `mode` on. */
  index: number;
  label: string;
  lang: string;
}

/** One row in the CC menu. Native tracks already exist on the element; external
 *  ones are subtitle FILES that aren't downloaded until picked. */
export type CcOption =
  | { key: string; label: string; lang: string; kind: "native"; index: number }
  | { key: string; label: string; lang: string; kind: "ext"; url: string };

/** Remembered CC choice, so turning captions on survives channel/title changes. */
export const CC_PREF_KEY = "tvspot_cc_pref";

export interface CcPref {
  enabled: boolean;
  /** Preferred language code; we re-match by language on the next stream. */
  lang: string;
}

export function readCcPref(): CcPref {
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

export function writeCcPref(pref: CcPref) {
  try { localStorage.setItem(CC_PREF_KEY, JSON.stringify(pref)); } catch {}
}

/** Resting caption offset when the video frame hasn't been measured yet.
 *  env() is Chrome 69+, and an engine that doesn't understand a value DROPS THE
 *  WHOLE DECLARATION — on the TV's Chromium 63 that removed `bottom` entirely
 *  and the absolutely-positioned overlay fell back to its static position, i.e.
 *  captions rendered at the TOP of the picture. Only use env() where it parses. */
export const CC_BOTTOM_FALLBACK =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" &&
  CSS.supports("bottom", "calc(0.75rem + env(safe-area-inset-bottom, 0px))")
    ? "calc(0.75rem + env(safe-area-inset-bottom, 0px))"
    : "0.75rem";

/** Hold a caption through the GAP to the next one rather than blinking to blank
 *  the instant its own cue's endTime passes. Cues (especially CEA-608 roll-up and
 *  tightly-timed subtitle files) often end a beat before the next begins, so the
 *  raw activeCues signal flickers off-and-on and reads as captions "switching too
 *  fast". New cue content still swaps in immediately — only the TRAILING edge
 *  lingers, so genuine silence still clears the screen. */
export const CC_LINGER_MS = 1200;

/** One styled run of caption text; a rendered caption line is a list of these. */
export interface CcSeg { text: string; i: boolean; b: boolean; u: boolean }
export type CcLine = CcSeg[];
/** What's on screen right now, plus whether it came from more than one cue —
 *  i.e. a live roll-up window rather than one self-contained caption. ccWrap
 *  lays those out differently; see there. */
export interface CcSource { lines: CcLine[]; streaming: boolean }
export const CC_EMPTY: CcSource = { lines: [], streaming: false };

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
export function cueToLines(cue: TextTrackCue): CcLine[] {
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

/* ── Caption line layout ────────────────────────────────────────────────────
   The line breaks a caption ARRIVES with are not breaks a person would make.
   CEA-608 cuts every line at column 32 of a fixed broadcast grid with no regard
   for grammar (and hls.js emits one cue per grid ROW), so live captions showed
   up pre-broken mid-phrase — "…TAKE A LOOK AT THE" / "WEATHER FOR TOMORROW".
   Subtitle files are better but still arrive with the author's breaks, often
   three or four short lines. So we throw the incoming breaks away and re-wrap
   the words ourselves against the standard subtitling rules (BBC/Netflix house
   style, and what every streaming player converges on): two lines, ~42
   characters each, broken where a sentence or phrase actually ends. */
export const CC_MAX_CHARS = 42;
/** Two lines is the target, and the lever for hitting it is WIDTH, not dropping
 *  text: when a caption won't fit inside the 42-character reading measure the
 *  lines widen to here instead of a third appearing. Two lines of this hold
 *  ~112 characters, which covers all but the rare long caption. Bounded, though
 *  — a 90-character line spanning a TV is not readable either. */
export const CC_MAX_CHARS_RELAXED = 56;
/** How far UP into the picture the caption box sits, as a fraction of the
 *  picture's height (not the container's — letterboxing is accounted for
 *  separately). Clear of the very bottom edge, and above where encodes tend to
 *  burn in their own subtitle line. */
export const CC_PICTURE_LIFT = 0.09;
/** A line may break early for a good grammatical reason, but not so early that
 *  the box turns ragged — an early break must still fill this much of the line. */
export const CC_MIN_FILL = 0.6;
/** How hard uneven line lengths count against an otherwise good break, when
 *  choosing between two-line splits. Calibrated so punctuation (a real sentence
 *  or clause boundary) still wins at almost any imbalance, while the weaker
 *  "break before a preposition" preference loses to an even pair — otherwise a
 *  two-word line ends up sitting above a full one. */
export const CC_BALANCE_WEIGHT = 90;

/** Words that start the next phrase: breaking BEFORE one reads naturally. */
export const CC_CONJUNCTIONS = new Set([
  "and", "but", "or", "nor", "so", "yet", "because", "although", "though", "while",
  "whereas", "since", "unless", "until", "if", "when", "whenever", "where", "wherever",
  "that", "which", "who", "whom", "whose", "than", "as", "after", "before",
]);
export const CC_PREPOSITIONS = new Set([
  "about", "above", "across", "against", "along", "among", "around", "at", "behind",
  "below", "beneath", "beside", "between", "beyond", "by", "despite", "down", "during",
  "except", "for", "from", "in", "inside", "into", "near", "of", "off", "on", "onto",
  "out", "outside", "over", "past", "through", "throughout", "to", "toward", "towards",
  "under", "underneath", "up", "upon", "with", "within", "without",
]);
/** Words that bind FORWARD onto whatever follows. Stranding one at the end of a
 *  line ("…of the" / "…in") is the single thing that makes captions read wrong. */
export const CC_DETERMINERS = new Set([
  "a", "an", "the", "my", "your", "his", "her", "its", "our", "their",
  "this", "that", "these", "those", "no", "some", "any", "every",
]);
export const CC_AUXILIARIES = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did",
  "have", "has", "had", "will", "would", "can", "could", "shall", "should", "may",
  "might", "must", "ain't", "don't", "doesn't", "didn't", "can't", "won't",
]);
/** Titles belong to the name after them — never break between them. */
export const CC_TITLES = new Set([
  "mr.", "mrs.", "ms.", "miss", "dr.", "st.", "prof.", "sgt.", "capt.", "lt.", "gen.",
  "rev.", "sen.", "gov.", "pres.",
]);

/**
 * How good a line break between two adjacent words would be. Higher is better;
 * every gap is breakable, so this only ranks them.
 */
export function ccBreakScore(prev: string, next: string): number {
  // Trailing/leading quotes and brackets hide the punctuation we care about.
  const p = prev.toLowerCase().replace(/[")\]}'’”]+$/, "");
  const n = next.toLowerCase().replace(/^[("[{'‘“]+/, "");
  let score: number;
  if (/[.!?]$/.test(p)) score = 100;          // sentence ends here
  else if (/[—–]$/.test(p)) score = 85;  // em/en dash — an interruption
  else if (/[,;:]$/.test(p)) score = 75;      // clause ends here
  else if (CC_CONJUNCTIONS.has(n)) score = 55;
  else if (CC_PREPOSITIONS.has(n)) score = 45;
  else score = 10;                            // a plain word gap: allowed, not liked

  const bare = p.replace(/[^\w.'’-]/g, "");
  if (CC_TITLES.has(bare)) score -= 130;      // "Mr." also looks like a sentence end
  else if (CC_DETERMINERS.has(bare)) score -= 120;
  else if (CC_PREPOSITIONS.has(bare)) score -= 70;
  else if (CC_AUXILIARIES.has(bare)) score -= 40;
  if (/[-‐]$/.test(p)) score -= 130;     // don't split a hyphenated compound
  if (/^[-–—]/.test(next)) score += 40; // a dash starts a new speaker's line

  return score;
}

/** Measured text width, so the wrap matches what actually renders instead of
 *  guessing from character counts (CEA-608 arrives in ALL CAPS, which is much
 *  wider than the same count of lowercase). Falls back to an estimate if the
 *  engine has no 2D canvas. */
let ccMeasureCtx: CanvasRenderingContext2D | null | undefined;
export function ccTextWidth(text: string, font: string, fontPx: number): number {
  if (ccMeasureCtx === undefined) {
    try {
      ccMeasureCtx = document.createElement("canvas").getContext("2d");
    } catch {
      ccMeasureCtx = null;
    }
  }
  if (!ccMeasureCtx) return text.length * fontPx * 0.58;
  ccMeasureCtx.font = font;
  return ccMeasureCtx.measureText(text).width || text.length * fontPx * 0.58;
}

/** A word plus the one break the re-wrap is not allowed to undo. */
export type CcWord = CcSeg & { br?: boolean };

/** Incoming lines → a flat word stream, each word keeping its own formatting so
 *  italics (off-screen voices) survive being moved to a different line.
 *
 *  One incoming break is KEPT: a line opening with a dash is a change of
 *  speaker, and running two speakers together ("- Are you coming? - I'll catch
 *  up.") is misleading in a way no amount of good phrasing makes up for. */
export function ccWordsOf(lines: CcLine[]): CcWord[] {
  const out: CcWord[] = [];
  for (const line of lines) {
    const opensWithDash = /^\s*[-–—]\s*\S/.test(line.map((s) => s.text).join(""));
    let first = true;
    for (const seg of line) {
      for (const word of seg.text.split(" ")) {
        if (!word) continue;
        const w: CcWord = { text: word, i: seg.i, b: seg.b, u: seg.u };
        if (first && opensWithDash && out.length) w.br = true;
        first = false;
        out.push(w);
      }
    }
  }
  return out;
}

/**
 * Wrap a word stream into rendered caption lines.
 *
 * In order: it all fits on one line; it fits on two inside the 42-character
 * reading measure (pick the split that reads best, nudged toward even line
 * lengths — a full line above a two-word line looks broken); it fits on two
 * WIDER lines; or it's longer than that, and we fill forward. Every word always
 * survives — see the note where the filled lines are returned.
 *
 * `streaming` picks the strategy for text that is still ARRIVING, which is what
 * live CEA-608 looks like: rows on screen at once with the newest still being
 * typed in a character at a time. Filling forward rather than balancing keeps
 * the earlier breaks put while the newest text grows, so lines don't reshuffle
 * under the viewer on every update. Finished text (a VOD subtitle cue) gets the
 * balanced split instead. It is purely a layout choice: it must never decide
 * what text appears or when, because pop-on and roll-up captions are
 * indistinguishable by the time they reach us.
 */
export function ccWrap(
  words: CcWord[],
  maxPx: number,
  font: string,
  fontPx: number,
  streaming: boolean,
): CcLine[] {
  // Lay each speaker out on its own, then stack them — a break we're required
  // to keep is a boundary the phrasing logic below never gets to see across.
  const forced = words.findIndex((w, i) => i > 0 && w.br);
  if (forced > 0) {
    return [
      ...ccWrap(words.slice(0, forced), maxPx, font, fontPx, streaming),
      ...ccWrap(words.slice(forced), maxPx, font, fontPx, streaming),
    ];
  }

  const n = words.length;
  if (!n) return [];

  const textOf = (a: number, b: number) => {
    let s = words[a].text;
    for (let i = a + 1; i < b; i++) s += " " + words[i].text;
    return s;
  };
  const widthOf = (a: number, b: number) => ccTextWidth(textOf(a, b), font, fontPx);
  const fits = (a: number, b: number, charCap: number) => {
    const s = textOf(a, b);
    return s.length <= charCap && ccTextWidth(s, font, fontPx) <= maxPx;
  };
  // Re-merge the words of one line back into styled runs. A run that follows
  // another carries the joining space, which is invisible either way.
  const lineOf = (a: number, b: number): CcLine => {
    const segs: CcLine = [];
    for (let i = a; i < b; i++) {
      const w = words[i];
      const last = segs[segs.length - 1];
      if (last && last.i === w.i && last.b === w.b && last.u === w.u) last.text += " " + w.text;
      else segs.push({ ...w, text: (segs.length ? " " : "") + w.text });
    }
    return segs;
  };
  /** Best two-line split of words[a..b), or -1 if no split has both sides fit. */
  const bestSplit = (a: number, b: number, charCap: number) => {
    let at = -1;
    let top = -Infinity;
    // Imbalance is measured against the text being split, not the container:
    // on a 1920px TV a 42-character line uses well under half the width, so
    // scaling by the container would mute this term exactly where it's needed.
    const whole = widthOf(a, b) || 1;
    for (let k = a + 1; k < b; k++) {
      if (!fits(a, k, charCap) || !fits(k, b, charCap)) continue;
      const gap = Math.abs(widthOf(a, k) - widthOf(k, b));
      const score =
        ccBreakScore(words[k - 1].text, words[k].text) - (gap / whole) * CC_BALANCE_WEIGHT;
      if (score > top) {
        top = score;
        at = k;
      }
    }
    return at;
  };

  if (fits(0, n, CC_MAX_CHARS)) return [lineOf(0, n)];

  // Two lines at the preferred measure, else two wider ones. Widening beats
  // adding a line, and it beats dropping words even harder.
  // A self-contained cue is finished text, so balance it across the two lines.
  // Live roll-up is NOT finished — its last line is still being typed — and
  // re-balancing on every character that arrives is the jitter the forward fill
  // below exists to avoid, so roll-up skips straight to it.
  if (!streaming) {
    const preferred = bestSplit(0, n, CC_MAX_CHARS);
    const split = preferred > 0 ? preferred : bestSplit(0, n, CC_MAX_CHARS_RELAXED);
    if (split > 0) return [lineOf(0, split), lineOf(split, n)];
  }

  // More text than two lines can hold — a live roll-up window with several rows
  // up at once, mostly. Fill forward, recording where each line starts.
  const starts: number[] = [];
  let start = 0;
  while (start < n) {
    starts.push(start);
    // Longest run of words that still fits (at least one, so a single
    // over-long word can't loop forever — CSS break-word catches that).
    let end = start + 1;
    while (end < n && fits(start, end + 1, CC_MAX_CHARS_RELAXED)) end++;
    if (end < n) {
      // Then pull the break back to the best-reading gap that still fills the
      // line. Ties go to the fuller line, which keeps this stable as text grows.
      // "Full" is relative to how much this line could hold — which is the
      // character cap on a wide screen, not the container width.
      const capacity = widthOf(start, end);
      let pick = end;
      let pickScore = -Infinity;
      for (let c = start + 1; c <= end; c++) {
        if (widthOf(start, c) < capacity * CC_MIN_FILL) continue;
        const score = ccBreakScore(words[c - 1].text, words[c].text);
        if (score >= pickScore) {
          pickScore = score;
          pick = c;
        }
      }
      end = pick;
    }
    start = end;
  }

  // Two lines is a strong preference, NOT a licence to delete caption text.
  // Slicing to two here silently dropped rows of a multi-row 608 caption, which
  // is words the viewer never got to read — far worse than a taller box. By this
  // point both the 42-char measure and the relaxed one have failed, so this only
  // fires on genuinely long text (>2 lines of ~56), which is rare in practice.
  return starts.map((from, idx) => lineOf(from, starts[idx + 1] ?? n));
}

/**
 * Collapse the redundancy roll-up captions arrive with. hls.js re-emits a row
 * every time the display screen changes, so a row still being typed shows up
 * repeatedly as ever-longer prefixes of itself, and a row already on screen is
 * re-sent as the window scrolls. Keep the longest version of each, in order.
 */
export function ccCollapse(lines: CcLine[]): CcLine[] {
  const out: CcLine[] = [];
  const keys: string[] = [];
  for (const line of lines) {
    const key = line.map((s) => s.text).join(" ");
    if (!key) continue;
    const prev = keys[keys.length - 1];
    if (prev !== undefined && key.startsWith(prev)) {
      out[out.length - 1] = line;
      keys[keys.length - 1] = key;
      continue;
    }
    if (prev !== undefined && prev.startsWith(key)) continue;
    out.push(line);
    keys.push(key);
  }
  return out;
}

/**
 * Seconds AHEAD of the playhead to read live captions from.
 *
 * Live captions are typed by a person listening to the show, so the 608 data is
 * stamped a beat later than the words it transcribes — the lag is upstream of us
 * and baked into the stream. Reading slightly ahead of the playhead is what
 * pulls them back onto the audio. One number, easy to retune: raise it if
 * captions still trail the speech, lower it if they start arriving early.
 * VOD is untouched — subtitle files are authored against the picture already.
 */
export const CC_LIVE_LEAD_S = 1;

/** Same flattening as linesFromActiveCues, but for the cues active at an
 *  EXPLICIT time rather than the browser's `track.activeCues`. Used whenever the
 *  cue clock isn't the clock to display on: a resumed relay remux plays from
 *  &start=<offset> so video.currentTime is 0-based from there while the WebVTT
 *  cues are episode-absolute, and live reads CC_LIVE_LEAD_S ahead. */
export function linesAtTime(track: TextTrack, t: number): CcSource {
  const cues = track.cues;
  if (!cues) return CC_EMPTY;
  const out: CcLine[] = [];
  let contributors = 0;
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i] as VTTCue;
    if (!(c.startTime <= t && t < c.endTime)) continue;
    const lines = cueToLines(c);
    if (lines.length) contributors++;
    out.push(...lines);
  }
  return { lines: ccCollapse(out).slice(-4), streaming: contributors > 1 };
}

/**
 * Flatten a track's active cues into the raw lines behind the drawn ones (see
 * ccCollapse for the roll-up redundancy, ccWrap for the final layout). The cap
 * matches the 4-row 608 roll-up window and keeps a pathological cue pile-up
 * from filling the screen — newest lines win.
 */
export function linesFromActiveCues(track: TextTrack): CcSource {
  const cues = track.activeCues;
  if (!cues) return CC_EMPTY;
  const out: CcLine[] = [];
  let contributors = 0;
  for (let i = 0; i < cues.length; i++) {
    const lines = cueToLines(cues[i]);
    if (lines.length) contributors++;
    out.push(...lines);
  }
  return { lines: ccCollapse(out).slice(-4), streaming: contributors > 1 };
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
export function isHlsSource(src: string | undefined): boolean {
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
