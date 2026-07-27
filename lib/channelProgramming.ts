/**
 * What to show for a channel the EPG has nothing for.
 *
 * Measured 2026-07-27 against prod: 22 of 125 channels come back with zero
 * programmes, and it is NOT a name-matching bug — normalising both sides
 * (lowercase, strip punctuation) produced no near-misses, so the upstream guide
 * genuinely does not carry them. Nine of those 22 are "24/7 <Show>" loop
 * channels:
 *
 *   24/7 Pokemon, Family Guy, American Dad, Rick and Morty, South Park,
 *   Bob's Burgers, Futurama, The Simpsons, King of the Hill
 *
 * Those have no schedule to fetch because they have no schedule at all — they
 * play one show on a loop. But we know exactly what is on: it is in the channel
 * name. Rendering "No guide data" for them was the guide calling itself broken
 * while holding the answer.
 *
 * This does NOT invent times or episode titles. It states the show and that it
 * runs continuously, which is the true and complete description of that channel.
 * The remaining 13 (Citytv, Noovo, MSNBC, ID, NFL RedZone, FanDuel, DAZN, two
 * Bally Sports, MLS, Serie A, LaLiga TV, Sky Sport Bundesliga) keep an honest
 * "no guide data" — we don't have their schedule and won't pretend to.
 */

/** "24/7 The Simpsons" -> "The Simpsons". Null when it isn't a loop channel. */
export function loopShowName(channelName: string): string | null {
  // Tolerant of "24/7", "24-7" and "247" with any spacing, which is how these
  // arrive from different providers.
  const m = /^\s*24\s*[/\-]?\s*7\s+(.+?)\s*$/i.exec(channelName);
  const show = m?.[1]?.trim();
  return show ? show : null;
}

export interface FallbackProgramming {
  /** Primary line — the programme title slot. */
  title: string;
  /** Secondary line — the time/detail slot. Empty string renders nothing. */
  detail: string;
}

/**
 * The two lines to render in a guide cell for a channel with no programmes.
 * `online` false means the channel itself isn't up, which outranks everything.
 */
export function fallbackProgramming(channelName: string, online: boolean): FallbackProgramming {
  if (!online) return { title: "Offline", detail: "" };
  const show = loopShowName(channelName);
  if (show) return { title: show, detail: "24/7 · plays continuously" };
  return { title: "Live programming", detail: "No guide data" };
}
