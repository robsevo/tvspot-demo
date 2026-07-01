"use client";

import { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect } from "react";

export type PlayerItem = {
  title: string;
  poster?: string;
  type: "live" | "movie" | "series";
  streamUrl?: string;
  embedUrl?: string;
  channelName?: string;
  channelNumber?: number;
  backupUrls?: string[];
  tmdbId?: number;
  season?: number;
  episode?: number;
};

interface PlayerContextType {
  currentItem: PlayerItem | null;
  playing: boolean;
  minimized: boolean;
  play: (item: PlayerItem) => void;
  stop: () => void;
  minimize: () => void;
  maximize: () => void;
  togglePlay: () => void;
  setPlaying: (v: boolean) => void;
}

const PlayerContext = createContext<PlayerContextType>({
  currentItem: null,
  playing: false,
  minimized: false,
  play: () => {},
  stop: () => {},
  minimize: () => {},
  maximize: () => {},
  togglePlay: () => {},
  setPlaying: () => {},
});

const STORAGE_KEY = "tvspot_player";

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [currentItem, setCurrentItem] = useState<PlayerItem | null>(null);
  const [playing, setPlaying] = useState(false);
  const [minimized, setMinimized] = useState(false);

  // Rehydrate the floating/mini player after a reload so a backgrounded-then-
  // evicted tab comes back to what was playing instead of an empty player.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { currentItem: PlayerItem | null; minimized: boolean };
      if (saved.currentItem) {
        setCurrentItem(saved.currentItem);
        setMinimized(saved.minimized ?? true);
      }
    } catch {}
  }, []);

  // Persist what's playing (not the volatile `playing` flag — resume paused).
  useEffect(() => {
    try {
      if (currentItem) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentItem, minimized }));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  }, [currentItem, minimized]);

  const play = useCallback((item: PlayerItem) => {
    setCurrentItem(item);
    setPlaying(true);
    setMinimized(false);
  }, []);

  const stop = useCallback(() => {
    setCurrentItem(null);
    setPlaying(false);
    setMinimized(false);
  }, []);

  const minimize = useCallback(() => setMinimized(true), []);
  const maximize = useCallback(() => setMinimized(false), []);
  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  return (
    <PlayerContext.Provider
      value={{ currentItem, playing, minimized, play, stop, minimize, maximize, togglePlay, setPlaying }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  return useContext(PlayerContext);
}