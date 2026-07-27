/**
 * Daily rollover boundary — 4:00 AM in America/Toronto (Eastern), DST-safe.
 *
 * Sole remaining use: `lastRolloverMs()` is the per-day epoch for the
 * "first open of the day" splash (components/DailySplash.tsx). 4 AM rather than
 * midnight because it sits after the nightly refresh and before anyone is up,
 * so "today" starts on fresh data.
 *
 * This file used to serve a second feature — a nightly forced-logout that set
 * the JWT `exp` to `nextRolloverMs()` — which meant every device on every
 * platform was signed out every morning. That was removed on 2026-07-27 (see
 * lib/auth.ts for the full reasoning) and `nextRolloverMs` went with it. The
 * splash is now a pure prewarm: it no longer needs anyone's session to die in
 * order to fire.
 *
 * Uses Intl.DateTimeFormat with an explicit timeZone, which is available in the
 * Edge runtime, the Node runtime (API routes), and the browser.
 */

export const ROLLOVER_HOUR = 4; // 4:00 AM local (Eastern)
const TZ = "America/Toronto";

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
