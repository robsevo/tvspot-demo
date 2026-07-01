"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      const u = data.username ?? null;
      setUsername(u);
      cacheUser(u);
    } catch {
      // Network blip (e.g. offline after eviction): keep the optimistic cached
      // user rather than logging them out. Only an explicit no-user response clears it.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Paint immediately from the cached user, then revalidate in the background.
    let cached: string | null = null;
    try {
      cached = localStorage.getItem(USER_KEY);
    } catch {}
    if (cached) {
      setUsername(cached);
      setLoading(false);
    }
    checkAuth();
  }, [checkAuth]);

  const login = async (username: string, password: string, secret_word: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    await fetch("/api/auth/logout", { method: "POST" });
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