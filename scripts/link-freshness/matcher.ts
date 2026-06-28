import type { M3uEntry, MatchResult, Channel } from "./types";

/** Normalize: lowercase, strip diacritics, collapse whitespace. */
function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** Normalize a title for matching: lowercase, drop non-alphanumerics. */
function titleKey(s: string): string {
  return norm(s).replace(/[^a-z0-9]+/g, " ").trim();
}

/** Levenshtein distance between two strings — O(n*m). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // Single-row optimization
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Common suffixes that don't help with matching. */
const SUFFIX_STRIP_RE =
  /\b(HD|FHD|UHD|4K|8K|1080p|720p|2160p|SD|HQ|HEVC|H265|H264|50fps|60fps|US|UK|CA|AU|NZ|VIP|RAW|BACKUP|ALT|2|3)\s*$/i;

/** Extract country codes from brackets/parens. */
function extractCountry(s: string): string {
  const m = s.match(/[\[\(](US|UK|CA|AU|NZ|IN|DE|FR|ES|IT|NL|BR|MX|JP|KR|RU)[\]\)]/i);
  return m ? m[1].toUpperCase() : "";
}

/** Score how well an M3U channel name matches a example.com channel name. */
function matchScore(m3uName: string, catalogName: string): number {
  const m3uStripped = m3uName.replace(SUFFIX_STRIP_RE, "").trim();
  const catalogStripped = catalogName.replace(SUFFIX_STRIP_RE, "").trim();

  const m3uKey = titleKey(m3uStripped);
  const catalogKey = titleKey(catalogStripped);

  if (m3uKey === catalogKey) return 1.0;
  if (!m3uKey || !catalogKey) return 0;

  // Quick filter: first char match
  if (m3uKey[0] !== catalogKey[0]) return 0;

  const m3uCountry = extractCountry(m3uName);
  const catalogCountry = extractCountry(catalogName);
  let countryBonus = 0;
  if (m3uCountry && catalogCountry) {
    countryBonus = m3uCountry === catalogCountry ? 0.05 : -0.1;
  }

  const m3uTokens = new Set(m3uKey.split(/\s+/));
  const catalogTokens = new Set(catalogKey.split(/\s+/));

  // Quick token overlap check before expensive levenshtein
  let overlap = 0;
  for (const t of m3uTokens) {
    if (catalogTokens.has(t)) overlap++;
  }
  const union = new Set([...m3uTokens, ...catalogTokens]).size;
  const tokenScore = union === 0 ? 0 : overlap / union;

  // If no tokens overlap, can't match
  if (overlap === 0) return 0;

  const maxLen = Math.max(m3uKey.length, catalogKey.length);
  const levDistance = levenshtein(m3uKey, catalogKey);
  const stringScore = 1 - levDistance / maxLen;

  let prefixBonus = 0;
  const prefixLen = Math.min(4, Math.floor(Math.min(m3uKey.length, catalogKey.length) / 2));
  if (prefixLen >= 2 && m3uKey.slice(0, prefixLen) === catalogKey.slice(0, prefixLen)) {
    prefixBonus = 0.1;
  }

  return Math.max(0, Math.min(1, stringScore * 0.5 + tokenScore * 0.4 + prefixBonus + countryBonus));
}

const MATCH_THRESHOLD = 0.55;

// English-only guard. The Origin channel list is English, but IPTV M3U dumps mix in
// localized variants ("ESPN Deportes", "beIN AR", "Sportsnet FR") and non-Latin
// channels that can fuzzy-match an English channel name. Reject any entry whose
// name carries a non-English language/country marker or non-Latin script.
const NON_ENGLISH_RE = new RegExp(
  [
    // language / locale words
    "deportes|espanol|español|latino|arab|arabic|francais|français|deutsch|italiano|portugu|",
    "russk|turk|türk|polski|nederlan|svensk|norsk|suomi|magyar|romana|română|hrvat|srpski|",
    "greek|ελλην|farsi|hindi|tamil|telugu|urdu|bangla|filipino|tagalog|viet|thai|indonesia|",
    // common IPTV language/country tags and prefixes
    "\\b(ar|fr|es|de|it|pt|ru|tr|pl|nl|se|no|fi|gr|cz|ro|hu|hr|rs|ir|in|cn|jp|kr|vn|th|id|sa|ae|qa|mx|br|latino)\\b\\s*[:|]",
    "[\\[(](ar|fr|es|de|it|pt|ru|tr|pl|nl|gr|cz|ro|hu|hr|rs|ir|sa|ae|qa|mx|br|lat|esp|deu|fra|ita|rus|tur)[\\])]",
  ].join(""),
  "i",
);
// Any non-Latin script (Arabic, Cyrillic, CJK, Hebrew, Thai, Hangul, Greek, …).
const NON_LATIN_RE = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿ฀-๿぀-ヿ㐀-鿿가-힯]/;

