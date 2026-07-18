/**
 * TV (Samsung Tizen) platform helpers.
 *
 * The TV client is the SAME hosted Next.js app: the Tizen .wgt package (see
 * tizen/) is a thin wrapper whose start page redirects to the deployed origin's
 * /tv routes, so auth cookies, the /api proxy layer, and stream verification
 * all keep working unchanged. Everything here must feature-detect — this code
 * runs in desktop browsers (dev), the TV's built-in browser, and the Tizen web
 * runtime, and only the last one injects the `tizen` global.
 */

/** UAs of TV browsers/webviews we route to the /tv experience. Shared with
 *  middleware.ts (edge runtime) — keep this module dependency-free. Covers
 *  Samsung (Tizen/SMART-TV), LG (Web0S), and Fire TV's Silk (AFT*). */
export const TV_UA_RE = /\bTizen\b|SMART-TV|SmartTV|Web0S|NetCast|\bAFT[A-Z]\b|HbbTV/i;

/** Remote-control keyCodes. Arrows/Enter are standard; the 4xx/102xx codes are
 *  Tizen's — they only arrive after registerTvKeys(). Escape doubles as the
 *  TV Back key for desktop-browser testing. */
export const TVKEY = {
  enter: 13,
  back: 10009,
  escape: 27,
  left: 37,
  up: 38,
  right: 39,
  down: 40,
  playPause: 10252,
  play: 415,
  pause: 19,
  stop: 413,
  rewind: 412,
  fastForward: 417,
  channelUp: 427,
  channelDown: 428,
} as const;

/* Minimal typings for the Tizen web runtime globals (present only in .wgt). */
interface TizenGlobal {
  tvinputdevice?: { registerKey?: (name: string) => void };
  application?: { getCurrentApplication?: () => { exit?: () => void } };
}

function tizenApis(): TizenGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { tizen?: TizenGlobal }).tizen ?? null;
}

/** Media/channel remote keys are opt-in on Tizen — unregistered keys never
 *  reach the page. Arrows/Enter/Back need no registration. No-op elsewhere. */
export function registerTvKeys(): void {
  const inputdevice = tizenApis()?.tvinputdevice;
  if (!inputdevice?.registerKey) return;
  const names = [
    "MediaPlayPause",
    "MediaPlay",
    "MediaPause",
    "MediaStop",
    "MediaRewind",
    "MediaFastForward",
    "ChannelUp",
    "ChannelDown",
  ];
  for (const n of names) {
    try {
      inputdevice.registerKey(n);
    } catch {
      // Key not supported on this model — fine, it just won't arrive.
    }
  }
}

/** Close the TV app (Back pressed at the TV root). No-op in normal browsers. */
export function exitTvApp(): void {
  try {
    tizenApis()?.application?.getCurrentApplication?.()?.exit?.();
  } catch {}
}
