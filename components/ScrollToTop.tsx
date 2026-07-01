"use client";

import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";
import { usePlayer } from "@/hooks/usePlayer";

/**
 * Bottom-right "scroll to top" button, just above the bottom nav. Appears once the
 * page is scrolled down; hidden when the floating mini-player is up (same corner).
 */
export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const { currentItem, minimized } = usePlayer();
  const floatingUp = !!currentItem && minimized;

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible || floatingUp) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Scroll to top"
      className="fixed right-4 bottom-20 z-40 w-11 h-11 rounded-full bg-brand text-white shadow-lg shadow-brand/40 hud-glow flex items-center justify-center active:scale-95 transition-transform animate-fade-in"
    >
      <ArrowUp className="w-5 h-5" />
    </button>
  );
}
