import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === "/login" ||
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
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon|apple-icon|icon-|manifest.webmanifest).*)",
  ],
};