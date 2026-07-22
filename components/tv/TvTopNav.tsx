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

// Two DISTINCT signals that never fight for the same look:
//   focus  = solid white pill, black text — "the remote cursor is here".
//   active = BABY BLUE label in a filled cyan-tinted container + bright cyan
//            ring — "this is the section you're in", readable at a glance from
//            the couch while focus is down in the content. Every other tab stays
//            the idle near-white. Explicit hex/rgba, not Tailwind /opacity
//            (which can compile to color-mix and not paint on the TV). Focus's
//            white pill still wins on :focus because the focus variant lands
//            later in the cascade — and it sets text-black, so the baby blue
//            never has to fight the white fill.
const ACTIVE_PILL =
  "bg-[rgba(34,211,238,0.20)] text-[#89cff0] font-bold ring-1 ring-[rgba(34,211,238,0.9)]";
const IDLE_PILL = "text-[#c7d5e0] font-semibold";

/** Prime-style header: plain text tabs, the active (or focused) one a solid
 *  white pill; then a divider, provider quick links, divider, All providers.
 *  No logo, no underline — the bar floats over the blue glow. */
export default function TvTopNav() {
  const pathname = usePathname();
  const { services } = useCatalog();

  const isActive = (href: string) =>
    href === "/tv" ? pathname === "/tv" : pathname.startsWith(href);

  const pillClass = (active: boolean) =>
    `tv-pill px-5 py-2 rounded-lg text-lg whitespace-nowrap focus:outline-none focus:bg-white focus:text-black ${
      active ? ACTIVE_PILL : IDLE_PILL
    }`;

  return (
    /*
     * THREE GROUPS, not one long row with a spacer.
     *
     * The utilities used to be pushed right by an `ml-auto` spacer, which only
     * works while there is FREE SPACE left to absorb — and the Samsung's system
     * font is wider than the Fire TV's, so at 1920 (both TVs get the same fixed
     * viewport) the row overflowed, the auto margin collapsed to zero, and
     * Search/My Stuff/Settings bunched up against the browse tabs.
     *
     * Right-alignment is now structural: left and right groups never shrink,
     * and the middle (provider shortcuts) is the only flexible part, so it
     * absorbs the squeeze and clips instead of shoving the utilities around.
     */
    <nav className="flex items-center gap-3 px-16 pt-5 pb-3 overflow-x-hidden">
      <div className="flex items-center gap-3 shrink-0">
        {/* Brand mark, top-left. Decorative (no data-tv), so it never steals a
            D-pad stop — the leftmost focusable stays the Home tab. */}
        <img
          src="/tvspot-logo.svg"
          alt="TVSpot"
          className="w-10 h-10 mr-2 shrink-0 rounded-lg"
        />
        {TABS.map(({ href, label }) => (
          <Link key={href} href={href} data-tv className={pillClass(isActive(href))}>
            {label}
          </Link>
        ))}
      </div>

      {/* The give in the layout. min-w-0 is what actually lets a flex item
          shrink below its content width. */}
      <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
        {services.length > 0 && (
          <>
            <span className="w-px h-7 bg-white/25 mx-3 shrink-0" />
            {services.slice(0, HEADER_PROVIDERS).map((svc) => (
              <Link
                key={svc}
                href={`/tv/vod?service=${encodeURIComponent(svc)}`}
                data-tv
                onFocus={() => prewarmService(svc)}
                className="tv-pill px-4 py-2 rounded-lg text-lg font-bold tracking-wide text-white/90 whitespace-nowrap shrink-0 focus:outline-none focus:bg-white focus:text-black"
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
          className={`tv-pill flex items-center gap-2.5 px-4 py-2 rounded-lg text-lg whitespace-nowrap shrink-0 focus:outline-none focus:bg-white focus:text-black ${
            pathname === "/tv/vod" ? ACTIVE_PILL : IDLE_PILL
          }`}
        >
          <LayoutGrid className="w-5 h-5" />
          All providers
        </Link>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {UTILITY.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            data-tv
            aria-label={label}
            className={`tv-pill flex items-center gap-2.5 px-4 py-2 rounded-lg text-lg whitespace-nowrap focus:outline-none focus:bg-white focus:text-black ${
              isActive(href) ? ACTIVE_PILL : IDLE_PILL
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
