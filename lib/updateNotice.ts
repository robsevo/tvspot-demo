/**
 * "Update in progress" notice.
 *
 * Standing rule: before shipping a deploy that can disrupt playback, put this
 * notice up FIRST (its own deploy), then ship the real update. Viewers get a
 * warning before the disruption instead of a silently broken app — every deploy
 * hard-reloads open clients, and a fresh deployment starts with cold trending /
 * catalog caches that take a while to warm.
 *
 * The window is a DEADLINE, not a flag, on purpose: a boolean has to be turned
 * off by a third deploy, and if that deploy is forgotten or fails the banner
 * stays up forever, training everyone to ignore it. A timestamp self-clears — a
 * missed cleanup costs nothing, and leaving a stale past value in the repo is
 * inert (the notice simply never shows).
 *
 * To raise a notice: set this to ~25 minutes out (UTC), commit, deploy, THEN
 * deploy the real change. No cleanup deploy needed.
 */
export const UPDATE_NOTICE_UNTIL: string | null = "2026-07-22T18:25:00Z";

/** Roughly how long viewers are told things may be rough. Kept next to the
 *  deadline so the copy and the window can't drift apart. */
export const UPDATE_NOTICE_TEXT =
  "Update in progress — Live TV and movies/shows may not work for the next 15–20 minutes.";

/** True while the notice window is still open. Takes `now` so callers can tick
 *  it on a timer (and so it's testable without faking the clock). */
export function updateNoticeActive(now: number = Date.now()): boolean {
  if (!UPDATE_NOTICE_UNTIL) return false;
  const until = Date.parse(UPDATE_NOTICE_UNTIL);
  return Number.isFinite(until) && now < until;
}
