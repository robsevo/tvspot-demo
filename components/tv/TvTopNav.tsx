"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { useCatalog, prewarmService } from "@/hooks/useCatalog";

const TABS = [
  { href: "/tv", label: "Home" },
  { href: "/tv/movies", label: "Movies" },
  { href: "/tv/shows", label: "TV Shows" },
  { href: "/tv/live", label: "Live TV" },
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

  const pillClass = (active: boolean) =>
    `tv-pill px-5 py-2 rounded-lg text-lg whitespace-nowrap focus:outline-none focus:bg-white focus:text-black ${
      active ? "bg-white text-black font-bold" : "text-[#c7d5e0] font-semibold"
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
          pathname === "/tv/vod" ? "bg-white text-black font-bold" : "text-[#c7d5e0] font-semibold"
        }`}
      >
        <LayoutGrid className="w-5 h-5" />
        All providers
      </Link>
    </nav>
  );
}
