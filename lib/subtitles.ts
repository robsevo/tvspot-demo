/**
 * Subtitle plumbing for VOD captions.
 *
 * Live TV needs none of this — those streams carry CEA-608 caption data inside
 * the H.264 SEI, which hls.js decodes into text tracks on its own (see
 * VideoPlayer). VOD sources carry nothing: they're h264+aac HLS with no
 * embedded captions and no subtitle playlists, so captions have to come from
 * an external provider and be handed to the browser as WebVTT.
 *
 * Provider: the Stremio OpenSubtitles v3 addon. It needs no API key (Wyzie and
 * the OpenSubtitles REST API both do, and OpenSubtitles' free tier caps at
 * 5-20 downloads/day, which a real evening of watching would blow through).
 * It's keyed by IMDB id, so TMDB ids get mapped across via TMDB's external_ids.
 */

export interface SubtitleTrack {
  /** Stable id — used as the React key and the track identity in the UI. */
  id: string;
  /** BCP-47-ish 2-letter code for <track srclang>. */
  lang: string;
  /** Display name in the CC menu. */
  label: string;
  /** Same-origin URL serving WebVTT. */
  url: string;
}

/** ISO 639-2 (what the provider returns) → [2-letter code, display name]. */
const LANGS: Record<string, [string, string]> = {
  eng: ["en", "English"],
  spa: ["es", "Spanish"],
  fre: ["fr", "French"],
  fra: ["fr", "French"],
  ger: ["de", "German"],
  deu: ["de", "German"],
  ita: ["it", "Italian"],
  por: ["pt", "Portuguese"],
  dut: ["nl", "Dutch"],
  nld: ["nl", "Dutch"],
  rus: ["ru", "Russian"],
  pol: ["pl", "Polish"],
  swe: ["sv", "Swedish"],
  nor: ["no", "Norwegian"],
  dan: ["da", "Danish"],
  fin: ["fi", "Finnish"],
  jpn: ["ja", "Japanese"],
  kor: ["ko", "Korean"],
  chi: ["zh", "Chinese"],
  zho: ["zh", "Chinese"],
  ara: ["ar", "Arabic"],
  heb: ["he", "Hebrew"],
  hin: ["hi", "Hindi"],
  tur: ["tr", "Turkish"],
  ell: ["el", "Greek"],
  gre: ["el", "Greek"],
  ces: ["cs", "Czech"],
  cze: ["cs", "Czech"],
  hun: ["hu", "Hungarian"],
  ron: ["ro", "Romanian"],
  rum: ["ro", "Romanian"],
  ukr: ["uk", "Ukrainian"],
  vie: ["vi", "Vietnamese"],
  tha: ["th", "Thai"],
  ind: ["id", "Indonesian"],
};

export function langInfo(iso3: string): [string, string] {
  return LANGS[iso3?.toLowerCase()] ?? [iso3?.slice(0, 2) || "und", iso3 || "Unknown"];
}

/**
 * Decode subtitle bytes to text. The provider reports UTF-8, ASCII and CP1252
 * across its catalog, so try UTF-8 strictly first and fall back to windows-1252
 * (a superset of latin-1) rather than emitting replacement characters.
 */
export function decodeSubtitle(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("windows-1252").decode(buf);
    } catch {
      return new TextDecoder("utf-8").decode(buf); // lossy last resort
    }
  }
}

/** `00:02:05,872` / `0:02:05,8` → `00:02:05.872` (WebVTT demands 2-digit hours). */
function normalizeStamp(raw: string): string | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(raw.trim());
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  const pad = (v: string, n = 2) => v.padStart(n, "0");
  return `${pad(h ?? "0")}:${pad(mm)}:${pad(ss)}.${ms.padEnd(3, "0")}`;
}

const CUE_LINE =
  /^\s*(-?[\d:,.]+)\s*-->\s*(-?[\d:,.]+)(\s+.*)?$/;

/**
 * SubRip → WebVTT. Browsers only parse WebVTT, and the provider serves SubRip.
 *
 * Beyond the well-known comma→dot swap this also: strips the BOM, normalizes
 * CRLF, pads short/hour-less timestamps (WebVTT rejects `0:02:05.8`), drops
 * cues whose timestamps don't parse (a malformed cue otherwise kills the whole
 * file — WebVTT parsing is not error-tolerant across a bad cue), and escapes
 * the raw `&`/`<`/`>` that SubRip allows but WebVTT would read as markup.
 * Files already in WebVTT are passed through.
 */
export function srtToVtt(input: string): string {
  let text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  // Already WebVTT — normalize the header and hand it back.
  if (/^\s*WEBVTT/.test(text)) return text.trimStart();

  const out: string[] = ["WEBVTT", ""];
  const blocks = text.split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;

    // A block is [index]? , timing, ...text
    let i = 0;
    if (!CUE_LINE.test(lines[0]) && /^\d+$/.test(lines[0].trim())) i = 1;
    const timing = lines[i];
    if (!timing) continue;

    const m = CUE_LINE.exec(timing);
    if (!m) continue;

    const start = normalizeStamp(m[1]);
    const end = normalizeStamp(m[2]);
    if (!start || !end) continue; // unparseable → skip the cue, keep the file

    const body = lines
      .slice(i + 1)
      .join("\n")
      // SubRip permits bare & < > ; WebVTT would treat them as markup. Escape
      // them, but keep the italic/bold/underline/font tags SubRip actually uses
      // (WebVTT understands <i>/<b>/<u>) by unescaping those back.
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/&lt;(\/?)(i|b|u|v|c|ruby|rt|lang)((?:\s[^&]*?)?)&gt;/gi, "<$1$2$3>");

    if (!body.trim()) continue;
    out.push(`${start} --> ${end}`, body, "");
  }

  return out.join("\n");
}
