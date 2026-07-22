import type { CatalogItem } from "@/lib/types";

/**
 * Client-side "what people watch now" shaping for the catalog.
 *
 * The backend catalog items don't carry original_language or genre_ids, so true
 * region/language/popularity filtering needs TMDB enrichment (see the catalog
 * route). These helpers do the best-effort, token-free shaping the product
 * requires regardless: drop holiday/Christmas titles, keep English-script
 * titles, and rank by a recency-weighted score so the rows feel current.
 */

const HOLIDAY_RE =
  /\b(christmas|xmas|santa|holiday|noel|nativity|advent|yuletide|jingle|grinch|st\.?\s*nick|festive|hanukkah|kwanzaa)\b/i;

// Non-Latin script ranges (Cyrillic, Hebrew, Arabic, Thai, CJK, Hangul, etc.).
const NON_LATIN_RE =
  /[Ѐ-ӿ֐-׿؀-ۿ฀-๿　-鿿가-힯＀-￯]/;

export function isHoliday(it: CatalogItem): boolean {
  return HOLIDAY_RE.test(it.title || "") || HOLIDAY_RE.test(it.overview || "");
}

/** Best-effort "English" check: has Latin letters and no non-Latin script. */
export function looksEnglish(it: CatalogItem): boolean {
  const t = it.title || "";
  return /[a-zA-Z]/.test(t) && !NON_LATIN_RE.test(t);
}

/**
 * Recency-weighted popularity score. Uses TMDB `popularity` when the catalog
 * route was able to enrich it (token present); otherwise blends rating with how
 * recent the title is so newer, well-rated titles bubble up ("watching now").
 */
export function trendingScore(it: CatalogItem): number {
  const pop = Number(it.popularity) || 0;
  if (pop > 0) return pop;
  const rating = Number(it.vote_average) || Number(it.rating) || 0;
  const year = Number(it.year) || 0;
  const nowYear = 2026;
  const recency = year ? Math.max(0, 6 - (nowYear - year)) : 0; // 0–6 boost for last ~6 yrs
  return rating * 10 + recency * 8;
}

/** Apply the product rules (no holiday, English-script) and sort by trend. */
export function curate(items: CatalogItem[]): CatalogItem[] {
  return items
    .filter((it) => !isHoliday(it) && looksEnglish(it))
    .sort((a, b) => trendingScore(b) - trendingScore(a));
}

/**
 * "Trending now" = items that have a REAL US/CA popularity score (set by the
 * catalog route's TMDB enrichment) first, ordered by it; then fall back to the
 * recency-weighted score so a row is never empty. This keeps Trending genuinely
 * current rather than dominated by old-but-high-rated titles.
 */
export function trendingNow(items: CatalogItem[]): CatalogItem[] {
  const curated = curate(items);
  const withPop = curated.filter((it) => (Number(it.popularity) || 0) > 0);
  // If TMDB enrichment landed for a decent share, trust it as the trending set.
  if (withPop.length >= 8) return withPop;
  return curated; // enrichment thin (token/coverage) — fall back to curated order
}

/**
 * "Top Rated" that isn't a museum: high vote_average AND reasonably recent
 * (last ~15 years) so the row reflects modern acclaimed titles, not 1970s
 * classics that always top a pure vote_average sort. Tunable via `sinceYear`.
 */
export function topRated(items: CatalogItem[], sinceYear = 2010): CatalogItem[] {
  const nowYear = 2026;
  return curate(items)
    .filter((it) => {
      const v = Number(it.vote_average) || Number(it.rating) || 0;
      const y = Number(it.year) || 0;
      return v >= 7 && y >= sinceYear && y <= nowYear + 1;
    })
    .sort((a, b) => {
      // Rating first, but nudge by recency so newer acclaimed titles lead.
      const av = Number(a.vote_average) || Number(a.rating) || 0;
      const bv = Number(b.vote_average) || Number(b.rating) || 0;
      if (Math.abs(av - bv) > 0.25) return bv - av;
      return (Number(b.year) || 0) - (Number(a.year) || 0);
    });
}

/**
 * Genre membership by TMDB genre_id or by the enriched genre name — the
 * catalog carries whichever the enrichment step managed to attach. Shared by
 * the web home and the TV home so both build the same genre rows.
 */
export function hasGenre(item: CatalogItem, name: string, id: number): boolean {
  if (item.genre_ids?.includes(id)) return true;
  if (item.genres?.includes(name)) return true;
  return false;
}

/** Normalize a title for matching: lowercase, drop non-alphanumerics. */
function titleKey(s: string): string {
  return norm(s).replace(/[^a-z0-9]+/g, " ").trim();
}

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * Distinctive stems for adult-animation shows. The backend catalog has no
 * maturity/sub-genre metadata and "adult animation" isn't a TMDB genre, and it
 * stores subtitled variants ("South Park: Joining the Panderverse", "Rick and
 * Morty: The Anime"), so we prefix-match these stems rather than exact-match.
 * Stems are chosen to be specific enough not to catch kids' shows.
 */
const ADULT_ANIMATION_STEMS = [
  "family guy", "american dad", "rick and morty", "south park", "bobs burgers",
  "archer", "futurama", "the simpsons", "bojack horseman", "big mouth",
  "disenchantment", "solar opposites", "paradise pd", "brickleberry", "final space",
  "f is for family", "inside job", "close enough", "smiling friends", "the boondocks",
  "harley quinn", "invincible", "aqua teen", "robot chicken", "mr pickles",
  "hazbin hotel", "helluva boss", "tuca", "duncanville", "the great north",
  "krapopolis", "velma", "bless the harts", "king of the hill", "beavis and butt",
  "the cleveland show", "metalocalypse", "ugly americans", "drawn together", "moral orel",
  "venture bros", "blue eye samurai", "scavengers reign", "common side effects",
  "digman", "grimsburg", "sausage party", "praise petey", "superjail", "china il",
].map((s) => titleKey(s));

export function isAdultAnimation(it: CatalogItem): boolean {
  const t = titleKey(it.title || "");
  if (!t) return false;
  // Match exact or "<stem>: subtitle"/"<stem> <year>" forms via prefix.
  return ADULT_ANIMATION_STEMS.some((stem) => t === stem || t.startsWith(stem + " "));
}

/** Adult-animation titles present in the catalog, trend-sorted. */
export function adultAnimation(items: CatalogItem[]): CatalogItem[] {
  return items
    .filter(isAdultAnimation)
    .sort((a, b) => trendingScore(b) - trendingScore(a));
}
