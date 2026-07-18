"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/tv", label: "Home" },
  { href: "/tv/live", label: "Live TV" },
  { href: "/tv/vod", label: "Movies & Shows" },
] as const;

/** Top tab bar for the TV shell. Plain focusable links — pressing Up from any
 *  page content reaches it, Enter activates (native link behavior). */
export default function TvTopNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/tv" ? pathname === "/tv" : pathname.startsWith(href);

  return (
    <nav className="flex items-center gap-10 px-16 py-6">
      <img src="/tvspot-logo.svg" alt="TVSpot" className="w-12 h-12" />
      <div className="flex items-center gap-4">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            data-tv
            className={`px-6 py-3 rounded-xl text-xl font-semibold transition-colors ${
              isActive(tab.href)
                ? "bg-white/10 text-white"
                : "text-text-secondary hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
