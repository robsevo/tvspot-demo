import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
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
    // Build-id endpoint (deploy detection) is public: it only returns the commit
    // sha, and DeployRefresh polls it from EVERY open page — including /login and
    // apps whose session died at the 4 AM rollover. Gating it turned each of
    // those into an all-night 401 stream and blinded deploy detection exactly
    // where a stale build is most likely to be sitting.
    pathname === "/api/version"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("tvspot_session")?.value;
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon|apple-icon|icon-|manifest.webmanifest).*)",
  ],
};