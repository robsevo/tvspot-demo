"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { fetchJson, DEADLINE } from "@/lib/fetchDeadline";

/** The server never answered, or we couldn't reach it at all — as opposed to the
 *  server actively rejecting us. Callers need the difference: rotated
 *  credentials should be forgotten, an unreachable backend must not be, or one
 *  slow cold boot silently un-remembers the TV and demands a password on a
 *  remote control. */
export class AuthUnreachableError extends Error {
  constructor(message = "Could not reach the server") {
    super(message);
    this.name = "AuthUnreachableError";
  }
}

/**
 * One auth round-trip under DEADLINE.auth — short, because every one of these
 * gates a full-screen waiting state (/api/auth/me gates the shell splash,
 * /api/auth/login gates "Signing you in…").
 *
 * The deadline mechanics live in lib/fetchDeadline: on the TV a fetch cannot be
 * cancelled, so the timeout must race the work rather than abort it, and the
 * body parse must sit inside that race. Everything here does is translate the
 * outcome into the reachable/rejected distinction the TV login page needs.
 */
async function authFetch(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const { ok, data } = await fetchJson<Record<string, unknown> | null>(
      url,
      init,
      DEADLINE.auth,
    );
    return { ok, data: data ?? {} };
  } catch {
    // TimeoutError, refused, offline — indistinguishable here, and all mean the
    // same thing to callers: we learned nothing about the session.
    throw new AuthUnreachableError();
  }
}

interface AuthContextType {
  username: string | null;
  loading: boolean;
  login: (username: string, password: string, secret_word: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  username: null,
  loading: true,
  login: async () => false,
  logout: async () => {},
  checkAuth: async () => {},
});

// Last-known username, cached so a reload can render the UI optimistically instead
// of blanking to `null` for a full /api/auth/me round-trip (the white "restart"
// flash). The cookie is still the source of truth — we always revalidate.
const USER_KEY = "tvspot_user";
const cacheUser = (u: string | null) => {
  try {
    if (u) localStorage.setItem(USER_KEY, u);
    else localStorage.removeItem(USER_KEY);
  } catch {}
};

export function AuthProvider({
  children,
  initialUsername = null,
}: {
  children: ReactNode;
  /** Username resolved on the server from the auth cookie (see app/layout.tsx). */
  initialUsername?: string | null;
}) {
  const [username, setUsername] = useState<string | null>(initialUsername);
  // If the server already resolved a user, we start ready — no blocking fetch.
  const [loading, setLoading] = useState(initialUsername === null);

  const checkAuth = useCallback(async () => {
    try {
      // credentials is EXPLICIT on every auth fetch: browsers before Chrome 68
      // (the 2019 TV webview) default fetch to credentials:"omit", which both
      // drops the login response's Set-Cookie and stops the cookie being sent —
      // "signing in" simply never stuck on the TV.
      //
      // TIMEOUT (not optional): this fetch gates `loading`, and the /tv shell
      // renders its "Starting TVSpot" splash for as long as loading is true. A
      // fetch that never SETTLES never runs the finally below, so the TV sits on
      // that splash forever with no error and no redirect — exactly the hang
      // observed on the RU7100 (tizen/app.js guards its own probe likewise).
      const { data } = await authFetch("/api/auth/me", { credentials: "include" });
      const u = (data.username as string | undefined) ?? null;
      setUsername(u);
      cacheUser(u);
    } catch {
      // Network blip (e.g. offline after eviction), or the timeout above: keep
      // the optimistic cached user rather than logging them out. Only an
      // explicit no-user response clears it. Either way `loading` is released
      // below, so the shell moves on to the TV login (which silently re-signs in
      // with remembered credentials) instead of hanging on the splash.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Server already told us who we are (middleware verified the cookie) → trust
    // it, keep the localStorage cache warm, and skip the /api/auth/me round-trip.
    if (initialUsername !== null) {
      cacheUser(initialUsername);
      return;
    }
    // No server user (e.g. /login, or SSR without a cookie): fall back to the
    // cached optimistic render + background revalidation.
    let cached: string | null = null;
    try {
      cached = localStorage.getItem(USER_KEY);
    } catch {}
    if (cached) {
      setUsername(cached);
      setLoading(false);
    }
    checkAuth();
  }, [checkAuth, initialUsername]);

  const login = async (username: string, password: string, secret_word: string): Promise<boolean> => {
    try {
      // Time-boxed for the same reason as checkAuth: the TV login page holds a
      // full-screen "Signing you in…" until this promise SETTLES (its
      // autoTrying flag only clears in .then/.catch). An unsettled login call
      // therefore hangs that screen forever — which is exactly what happened
      // once the splash fix let the shell get this far.
      const { ok, data } = await authFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password, secret_word }),
      });
      if (ok) {
        setUsername(username);
        cacheUser(username);
        return true;
      }
      throw new Error((data.error as string | undefined) || "Login failed");
    } catch (e) {
      // A server that rejected us means we really are signed out. A server we
      // couldn't REACH says nothing about the session, so keep the optimistic
      // cached user — otherwise a cold-boot network stall blanks the shell too.
      if (!(e instanceof AuthUnreachableError)) {
        setUsername(null);
        cacheUser(null);
      }
      throw e;
    }
  };

  const logout = async () => {
    // Time-boxed like the others so a stalled call can't wedge the UI.
    try {
      await authFetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {}
    setUsername(null);
    cacheUser(null);
  };

  return (
    <AuthContext.Provider value={{ username, loading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}