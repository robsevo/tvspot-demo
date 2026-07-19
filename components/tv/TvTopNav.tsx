"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/tv", label: "Home" },
  { href: "/tv/live", label: "Live TV" },
  { href: "/tv/vod", label: "Movies & Shows" },
] as const;

/** Prime-style top bar: quiet gray tabs, the active one carries a white pill.
 *  Plain focusable links — Up from page content reaches them, Enter activates. */
export default function TvTopNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/tv" ? pathname === "/tv" : pathname.startsWith(href);

  return (
    <nav className="flex items-center gap-12 px-16 py-5">
      <div className="flex items-center gap-3">
        <img src="/tvspot-logo.svg" alt="" className="w-10 h-10" />
        <span className="text-xl font-bold text-white tracking-tight">TVSpot</span>
      </div>
      <div className="flex items-center gap-3">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            data-tv
            className={`px-6 py-2.5 rounded-full text-lg font-semibold transition-colors ${
              isActive(tab.href)
                ? "bg-white text-black"
                : "text-[#8197a4] hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
