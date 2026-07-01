"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { usePlayer } from "@/hooks/usePlayer";
import { X } from "lucide-react";

// FloatingPlayer is mounted on every page but renders null unless something is
// actually minimized. Loading VideoPlayer lazily keeps it (and its deps) out of
// every route's initial bundle — it's fetched only when a mini-player appears.
const VideoPlayer = dynamic(() => import("./VideoPlayer"), { ssr: false });

export default function FloatingPlayer() {
  const { currentItem, playing, minimized, stop, togglePlay, setPlaying } = usePlayer();
  const containerRef = useRef<HTMLDivElement>(null);

  if (!currentItem || !minimized) return null;

  return (
    <div
      ref={containerRef}
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)" }}
      className="fixed right-3 z-50 w-[160px] rounded-lg overflow-hidden shadow-2xl shadow-black/50 bg-black border border-white/10"
    >
      <div className="relative">
        <VideoPlayer
          src={currentItem.streamUrl}
          autoPlay={playing}
          poster={currentItem.poster}
          channelName={currentItem.channelName}
          title={currentItem.title}
          isLive={currentItem.type === "live"}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <button
          onClick={stop}
          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 flex items-center justify-center"
          aria-label="Close floating player"
        >
          <X className="w-3 h-3 text-white" />
        </button>
      </div>
    </div>
  );
}