function isEnglishName(name: string): boolean {
  if (!name) return false;
  if (NON_LATIN_RE.test(name)) return false;
  if (NON_ENGLISH_RE.test(name)) return false;
  return true;
}

/**
 * Fuzzy match M3U entries against example.com channel list.
 * Uses token-based indexing to avoid O(N*M) comparisons.
 */
export function matchChannels(m3uEntries: M3uEntry[], channels: Channel[]): MatchResult[] {
  // Build token index: word → M3U entry indices
  const tokenIndex = new Map<string, number[]>();
  // Also index by first 3 chars for prefix matching
  const prefixIndex = new Map<string, number[]>();

  let skippedNonEnglish = 0;
  for (let i = 0; i < m3uEntries.length; i++) {
    // English-only: skip localized/non-Latin channel variants entirely.
    if (!isEnglishName(m3uEntries[i].channelName)) {
      skippedNonEnglish++;
      continue;
    }
    const key = titleKey(m3uEntries[i].channelName.replace(SUFFIX_STRIP_RE, "").trim());
    const tokens = new Set(key.split(/\s+/).filter((t) => t.length >= 2));

    for (const t of tokens) {
      const list = tokenIndex.get(t);
      if (list) list.push(i);
      else tokenIndex.set(t, [i]);
    }

    if (key.length >= 3) {
      const prefix = key.substring(0, 3);
      const list = prefixIndex.get(prefix);
      if (list) list.push(i);
      else prefixIndex.set(prefix, [i]);
    }
  }

  const results = new Map<string, MatchResult>();
  const entryBest = new Map<string, { slug: string; score: number }>();

  for (const channel of channels) {
    if (!channel.name) continue;
    const slug = titleKey(channel.name).replace(/\s+/g, "-");
    const catalogKey = titleKey(channel.name.replace(SUFFIX_STRIP_RE, "").trim());
    const catalogTokens = catalogKey.split(/\s+/).filter((t) => t.length >= 2);

    // Collect candidate indices using token index
    const candidateSet = new Set<number>();

    // First try: any token overlap
    for (const token of catalogTokens) {
      const indices = tokenIndex.get(token);
      if (indices) {
        for (const idx of indices) candidateSet.add(idx);
        if (candidateSet.size > 5000) break; // cap per channel
      }
    }

    // If too few, add prefix matches
    if (candidateSet.size < 50 && catalogKey.length >= 3) {
      const prefix = catalogKey.substring(0, 3);
      const indices = prefixIndex.get(prefix);
      if (indices) {
        for (const idx of indices) candidateSet.add(idx);
      }
    }

    // Score only candidates
    const scored: { entry: M3uEntry; score: number }[] = [];
    for (const idx of candidateSet) {
      const entry = m3uEntries[idx];
      const score = matchScore(entry.channelName, channel.name);
      if (score >= MATCH_THRESHOLD) {
        scored.push({ entry, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const top = scored.slice(0, 100); // keep top 100 per channel
      results.set(slug, {
        channelName: channel.name,
        channelSlug: slug,
        candidates: top.map((s) => s.entry),
      });

      for (const { entry, score } of top) {
        const key = entry.streamUrl;
        const existing = entryBest.get(key);
        if (!existing || score > existing.score) {
          entryBest.set(key, { slug, score });
        }
      }
    }
  }

  // Prune candidates that are better matched to another channel
  for (const [slug, result] of results) {
    result.candidates = result.candidates.filter((entry) => {
      const best = entryBest.get(entry.streamUrl);
      return best?.slug === slug;
    });
  }

  console.error(
    "Matcher: %d channels matched out of %d, %d total candidates (%d non-English entries skipped)",
    results.size,
    channels.length,
    Array.from(results.values()).reduce((s, r) => s + r.candidates.length, 0),
    skippedNonEnglish
  );

  return Array.from(results.values()).filter((r) => r.candidates.length > 0);
}