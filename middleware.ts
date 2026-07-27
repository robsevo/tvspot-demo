import { NextRequest, NextResponse } from "next/server";
import {
  verifyToken,
  signToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  SESSION_RENEW_AFTER_MS,
} from "@/lib/auth";
import { TV_UA_RE } from "@/lib/tv";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // TV browsers/webviews land on the 10-foot UI, not the touch one. Only the
  // two entry routes reroute — deep links (and the Tizen wrapper, which points
  // straight at /tv) are left alone.
  if (TV_UA_RE.test(request.headers.get("user-agent") || "")) {
    if (pathname === "/") return NextResponse.redirect(new URL("/tv", request.url));
    if (pathname === "/login") return NextResponse.redirect(new URL("/tv/login", request.url));
  }

  if (
    pathname === "/login" ||
    pathname === "/tv/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/images") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    // PWA / home-screen icons + manifest must be public so the OS can fetch them
    // when installing to the home screen (no auth cookie at that point).
    pathname.startsWith("/icon-") ||
    pathname.startsWith("/apple-icon") ||
    pathname === "/manifest.webmanifest" ||
    // Public root static assets (the TVSpot logo etc.) must load on the LOGIN page,
    // where there's no auth cookie — otherwise the <img> request gets redirected to
    // /login (HTML) and renders as a broken image.
    pathname.endsWith(".svg") ||
    // Legacy-webview runtime shims — loaded by EVERY page including /login and
    // /tv/login, before any auth exists.
    pathname === "/tv-polyfills.js" ||
    // The Fire TV APK and its typable alias are the one thing here that must
    // serve to a total stranger: it is what the Downloader app on a fresh stick
    // fetches, long before that person has an account. Gating it would 307 the
    // download to /login and hand Downloader an HTML page to "install".
    // Nothing leaks — the APK is a WebView shell that lands on /tv/login.
    pathname === "/tvspot.apk" ||
    pathname === "/fire" ||
    // The service worker script must be fetchable WITHOUT a cookie: the browser's
    // SW update check is the only recovery path for a client wedged on cached
    // broken chunks after its session expired — a 307-to-login here would leave
    // that client broken forever. The file is public code, nothing to protect.
    pathname === "/sw.js" ||
    // Build-id endpoint (deploy detection) is public: it only returns the commit
    // sha, and DeployRefresh polls it from EVERY open page — including /login and
    // apps whose session has lapsed. Gating it turned each of those into a
    // rolling 401 stream and blinded deploy detection exactly where a stale
    // build is most likely to be sitting.
    pathname === "/api/version" ||
    // The media proxy authenticates ITSELF (cookie OR a signed, target-bound
    // token) — see app/api/vod-stream. It has to: the TV's <video> element does
    // not send cookies on media requests, so a middleware cookie gate 401s every
    // stream that box asks for. Gating here would make the route's token path
    // unreachable, since middleware runs first.
    pathname.startsWith("/api/vod-stream")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;

  if (!payload) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // TV pages bounce to the TV login (which can silently re-login with the
    // remembered-on-this-TV credentials), not the touch one.
    return NextResponse.redirect(
      new URL(pathname.startsWith("/tv") ? "/tv/login" : "/login", request.url),
    );
  }

  const response = NextResponse.next();

  // Slide the session forward. Once a token is past halfway through its 30 days,
  // any request from that user re-mints it — so somebody who opens the app even
  // once a month is never logged out, while an abandoned device still lapses on
  // schedule. This is the piece that replaces the old 4 AM forced-logout: the
  // session now ends because it went UNUSED, never because the clock struck 4.
  //
  // Cheap enough to sit in the hot path: an HMAC sign is microseconds, and the
  // halfway gate means a given cookie is rewritten roughly twice a month, not
  // once a request. crypto.subtle + btoa (lib/auth.ts) are both available on the
  // Edge runtime this middleware runs in.
  const expMs = payload.exp ? payload.exp * 1000 : 0;
  if (expMs - Date.now() < SESSION_RENEW_AFTER_MS) {
    try {
      response.cookies.set(SESSION_COOKIE, await signToken(payload.username), sessionCookieOptions());
    } catch {
      // Re-minting is an optimisation, never a gate: the request is already
      // authenticated. A signing hiccup just means we try again next request.
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon|apple-icon|icon-|manifest.webmanifest).*)",
  ],
};