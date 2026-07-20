"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

/** Cap on the auth round-trips. EVERY auth fetch gates a full-screen "waiting"
 *  state on the TV — /api/auth/me gates the shell's splash, /api/auth/login
 *  gates the login page's "Signing you in…" — so an unbounded fetch means an
 *  unbounded splash. A fetch that REJECTS is fine (the catch runs); the killer
 *  is one that never SETTLES, which is routine on the RU7100 whose network
 *  stack often isn't up yet at cold launch. Long enough for a slow-but-alive
 *  backend, short enough not to read as a hang. */
const AUTH_TIMEOUT_MS = 8000;

/**
 * fetch with a hard deadline. Hand-rolled AbortController rather than
 * AbortSignal.timeout (Chrome 103+) — the modern form would itself throw on the
 * TV's Chromium 63 and turn every auth call into an instant failure.
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => { try { ctl?.abort(); } catch {} }, AUTH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, ...(ctl ? { signal: ctl.signal } : {}) });
  } finally {
    clearTimeout(timer);
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
      const res = await fetchWithTimeout("/api/auth/me", { credentials: "include" });
      const data = await res.json();
      const u = data.username ?? null;
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
      const res = await fetchWithTimeout("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password, secret_word }),
      });
      const data = await res.json();
      if (res.ok) {
        setUsername(username);
        cacheUser(username);
        return true;
      }
      throw new Error(data.error || "Login failed");
    } catch (e) {
      setUsername(null);
      cacheUser(null);
      throw e;
    }
  };

  const logout = async () => {
    // Time-boxed like the others so a stalled call can't wedge the UI.
    try {
      await fetchWithTimeout("/api/auth/logout", { method: "POST", credentials: "include" });
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