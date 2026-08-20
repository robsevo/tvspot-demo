import { signingSecret } from "@/lib/auth";
/**
 * Signed access for /api/vod-stream.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 2019 Samsung's `<video>` element does not send our auth cookie on media
 * requests. Proven on-device: the identical MP4 served from our origin ERRORS
 * instantly (MEDIA_ERR_SRC_NOT_SUPPORTED — the element is handed the login HTML)
 * while auth-gated, and PLAYS the moment the path is public. Modern browsers do
 * send credentials on media subresources, which is exactly why VOD worked on the
 * phone and never on the TV: every stream request from that box arrived at
 * /api/vod-stream unauthenticated and came back 401.
 *
 * A cookie we cannot send is useless here, so authority moves into the URL. The
 * resolver runs server-side inside an already-authenticated request, so it can
 * mint a signature the proxy will accept later without any cookie.
 *
 * The token is bound to ONE exact upstream target, so a leaked URL grants
 * nothing but that single file — it can't be repointed to turn the proxy into an
 * open relay, which is the thing actually worth protecting here.
 */

const TTL_MS = 24 * 60 * 60 * 1000;

function b64url(bytes: ArrayBuffer): string {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(target: string, exp: number): Promise<string> {
  const secret = signingSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${target}|${exp}`));
  return b64url(sig);
}

/** `<exp>.<sig>` — appended to a proxy URL as `&st=`. */
export async function mintStreamToken(target: string): Promise<string> {
  const exp = Date.now() + TTL_MS;
  return `${exp}.${await sign(target, exp)}`;
}

/** Constant-time-ish compare. Not timing-perfect, but this guards a media proxy,
 *  not a credential store, and the comparison is over a fixed-length digest. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStreamToken(target: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return same(token.slice(dot + 1), await sign(target, exp));
}

/** Build a signed same-origin proxy URL for `raw`. The single place that knows
 *  the query-parameter shape, so the resolver and the route can't drift. */
export async function signedProxyUrl(raw: string): Promise<string> {
  return `/api/vod-stream?url=${encodeURIComponent(raw)}&st=${encodeURIComponent(await mintStreamToken(raw))}`;
}
