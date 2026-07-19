"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search, LayoutGrid, Bookmark, ShoppingBag, Settings } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTvBack } from "@/components/tv/TvNav";
import { TVKEY } from "@/lib/tv";

const ITEMS = [
  { key: "search", label: "Search", href: "/tv/search", Icon: Search },
  { key: "menu", label: "Main menu", href: "/tv", Icon: LayoutGrid },
  { key: "stuff", label: "My Stuff", href: "/tv/my-stuff", Icon: Bookmark },
  { key: "store", label: "Store", href: "/tv/vod", Icon: ShoppingBag },
  { key: "settings", label: "Settings", href: "/tv/settings", Icon: Settings },
] as const;

type ItemKey = (typeof ITEMS)[number]["key"];

/** Collapsed rail shows these four glyphs (Prime hides Settings until open). */
const COLLAPSED: ItemKey[] = ["search", "menu", "stuff", "store"];

/**
 * Prime-style side menu. Collapsed: a quiet icon rail pinned to the left
 * edge — pressing Left from the leftmost content lands on it, and receiving
 * focus is what expands the overlay (exactly Prime's behavior). Expanded:
 * profile + labeled items over a left-anchored scrim; Back or Right closes
 * and returns focus to where the user came from.
 */
export default function TvSideMenu() {
  const { username } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [openWith, setOpenWith] = useState<ItemKey | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const focusItemRef = useRef<HTMLButtonElement | null>(null);
  const open = openWith !== null;

  const close = useCallback((restoreFocus: boolean) => {
    setOpenWith(null);
    if (restoreFocus) {
      const el = restoreRef.current;
      restoreRef.current = null;
      // Next frame — after the trap unmounts — or the focus lands on a dead node.
      requestAnimationFrame(() => el?.focus());
    }
  }, []);

  const closeOnBack = useCallback(() => close(true), [close]);
  useTvBack(open ? closeOnBack : null);

  // Right steps back out of the menu, like Prime. TvNav's own listener runs
  // first and finds nothing to the right inside the trap, so this only ever
  // fires when the move is off the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.keyCode === TVKEY.right) close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Focus the item the collapsed rail was entered on.
  useEffect(() => {
    if (open) focusItemRef.current?.focus();
  }, [open]);

  // A navigation (Enter on an item) closes without focus restore.
  useEffect(() => {
    setOpenWith(null);
  }, [pathname]);

  const go = (href: string) => {
    close(false);
    if (href !== pathname) router.push(href);
  };

  const initial = (username || "?").charAt(0).toUpperCase();

  return (
    <>
      {/* Collapsed rail */}
      {!open && (
        <div className="fixed left-0 inset-y-0 z-20 flex flex-col items-center justify-center gap-8 w-14">
          {ITEMS.filter((i) => COLLAPSED.includes(i.key)).map(({ key, label, Icon }) => (
            <button
              key={key}
              data-tv
              aria-label={label}
              className="tv-pill p-2 rounded-lg text-[#aebbc5] focus:outline-none"
              onFocus={(e) => {
                restoreRef.current =
                  e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
                setOpenWith(key);
              }}
            >
              <Icon className="w-6 h-6" />
            </button>
          ))}
        </div>
      )}

      {/* Expanded overlay */}
      {open && (
        <div
          data-tv-trap
          className="fixed inset-0 z-40 bg-gradient-to-r from-[#00050d] via-[#00050d]/85 to-transparent"
        >
          <div className="h-full flex flex-col justify-center gap-3 pl-10 w-96">
            <button
              data-tv
              onClick={() => go("/tv/settings")}
              className="tv-pill group flex items-center gap-5 py-2 text-left focus:outline-none"
            >
              <span className="w-12 h-12 rounded-full bg-[#4a5ed4] flex items-center justify-center text-xl font-bold text-white shrink-0 group-focus:ring-4 group-focus:ring-white">
                {initial}
              </span>
              <span className="text-2xl font-semibold text-white">{username || "Profile"}</span>
            </button>

            {ITEMS.map(({ key, label, href, Icon }) => (
              <button
                key={key}
                data-tv
                ref={key === openWith ? focusItemRef : undefined}
                onClick={() => go(href)}
                className="tv-pill group flex items-center gap-5 py-2 text-left focus:outline-none"
              >
                <span className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-white group-focus:bg-white group-focus:text-black">
                  <Icon className="w-6 h-6" />
                </span>
                <span className="text-2xl text-[#c7d5e0] group-focus:text-white group-focus:font-semibold">
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
