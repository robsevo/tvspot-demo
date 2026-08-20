import type { M3uEntry } from "./types";

/**
 * M3U / M3U8 playlist parsing.
 *
 * This is deliberately the *only* thing in this module. A playlist is just a
 * text format — `#EXTM3U` header, then `#EXTINF:` metadata lines each followed
 * by a URL — and parsing one has nothing to do with where it came from. Source
 * adapters (see `sources/`) are responsible for fetching; they hand the text
 * here and get structured entries back.
 *
 * Keeping fetch and parse apart is what makes the adapters trivial to add and
 * this function trivial to test: it is pure, synchronous, and does no I/O.
 */

/** Playlists larger than this are treated as hostile/broken rather than parsed. */
export const MAX_M3U_SIZE = 1_000_000; // 1 MB

/**
 * Parse M3U content into entries.
 *
 * Returns `[]` rather than throwing on anything malformed — a source that
 * serves garbage should degrade to "this source contributed nothing", not take
 * down a pipeline run that has five other sources working fine.
 *
 * @param text   raw playlist body
 * @param source label recorded on each entry, for provenance in the output
 */
export function parseM3u(text: string, source: string): M3uEntry[] {
  const lines = text.split(/\r?\n/);
  // Must start with #EXTM3U. Without this check an HTML error page parses as an
  // empty-but-valid playlist, and a dead source looks identical to a working
  // one that happens to carry no channels.
  if (!lines[0]?.trim().startsWith("#EXTM3U")) return [];

  const entries: M3uEntry[] = [];
  let currentAttrs: Record<string, string> = {};
  let currentName = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("#EXTINF:")) {
      const attrStr = trimmed.slice(8).trim();
      currentAttrs = {};

      const attrRe = /([a-zA-Z_-]+)="([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrStr)) !== null) {
        currentAttrs[m[1]] = m[2];
      }

      // The display name is everything after the LAST comma: attribute values
      // routinely contain commas ("News, Sports"), so splitting on the first
      // one truncates real channel names.
      const commaIdx = attrStr.lastIndexOf(",");
      if (commaIdx >= 0) {
        currentName = attrStr.slice(commaIdx + 1).trim();
      } else {
        currentName = currentAttrs["tvg-name"] || attrStr;
      }
    } else if (!trimmed.startsWith("#")) {
      if (currentName && /^https?:\/\//i.test(trimmed)) {
        entries.push({
          channelName: currentName,
          streamUrl: trimmed,
          sourceName: source,
          attrs: { ...currentAttrs },
        });
      }
      // Reset after every URL line, so a malformed entry cannot leak its name
      // onto the next stream.
      currentName = "";
      currentAttrs = {};
    }
  }

  return entries;
}
