/**
 * Remembered TV credentials for silent re-login.
 *
 * The auth token deliberately dies at the 4 AM ET rollover (lib/dailyBoundary)
 * — reasonable on a phone, but typing three fields with a remote every morning
 * is a non-starter. The TV login form offers "Remember on this TV": the
 * credentials are stored in localStorage (base64-obfuscated, NOT encrypted —
 * the threat model is a private living-room TV in a two-user household) and
 * replayed by the TV login page whenever the session lapses.
 */

const KEY = "tvspot_tv_creds_v1";

export interface TvCreds {
  username: string;
  password: string;
  secretWord: string;
}

function encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

function decode(s: string): string {
  return decodeURIComponent(escape(atob(s)));
}

export function saveTvCreds(creds: TvCreds): void {
  try {
    localStorage.setItem(KEY, encode(JSON.stringify(creds)));
  } catch {}
}

export function loadTvCreds(): TvCreds | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(decode(raw));
    if (
      typeof p?.username === "string" &&
      typeof p?.password === "string" &&
      typeof p?.secretWord === "string"
    ) {
      return p as TvCreds;
    }
  } catch {}
  return null;
}

export function clearTvCreds(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
