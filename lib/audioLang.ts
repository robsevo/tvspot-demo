/**
 * Audio-language naming and English detection, in ONE place.
 *
 * Two very different producers of "audio tracks" have to agree on what a track
 * is called and on which one is English:
 *
 *  - the relay (`/api/vod-audio-tracks`), which ffprobes the panel file and
 *    hands back one signed remux URL per track, and
 *  - the PLAYER, which reads the tracks an HLS stream declares (hls.js
 *    `hls.audioTracks`, or Safari's native `video.audioTracks`).
 *
 * They used to disagree, because only the first one existed. Everything the
 * relay didn't produce — provider-a, Origin, Provider B, any plain multi-audio HLS —
 * played whatever the stream defaulted to and offered no menu at all.
 */

/** ISO-639 (2- and 3-letter, plus the sloppy variants these panels emit) → a
 *  name a person reads on a couch. */
export const LANG_NAMES: Record<string, string> = {
  eng: "English", en: "English",
  fre: "French", fra: "French", fr: "French",
  ger: "German", deu: "German", de: "German",
  spa: "Spanish", es: "Spanish",
  ita: "Italian", it: "Italian",
  dut: "Dutch", nld: "Dutch", nl: "Dutch",
  por: "Portuguese", pt: "Portuguese",
  rus: "Russian", ru: "Russian",
  pol: "Polish", pl: "Polish",
  jpn: "Japanese", ja: "Japanese",
  kor: "Korean", ko: "Korean",
  chi: "Chinese", zho: "Chinese", zh: "Chinese",
  ara: "Arabic", ar: "Arabic",
  hin: "Hindi", hi: "Hindi",
  tur: "Turkish", tr: "Turkish",
  swe: "Swedish", nor: "Norwegian", dan: "Danish", fin: "Finnish",
};

/** Normalise the many spellings of a language tag to its lookup key:
 *  "en-US" → "en", "ENG" → "eng", " fr " → "fr". */
function normLang(lang: string | null | undefined): string {
  return (lang || "").trim().toLowerCase().split(/[-_]/)[0];
}

/** A track's display name. Unknown codes fall back to the embedded track title,
 *  then the raw code, so a row never renders blank. */
export function langLabel(lang: string | null | undefined, title: string | null | undefined, index: number): string {
  const name = LANG_NAMES[normLang(lang)];
  const t = (title || "").trim();
  // A track with a DISTINGUISHING title ("Commentary", "Audio Description")
  // must not collapse to a bare "English" — with several of them the menu
  // becomes three identical rows and picking one is a coin flip. But a title
  // that merely restates the language ("ger" tagged `ger`, which is what these
  // panels actually emit) is noise, and rendering "German · ger" reads as a bug.
  const restatesLang =
    !t ||
    t.toLowerCase() === (name || "").toLowerCase() ||
    t.toLowerCase() === normLang(lang) ||
    (!!name && LANG_NAMES[normLang(t)] === name);
  if (name && !restatesLang) return `${name} · ${t}`;
  if (name) return name;
  if (t) return t;
  const raw = (lang || "").trim();
  // "und" is ffprobe for "the file didn't say" — surfacing it as "UND" reads as
  // a bug. It's still a real, selectable track, so it gets a neutral name.
  if (raw && raw.toLowerCase() !== "und") return raw.toUpperCase();
  return `Track ${index + 1}`;
}

/**
 * Make every label in a menu distinct.
 *
 * Files really do carry two tracks tagged identically — `0:eng 1:eng` with no
 * titles is a common stereo+5.1 pair — and two rows both reading "English" give
 * the viewer no way to tell which one they're picking or which is playing.
 * Collisions get a track number; unique labels are left alone.
 */
export function dedupeLabels(labels: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((l) => {
    if ((counts.get(l) || 0) < 2) return l;
    const n = (seen.get(l) || 0) + 1;
    seen.set(l, n);
    return `${l} ${n}`;
  });
}

/** Is this an English track? Matches the relay's `_ENGLISH_LANG_TAGS` plus the
 *  label, since HLS streams routinely tag `und` and only name the track. */
export function isEnglishLang(lang: string | null | undefined, label?: string | null): boolean {
  const n = normLang(lang);
  if (n === "en" || n === "eng") return true;
  return /\benglish\b/i.test(label || "");
}

/** Tracks that are English but NOT the feature audio — director's commentary,
 *  audio description for the visually impaired, karaoke/instrumental stems.
 *  Auto-selecting one of these is just as wrong as auto-selecting German, so
 *  "default to English" means the first English track that isn't one of them. */
function isAlternateCut(label: string | null | undefined): boolean {
  return /commentary|described|description|\bad\b|narrat|karaoke|instrumental|isolated score/i.test(label || "");
}

/**
 * Index of the track that should play by default: the first English MAIN audio,
 * else the first English track of any kind, else -1 for "no opinion" (leave the
 * stream's own default alone rather than forcing something wrong).
 */
export function pickEnglishTrack<T>(
  tracks: readonly T[],
  read: (t: T) => { lang?: string | null; label?: string | null },
): number {
  const english: number[] = [];
  tracks.forEach((t, i) => {
    const { lang, label } = read(t);
    if (isEnglishLang(lang, label)) english.push(i);
  });
  if (english.length === 0) return -1;
  const main = english.find((i) => !isAlternateCut(read(tracks[i]).label));
  return main !== undefined ? main : english[0];
}
