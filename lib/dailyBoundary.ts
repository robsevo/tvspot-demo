/**
 * Daily rollover boundary — 4:00 AM in America/Toronto (Eastern), DST-safe.
 *
 * One shared source of truth for two features:
 *  - nightly forced-logout: the JWT `exp` (and login cookie maxAge) are set to
 *    `nextRolloverMs()`, so every token dies at the next 4 AM ET and middleware
 *    redirects the stale cookie to /login (see lib/auth.ts, app/api/auth/login).
 *  - the "first sign-in of the day" splash keys off `lastRolloverMs()` as its
 *    per-day epoch, so the splash lines up exactly with the logout boundary
 *    rather than a naive midnight (see components/DailySplash.tsx).
 *
 * Uses Intl.DateTimeFormat with an explicit timeZone, which is available in the
 * Edge runtime (middleware/auth), the Node runtime (API routes), and the browser.
 */

export const ROLLOVER_HOUR = 4; // 4:00 AM local (Eastern)
const TZ = "America/Toronto";
// Don't issue a token that expires almost immediately: a 3:30 AM login shouldn't
// be kicked at 4:00. If the next boundary is closer than this, skip to the day after.
const MIN_TTL_MS = 60 * 60 * 1000;

/** Calendar Y/M/D of an instant, evaluated in Eastern time (en-CA → YYYY-MM-DD). */
function etDateParts(atMs: number): { year: number; month: number; day: number } {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(atMs));
  const [year, month, day] = s.split("-").map(Number);
  return { year, month, day };
}

/** Offset (ms) such that `wallClockAsUTC - actualUTC` at the given instant. */
function tzOffsetMs(atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hourCycle: "h23", // 00–23, avoids the en-US "24:00" midnight quirk
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(atMs));
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = Number(p.value);
  const asUTC = Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second);
  return asUTC - atMs;
}

/** UTC epoch (ms) for a given Eastern wall-clock date at `hour`:00:00. */
function etWallToUtc(year: number, month: number, day: number, hour: number): number {
  // Interpret the wall time as if UTC, then correct by the zone offset at that
  // instant. Two passes converge (the offset is stable except inside the DST
  // switch hour, which is 2 AM — never our 4 AM boundary).
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  const utc1 = guess - tzOffsetMs(guess);
  return guess - tzOffsetMs(utc1);
}

/** Epoch ms of the first 4 AM ET strictly after `nowMs` (with a min-TTL guard). */
export function nextRolloverMs(nowMs: number = Date.now()): number {
  const { year, month, day } = etDateParts(nowMs);
  let target = etWallToUtc(year, month, day, ROLLOVER_HOUR);
  let guard = 0;
  while (target <= nowMs + MIN_TTL_MS && guard < 4) {
    const next = etDateParts(target + 26 * 60 * 60 * 1000); // safely into next ET day
    target = etWallToUtc(next.year, next.month, next.day, ROLLOVER_HOUR);
    guard++;
  }
  return target;
}

/** Epoch ms of the most recent 4 AM ET at or before `nowMs`. */
export function lastRolloverMs(nowMs: number = Date.now()): number {
  const { year, month, day } = etDateParts(nowMs);
  let target = etWallToUtc(year, month, day, ROLLOVER_HOUR);
  let guard = 0;
  while (target > nowMs && guard < 4) {
    const prev = etDateParts(target - 26 * 60 * 60 * 1000); // safely into prior ET day
    target = etWallToUtc(prev.year, prev.month, prev.day, ROLLOVER_HOUR);
    guard++;
  }
  return target;
}
