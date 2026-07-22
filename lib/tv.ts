/**
 * TV platform helpers (Samsung Tizen + Amazon Fire TV).
 *
 * The TV client is the SAME hosted Next.js app. BOTH native packages are thin
 * wrappers that open the deployed origin's /tv routes — the Tizen .wgt (see
 * tizen/) and the Fire TV APK (see firetv/), whose single Activity is a
 * full-screen WebView. So auth cookies, the /api proxy layer, and stream
 * verification keep working unchanged, and the two TV apps are identical by
 * construction: same routes, same components, same pixels.
 *
 * Everything here must feature-detect — this code runs in desktop browsers
 * (dev), TV built-in browsers, the Tizen web runtime (which injects `tizen`),
 * and the Fire TV WebView (which injects `TVSpotAndroid`).
 */

/** UAs of TV browsers/webviews we route to the /tv experience. Shared with
 *  middleware.ts (edge runtime) — keep this module dependency-free. Covers
 *  Samsung (Tizen/SMART-TV), LG (Web0S), Fire TV's Silk and sticks (AFT*), and
 *  our own Fire TV wrapper, which appends the TVSpotAndroid token to its WebView
 *  UA (firetv/…/MainActivity.kt) so this never rests on Amazon's model string —
 *  AFT* happens to match today's sticks, but it is Amazon's to change. */
export const TV_UA_RE =
  /\bTizen\b|SMART-TV|SmartTV|Web0S|NetCast|\bAFT[A-Z]\b|HbbTV|TVSpotAndroid/i;

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

/* The Fire TV wrapper's @JavascriptInterface bridge (firetv/…/MainActivity.kt).
 * Present only inside the APK's WebView. */
interface AndroidTvBridge {
  exit?: () => void;
}

function tizenApis(): TizenGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { tizen?: TizenGlobal }).tizen ?? null;
}

function androidBridge(): AndroidTvBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { TVSpotAndroid?: AndroidTvBridge }).TVSpotAndroid ?? null;
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

/** Close the TV app (Back pressed at the TV root). No-op in normal browsers.
 *
 *  Fire TV's Back key never reaches the page on its own — the wrapper Activity
 *  intercepts it and re-dispatches it as the Tizen back code, so the SAME back
 *  stack in TvNav decides everything. When that stack bottoms out here, we hand
 *  control back to the Activity to finish(). */
export function exitTvApp(): void {
  try {
    const android = androidBridge();
    if (android?.exit) {
      android.exit();
      return;
    }
    tizenApis()?.application?.getCurrentApplication?.()?.exit?.();
  } catch {}
}
