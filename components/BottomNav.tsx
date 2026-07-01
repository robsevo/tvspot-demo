"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Tv, Film, Search, Library } from "lucide-react";

const tabs = [
  { href: "/", label: "Home", icon: Home },
  { href: "/live", label: "Live", icon: Tv },
  { href: "/vod", label: "VOD", icon: Film },
  { href: "/search", label: "Search", icon: Search },
  { href: "/my-list", label: "My List", icon: Library },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    // Instagram-style FLOATING pill — detached from the screen edges and lifted
    // ABOVE the iOS home indicator via env(safe-area-inset-bottom) so it never
    // conflicts with the system swipe bar. Translucent dark glass + our brand.
    <nav
      className="fixed left-1/2 -translate-x-1/2 z-50 animate-fade-in-up"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)" }}
    >
      <div className="relative flex items-center gap-1 px-2.5 py-2 rounded-full bg-[#0c1426]/85 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl shadow-black/60">
        {/* Faint brand sheen along the top edge of the pill */}
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px brand-sheen opacity-60" />
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-label={tab.label}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex items-center justify-center w-12 h-12 rounded-full transition-all duration-200 active:scale-90 ${
                isActive ? "text-white" : "text-text-muted hover:text-white"
              }`}
            >
              {/* Active gets a filled brand disc + glow (Instagram highlights the
                  current tab; we do it in-theme). */}
              {isActive && (
                <span className="absolute inset-1 rounded-full bg-brand hud-glow" />
              )}
              <Icon
                className={`relative w-6 h-6 transition-transform duration-200 ${
                  isActive ? "scale-105" : "scale-100"
                }`}
                strokeWidth={isActive ? 2.4 : 2}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
