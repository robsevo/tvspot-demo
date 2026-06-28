"use client";

import { useRef } from "react";
import { usePlayer } from "@/hooks/usePlayer";
import VideoPlayer from "./VideoPlayer";
import { X } from "lucide-react";

export default function FloatingPlayer() {
  const { currentItem, playing, minimized, stop, togglePlay, setPlaying } = usePlayer();
  const containerRef = useRef<HTMLDivElement>(null);

  if (!currentItem || !minimized) return null;

  return (
    <div
      ref={containerRef}
      className="fixed bottom-16 right-3 z-50 w-[160px] rounded-lg overflow-hidden shadow-2xl shadow-black/50 bg-black border border-white/10"
    >
      <div className="relative">
        <VideoPlayer
          src={currentItem.streamUrl}
          autoPlay={playing}
          poster={currentItem.poster}
          channelName={currentItem.channelName}
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