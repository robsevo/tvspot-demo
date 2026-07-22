"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Search, Bookmark, Settings } from "lucide-react";
import { useCatalog, prewarmService } from "@/hooks/useCatalog";

const TABS = [
  { href: "/tv", label: "Home" },
  { href: "/tv/live", label: "Live TV" },
  { href: "/tv/movies", label: "Movies" },
  { href: "/tv/shows", label: "TV Shows" },
] as const;

/** Right-aligned utility destinations. These used to live ONLY in the side
 *  menu; that overlay is gone (it hijacked every Left press from the leftmost
 *  content), so they ride in the header — otherwise /tv/search, /tv/my-stuff
 *  and /tv/settings would have no D-pad route at all. */
const UTILITY = [
  { href: "/tv/search", label: "Search", Icon: Search },
  { href: "/tv/my-stuff", label: "My Stuff", Icon: Bookmark },
  { href: "/tv/settings", label: "Settings", Icon: Settings },
] as const;

/** How many provider quick links ride in the header. Prime shows ~4 brand
 *  marks between the dividers; the full list lives behind "All providers". */
const HEADER_PROVIDERS = 4;

/** Prime-style header: plain text tabs, the active (or focused) one a solid
 *  white pill; then a divider, provider quick links, divider, All providers.
 *  No logo, no underline — the bar floats over the blue glow. */
export default function TvTopNav() {
  const pathname = usePathname();
  const { services } = useCatalog();

  const isActive = (href: string) =>
    href === "/tv" ? pathname === "/tv" : pathname.startsWith(href);

  // Two DISTINCT signals, so they never fight for the same look:
  //   focus  = solid white pill, black text — "the remote cursor is here".
  //   active = translucent bright pill, WHITE text + accent ring — "this is the
  //            section you're in" (holds while focus is down in the content).
  // The old active style reused focus's white-pill/black-text, so an active-but-
  // unfocused tab was dark text the user couldn't read against the header.
  const pillClass = (active: boolean) =>
    `tv-pill px-5 py-2 rounded-lg text-lg whitespace-nowrap focus:outline-none focus:bg-white focus:text-black ${
      active
        ? "bg-white/15 text-white font-bold ring-1 ring-[#22d3ee]/60"
        : "text-[#c7d5e0] font-semibold"
    }`;

  return (
    <nav className="flex items-center gap-3 px-16 pt-5 pb-3 overflow-x-hidden">
      {TABS.map(({ href, label }) => (
        <Link key={href} href={href} data-tv className={pillClass(isActive(href))}>
          {label}
        </Link>
      ))}

      {services.length > 0 && (
        <>
          <span className="w-px h-7 bg-white/25 mx-3 shrink-0" />
          {services.slice(0, HEADER_PROVIDERS).map((svc) => (
            <Link
              key={svc}
              href={`/tv/vod?service=${encodeURIComponent(svc)}`}
              data-tv
              onFocus={() => prewarmService(svc)}
              className="tv-pill px-4 py-2 rounded-lg text-lg font-bold tracking-wide text-white/90 whitespace-nowrap focus:outline-none focus:bg-white focus:text-black"
            >
              {svc}
            </Link>
          ))}
        </>
      )}

      <span className="w-px h-7 bg-white/25 mx-3 shrink-0" />
      <Link
        href="/tv/vod"
        data-tv
        className={`tv-pill flex items-center gap-2.5 px-4 py-2 rounded-lg text-lg whitespace-nowrap focus:outline-none focus:bg-white focus:text-black ${
          pathname === "/tv/vod"
            ? "bg-white/15 text-white font-bold ring-1 ring-[#22d3ee]/60"
            : "text-[#c7d5e0] font-semibold"
        }`}
      >
        <LayoutGrid className="w-5 h-5" />
        All providers
      </Link>

      {/* Pushed to the far right so the browse tabs keep the natural left edge. */}
      <span className="ml-auto" />
      {UTILITY.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          data-tv
          aria-label={label}
          className={`tv-pill flex items-center gap-2.5 px-4 py-2 rounded-lg text-lg whitespace-nowrap focus:outline-none focus:bg-white focus:text-black ${
            isActive(href)
              ? "bg-white/15 text-white font-bold ring-1 ring-[#22d3ee]/60"
              : "text-[#c7d5e0] font-semibold"
          }`}
        >
          <Icon className="w-5 h-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
