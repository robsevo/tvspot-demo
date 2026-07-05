"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { LogOut, Search as SearchIcon } from "lucide-react";

export default function TopBar() {
  const { username, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  const isHome = pathname === "/";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  const showBg = !isHome || scrolled;

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 safe-area-top transition-all duration-300 ${
        showBg
          ? // Frosted glass: low-opacity tint + heavy blur/saturate does the work,
            // an inset top highlight sells the pane edge. Content stays readable
            // because the blur averages whatever scrolls under it.
            "bg-[#0c1426]/55 backdrop-blur-2xl backdrop-saturate-150 border-b border-white/10 shadow-lg shadow-black/40 [box-shadow:inset_0_1px_0_rgba(255,255,255,0.08),0_10px_30px_rgba(0,0,0,0.4)]"
          : "bg-transparent"
      }`}
    >
      {/* Animated brand sheen bottom edge */}
      <div className={`absolute bottom-0 left-0 right-0 h-[1.5px] transition-opacity duration-500 ${
        showBg ? "opacity-100" : "opacity-0"
      }`}>
        <div className="h-full brand-sheen" />
      </div>
      <div className="flex items-center justify-between h-12 w-full max-w-screen-2xl mx-auto px-4">
        <Link
          href="/search"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 transition-all hover:scale-110 active:scale-90"
          aria-label="Search"
        >
          <SearchIcon className="w-4 h-4" />
        </Link>
        <Link href="/" className="flex items-center gap-2 group">
          <img src="/tvspot-logo.svg" alt="TVSpot" className="w-6 h-6 transition-transform group-hover:scale-110" />
          <span className="text-white font-bold text-sm tracking-tight group-hover:hud-text-glow transition-all">TVSpot</span>
        </Link>
        <div className="flex items-center gap-2">
          {username && (
            <span className="text-text-muted text-xs hidden sm:block pl-1">{username}</span>
          )}
          <button
            onClick={handleLogout}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 transition-all hover:scale-110 active:scale-90"
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
