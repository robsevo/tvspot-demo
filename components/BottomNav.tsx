"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Tv, Film, MonitorPlay, Library } from "lucide-react";

/**
 * Mirrors the TV header's sections: Home / Live TV / Movies / TV Shows.
 *
 * Movies and TV Shows replace the single "VOD" tab, which opened a provider
 * picker — you had to choose a provider before seeing a single title. The
 * picker still exists at /vod and is where a provider rail's "See all" lands.
 *
 * Search left the bar rather than being squeezed in: there are only five
 * comfortable slots at 375px, and the TopBar already carries a Search button on
 * every page, so nothing became unreachable.
 */
const tabs = [
  { href: "/", label: "Home", icon: Home },
  { href: "/live", label: "Live", icon: Tv },
  { href: "/movies", label: "Movies", icon: Film },
  { href: "/shows", label: "TV Shows", icon: MonitorPlay },
  { href: "/my-list", label: "My List", icon: Library },
];

/** Tab presses land at the TOP of the target page. useScrollRestoration would
 *  otherwise restore the page's last offset (that behavior stays for reloads
 *  and back-navigation) — so a deliberate tab press wipes the saved offset
 *  first. /live is exempt: coming back to the guide should keep your place. */
function jumpToTop(targetHref: string, currentPath: string) {
  if (targetHref === "/live") return;
  try {
    const map = JSON.parse(localStorage.getItem("tvspot_scroll") || "{}");
    if (map[targetHref] !== undefined) {
      delete map[targetHref];
      localStorage.setItem("tvspot_scroll", JSON.stringify(map));
    }
  } catch {}
  // Re-pressing the active tab re-navigates to the same path (no scroll reset
  // from the router) — jump explicitly.
  if (currentPath === targetHref) window.scrollTo({ top: 0 });
}

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
      {/* Frosted pill — see-through tint, the blur carries legibility. */}
      <div className="relative flex items-center gap-1 px-2.5 py-2 rounded-full bg-[#0c1426]/50 backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-white/15 shadow-2xl shadow-black/50 [box-shadow:inset_0_1px_0_rgba(255,255,255,0.1),0_16px_40px_rgba(0,0,0,0.5)]">
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
              onClick={() => jumpToTop(tab.href, pathname)}
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
