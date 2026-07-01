"use client";

/**
 * localStorage-backed cache with stale-while-revalidate (SWR) semantics.
 *
 * Why not sessionStorage (what the catalog/channels/events hooks used before):
 * mobile browsers WIPE sessionStorage when they evict/discard a backgrounded tab.
 * So after the cold reload that follows an eviction, sessionStorage caches are
 * gone and every screen re-fetches from the network with spinners — which is a
 * big part of why a reload felt like a full "restart". localStorage survives the
 * eviction, so the UI can repaint instantly from the last-known payload while a
 * fresh copy loads in the background.
 */
type Entry<T> = { data: T; ts: number };

export function readCache<T>(key: string): { data: T; ageMs: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry<T>;
    if (parsed == null || parsed.data == null) return null;
    return { data: parsed.data, ageMs: Date.now() - (parsed.ts ?? 0) };
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() } as Entry<T>));
  } catch {
    // Quota exceeded / private mode — non-fatal, we just skip caching.
  }
}
