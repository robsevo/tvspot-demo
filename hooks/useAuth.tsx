"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

/** Cap on the /api/auth/me round-trip. The TV shell shows its splash while
 *  `loading` is true, so an unbounded fetch means an unbounded splash. Long
 *  enough for a slow-but-alive panel, short enough not to look like a hang. */
const AUTH_TIMEOUT_MS = 8000;

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
      // observed on the RU7100, whose network stack is routinely not up yet at
      // cold app launch (tizen/app.js guards its own probe for the same reason).
      // AbortSignal.timeout is Chrome 103+, so this is done by hand: the TV's
      // Chromium 63 would throw on the modern form and skip straight to catch.
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = setTimeout(() => { try { ctl?.abort(); } catch {} }, AUTH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch("/api/auth/me", {
          credentials: "include",
          ...(ctl ? { signal: ctl.signal } : {}),
        });
      } finally {
        clearTimeout(timer);
      }
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
      const res = await fetch("/api/auth/login", {
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
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
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