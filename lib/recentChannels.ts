"use client";

/** Recently watched live channels (by slug), newest first — feeds the Live TV
 *  guide's "Recently watched" section. Written by the channel player page. */

const STORAGE_KEY = "tvspot_recent_channels";
const MAX = 8;

export function recordRecentChannel(slug: string): void {
  try {
    const list = listRecentChannels().filter((s) => s !== slug);
    list.unshift(slug);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {}
}

export function listRecentChannels(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
    }
  } catch {}
  return [];
}
