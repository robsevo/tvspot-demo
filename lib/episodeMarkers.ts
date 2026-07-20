/**
 * Intro / end-credit boundaries for episode playback ("Skip intro", "Next up").
 *
 * ── Why these are heuristics ────────────────────────────────────────────────
 * Netflix and Prime drive these buttons from per-title, human-authored skip
 * markers. We have no such data: TMDB exposes none, the Origin backend returns
 * none (see lib/types.ts Episode — title/overview/still/urls only), and the
 * stream itself carries no chapter atoms. Detecting them for real would mean
 * decoding audio/video (silence + black-frame analysis), which is not viable
 * on a 2019 Samsung webview.
 *
 * So: time-based rules, tuned to how TV episodes are actually cut, with every
 * constant named and in one place. They will be wrong for some shows — a cold
 * open pushes the theme past our window, a "next episode" teaser runs after the
 * credits. Both failure modes are mild: the button either doesn't appear, or
 * appears somewhere harmless. Nothing here ever seeks without an explicit press
 * except the auto-advance, which is cancellable and only fires inside the
 * credits window.
 */

/** Seconds the "Next up" card counts down before advancing on its own. */
export const AUTO_NEXT_SECONDS = 15;

/** Where "Skip intro" seeks to, when the episode is long enough to have one. */
const DEFAULT_INTRO_END_S = 95;

/** Don't offer the skip until playback is clear of the recap/cold open. */
const INTRO_BUTTON_FROM_S = 8;

/**
 * An intro is never a large fraction of the episode. Clamping to this keeps a
 * short item (a 6-minute extra, a clip) from having its first quarter labelled
 * "intro" and skipped.
 */
const INTRO_MAX_FRACTION = 0.15;

/** Below this runtime we assume there's no title sequence worth skipping. */
const MIN_RUNTIME_FOR_INTRO_S = 600; // 10 min

/** Typical end-credit roll. The "Next up" card appears this far from the end. */
const CREDITS_TAIL_S = 50;

/**
 * Floor on where the credits window may start, as a fraction of runtime. On a
 * short item CREDITS_TAIL_S would otherwise cover most of the episode and pop
 * the card up halfway through.
 */
const CREDITS_MIN_FRACTION = 0.9;

/**
 * Markers need a real, finite duration. Relay remux sources report Infinity/0
 * and cannot seek at all (see VodPlayer: resume is baked into the URL as
 * &start=, there is no seekable range), so every marker is suppressed for them
 * rather than offering a Skip button that silently does nothing.
 */
export function hasUsableTimeline(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/** Absolute time "Skip intro" seeks to for an episode of this length. */
export function introEndFor(duration: number): number {
  return Math.min(DEFAULT_INTRO_END_S, duration * INTRO_MAX_FRACTION);
}

/** Absolute time the end-credit window opens for an episode of this length. */
export function creditsStartFor(duration: number): number {
  return Math.max(duration - CREDITS_TAIL_S, duration * CREDITS_MIN_FRACTION);
}

/** Should the "Skip intro" button be on screen right now? */
export function showSkipIntro(currentTime: number, duration: number): boolean {
  if (!hasUsableTimeline(duration)) return false;
  if (duration < MIN_RUNTIME_FOR_INTRO_S) return false;
  return currentTime >= INTRO_BUTTON_FROM_S && currentTime < introEndFor(duration);
}

/** Should the "Next up" card (and its countdown) be on screen right now? */
export function showNextUp(currentTime: number, duration: number): boolean {
  if (!hasUsableTimeline(duration)) return false;
  return currentTime >= creditsStartFor(duration);
}

/** Minimal shape needed to walk a series — structurally compatible with
 *  SeriesDetail["seasons"] on both shells without importing the full type. */
interface SeasonLike {
  season_number: number;
  episodes?: { episode_number: number; title?: string }[];
}

/**
 * The episode after (season, episode): next in the same season, else the first
 * episode of the next season that actually HAS episodes — the backend does
 * return empty seasons, and one must not dead-end a binge. Null on the series
 * finale, which is what suppresses "Next up" entirely.
 *
 * Shared so the TV and mobile shells can never disagree about what plays next.
 */
export function findNextEpisode(
  seasons: SeasonLike[] | undefined,
  season: number,
  episode: number,
): { season: number; episode: number; title?: string } | null {
  if (!seasons?.length) return null;
  const sIdx = seasons.findIndex((s) => s.season_number === season);
  if (sIdx < 0) return null;

  const eps = seasons[sIdx].episodes ?? [];
  const eIdx = eps.findIndex((e) => e.episode_number === episode);
  const sameSeason = eIdx >= 0 ? eps[eIdx + 1] : undefined;
  if (sameSeason) {
    return { season, episode: sameSeason.episode_number, title: sameSeason.title };
  }

  const nextSeason = seasons.slice(sIdx + 1).find((s) => (s.episodes ?? []).length > 0);
  if (!nextSeason) return null;
  const first = nextSeason.episodes![0];
  return { season: nextSeason.season_number, episode: first.episode_number, title: first.title };
}
