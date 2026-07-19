"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Tv, Clapperboard } from "lucide-react";

const TABS = [
  { href: "/tv", label: "Home", Icon: Home },
  { href: "/tv/live", label: "Live TV", Icon: Tv },
  { href: "/tv/vod", label: "Movies & Shows", Icon: Clapperboard },
] as const;

/** Top bar: every tab reads as a button (pill + ring + icon) so the remote
 *  user can see what's pressable from the couch — the active one is the solid
 *  white pill, idle ones are quiet glass pills. A hairline under the bar
 *  separates chrome from content. */
export default function TvTopNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/tv" ? pathname === "/tv" : pathname.startsWith(href);

  return (
    <nav className="flex items-center gap-12 px-16 py-5 border-b border-white/10">
      <div className="flex items-center gap-3">
        <img src="/tvspot-logo.svg" alt="" className="w-10 h-10" />
        <span className="text-xl font-bold text-white tracking-tight">TVSpot</span>
      </div>
      <div className="flex items-center gap-4">
        {TABS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            data-tv
            className={`flex items-center gap-2.5 px-6 py-2.5 rounded-full text-lg font-semibold ring-1 focus:outline-none ${
              isActive(href)
                ? "bg-white text-black ring-white"
                : "bg-white/10 text-[#aebbc5] ring-white/15"
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
