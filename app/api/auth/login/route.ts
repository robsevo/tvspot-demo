import { NextRequest, NextResponse } from "next/server";
import {
  validateCredentials,
  signToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  ConfigError,
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // Rate limiting
  const attemptsKey = `login_attempts:${ip}`;
  const globalCache = (globalThis as any).__loginRateLimit ?? new Map();
  (globalThis as any).__loginRateLimit = globalCache;
  const attempt = globalCache.get(attemptsKey);
  if (attempt && attempt.count >= 5 && Date.now() - attempt.start < 900000) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 }
    );
  }

  try {
    const { username, password, secret_word } = await request.json();
    if (!username || !password || !secret_word) {
      return NextResponse.json(
        { error: "Username, password, and secret word are required" },
        { status: 400 }
      );
    }

    if (!validateCredentials(username, password, secret_word)) {
      if (!attempt) {
        globalCache.set(attemptsKey, { count: 1, start: Date.now() });
      } else {
        attempt.count++;
      }
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Clear rate limit on success
    globalCache.delete(attemptsKey);

    const token = await signToken(username);
    const response = NextResponse.json({ ok: true });
    // Cookie lifetime mirrors the token's exp (30 days), and middleware slides
    // both forward while the user is active — so signing in is a once-a-month
    // event at worst, not a once-a-morning one.
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (e) {
    // A misconfigured deployment is not a malformed request. Reporting it as
    // one sends the operator hunting through the client for a bug that is
    // actually a missing environment variable.
    if (e instanceof ConfigError) {
      console.error("[auth] configuration error:", e.message);
      return NextResponse.json(
        { error: "Server is not configured for sign-in. See the server logs." },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}