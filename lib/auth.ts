/**
 * Session lifetime: 30 days, slid forward whenever an active user makes a
 * request (middleware.ts re-issues past the halfway mark). In practice nobody
 * who opens the app within a month ever sees a login screen.
 *
 * Until 2026-07-27 the token instead expired at the next 4 AM ET boundary, so
 * EVERY device was force-logged-out EVERY morning. The TV silently replayed its
 * remembered credentials, but web and mobile have no such path — those users
 * retyped username + password + secret word daily, which is most of why the app
 * "looked broken on some platforms" each morning.
 *
 * That was never a security decision. It was added by ea1c1dd purely so
 * DailySplash had a trigger to prewarm caches after the nightly refresh, back
 * when the nightly deployed every night and left the server caches cold. The
 * nightly no longer deploys on data-only nights and warms its own caches, so
 * the daily logout had become pure cost. The splash still keys off the same
 * 4 AM epoch (lastRolloverMs) — it just no longer needs the session to die.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Re-issue once a token is past halfway through its life. That is what makes
 * the 30 days *slide* rather than being a hard monthly cliff, and it bounds the
 * write rate: a given cookie is only rewritten after 15 days of use, not on
 * every request.
 */
export const SESSION_RENEW_AFTER_MS = SESSION_TTL_MS / 2;

export const SESSION_COOKIE = "tvspot_session";

/** One definition of the cookie shape, shared by the login route and middleware. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export interface TokenPayload {
  username: string;
  iat?: number;
  exp?: number;
}

export interface AuthUser {
  username: string;
  password: string;
  secret_word: string;
}

function getUsers(): AuthUser[] {
  try {
    return JSON.parse(process.env.AUTH_USERS || "[]");
  } catch {
    return [];
  }
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

export async function signToken(username: string): Promise<string> {
  const secret = process.env.JWT_SECRET || "dev-secret";
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      username,
      iat: Math.floor(Date.now() / 1000),
      // Rolling 30 days, slid forward by middleware while the user is active.
      exp: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
    })
  );
  const sig = await hmacSign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${sig}`;
}

export async function verifyToken(
  token: string
): Promise<TokenPayload | null> {
  try {
    const secret = process.env.JWT_SECRET || "dev-secret";
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = await hmacSign(`${header}.${payload}`, secret);
    if (sig !== expected) return null;
    const data = JSON.parse(base64UrlDecode(payload));
    if (data.exp && Date.now() / 1000 > data.exp) return null;
    // exp is returned so middleware can decide whether to slide the session
    // forward; a token minted before the 30-day change simply has an earlier exp
    // and gets renewed on its owner's next request.
    return { username: data.username, iat: data.iat, exp: data.exp };
  } catch {
    return null;
  }
}

export function validateCredentials(
  username: string,
  password: string,
  secret_word: string
): boolean {
  const users = getUsers();
  return users.some(
    (u) =>
      u.username === username &&
      u.password === password &&
      u.secret_word === secret_word
  );
}