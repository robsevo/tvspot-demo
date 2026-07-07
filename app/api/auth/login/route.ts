import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, signToken } from "@/lib/auth";
import { nextRolloverMs } from "@/lib/dailyBoundary";

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
    // Mirror the cookie lifetime to the token's exp (next 4 AM ET rollover).
    const maxAge = Math.max(60, Math.floor((nextRolloverMs() - Date.now()) / 1000));
    response.cookies.set("tvspot_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge,
    });
    return response;
  } catch (e) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}