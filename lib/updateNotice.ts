/**
 * "Update in progress" notice.
 *
 * Standing rule: before shipping a deploy that CAN DISRUPT PLAYBACK, put this
 * notice up FIRST (its own deploy), then ship the real update. Viewers get a
 * warning before the disruption instead of a silently broken app.
 *
 * Raise it for: backend/API changes, stream resolution or proxy changes,
 * catalog/EPG pipeline work, anything that empties the trending or catalog
 * caches a fresh deployment has to rebuild, or a batch of deploys in a row.
 *
 * Do NOT raise it for pure front-end work — layout, styling, card sizes, copy.
 * Those ship without touching live TV or VOD, and a banner that cries wolf on
 * cosmetic deploys is a banner nobody reads when it actually matters.
 *
 * The window is a DEADLINE, not a flag, on purpose: a boolean has to be turned
 * off by a third deploy, and if that deploy is forgotten or fails the banner
 * stays up forever. A timestamp self-clears — a missed cleanup costs nothing,
 * and leaving a stale past value here is inert (the notice simply never shows).
 *
 * To raise one: set this to ~25 minutes out (UTC), commit, deploy, THEN deploy
 * the real change. Set it back to null when the work is cosmetic again.
 */
export const UPDATE_NOTICE_UNTIL: string | null = "2026-08-05T02:15:00Z";

/** Roughly how long viewers are told things may be rough. Kept next to the
 *  deadline so the copy and the window can't drift apart. */
export const UPDATE_NOTICE_TEXT =
  "Update in progress — Live TV and movies/shows may not work for the next 20–30 minutes.";

/** True while the notice window is still open. Takes `now` so callers can tick
 *  it on a timer (and so it's testable without faking the clock). */
export function updateNoticeActive(now: number = Date.now()): boolean {
  if (!UPDATE_NOTICE_UNTIL) return false;
  const until = Date.parse(UPDATE_NOTICE_UNTIL);
  return Number.isFinite(until) && now < until;
}
