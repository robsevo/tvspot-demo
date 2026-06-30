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
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gradient-to-b from-[#0c1426] via-[#080a16] to-[#04050a] backdrop-blur-xl border-t border-blue-500/10 safe-area-bottom animate-fade-in-up">
      {/* Brand sheen top edge — matches TopBar bottom edge */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px]">
        <div className="h-full brand-sheen" />
      </div>
      <div className="flex items-center justify-around h-14 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] px-3 rounded-lg transition-all duration-200 ${
                isActive ? "text-brand" : "text-text-muted"
              }`}
            >
              {isActive && (
                <span className="absolute -top-px h-0.5 w-7 rounded-full bg-brand hud-glow" />
              )}
              <Icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? "scale-110 hud-text-glow" : "scale-100"}`} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}