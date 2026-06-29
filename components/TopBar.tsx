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
      className={`fixed top-0 left-0 right-0 z-40 h-12 safe-area-top transition-all duration-300 ${
        showBg ? "bg-header/95 backdrop-blur-sm" : "bg-transparent"
      }`}
    >
      <div className="flex items-center justify-between h-full w-full max-w-screen-2xl mx-auto px-4">
        <Link href="/" className="flex items-center gap-2">
          <img src="/tvspot-logo.svg" alt="TVSpot" className="w-6 h-6" />
          <span className="text-white font-bold text-sm tracking-tight">TVSpot</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/search"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Search"
          >
            <SearchIcon className="w-4 h-4" />
          </Link>
          {username && (
            <span className="text-text-muted text-xs hidden sm:block pl-1">{username}</span>
          )}
          <button
            onClick={handleLogout}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
