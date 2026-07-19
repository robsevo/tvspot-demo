"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { Film, Tv, Search } from "lucide-react";
import { useCatalog, useServiceCatalog, prewarmService } from "@/hooks/useCatalog";
import { useTvBack } from "@/components/tv/TvNav";
import TvLandscapeCard from "@/components/tv/TvLandscapeCard";
import type { CatalogItem } from "@/lib/types";

type Tab = "movies" | "series" | "search";

/** Grid cap — the 2019 TV webview can't hold hundreds of <img> cards in
 *  memory. curate() sorts by current popularity, so the cut keeps the titles
 *  people actually open; anything deeper is one search away. */
const GRID_MAX = 40;
const SEARCH_MAX = 30;

/** Survives SPA navigation (module scope, like vodPrewarm's cache): Back from
 *  a title's detail page reopens the same provider+tab instead of dumping the
 *  user at the picker every time. Resets on a full app relaunch. Written via
 *  rememberView() — components must not reassign module state directly. */
let remembered: { service: string; tab: Tab } | null = null;
function rememberView(v: { service: string; tab: Tab } | null) {
  remembered = v;
}

/** Service-first VOD browse — the mobile /vod flow at 10-foot scale: pick a
 *  provider, then browse its movies / series or search within it. */
export default function TvVodPage() {
  const { services, summary, loading: servicesLoading, error: servicesError, refetch } = useCatalog();
  const [service, setService] = useState<string | null>(remembered?.service ?? null);
  const [tab, setTab] = useState<Tab>(remembered?.tab ?? "movies");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const { movies, series, loading, label } = useServiceCatalog(service);

  // Back inside a provider returns to the picker; at the picker the default
  // (router.back → home) applies.
  useTvBack(
    service
      ? () => {
          setService(null);
          setQuery("");
          rememberView(null);
        }
      : null,
  );

  const openService = (svc: string) => {
    setService(svc);
    setTab("movies");
    setQuery("");
    rememberView({ service: svc, tab: "movies" });
  };
  const openTab = (t: Tab) => {
    setTab(t);
    if (service) rememberView({ service, tab: t });
  };

  // The picker/tab switch drops DOM focus; the search field is the one place
  // where waiting for an arrow press would mean a dead keyboard — focus it.
  useEffect(() => {
    if (tab === "search") searchRef.current?.focus();
  }, [tab]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const match = (i: CatalogItem) => (i.title || "").toLowerCase().includes(q);
    return [
      ...movies.filter(match).map((m) => ({ ...m, kind: "movie" as const })),
      ...series.filter(match).map((s) => ({ ...s, kind: "series" as const })),
    ].slice(0, SEARCH_MAX);
  }, [query, movies, series]);

  /* ---------------- Provider picker ---------------- */

  if (!service) {
    return (
      <div className="px-16 pb-16">
        <h1 className="text-3xl font-bold text-white mb-8">Movies &amp; Shows</h1>
        {servicesLoading && services.length === 0 ? (
          <p className="py-10 text-xl text-[#8197a4]">
            Loading providers… the first load after a quiet day can take a minute.
          </p>
        ) : services.length === 0 ? (
          // Never a silent blank on a TV: the fetch failed (or returned
          // nothing) and there's no cursor to "just reload" with.
          <div className="py-10">
            <p className="text-xl text-[#aebbc5] mb-6">
              {servicesError ? "Couldn't load the providers." : "No providers available."}
            </p>
            <button
              data-tv
              data-tv-autofocus
              onClick={() => refetch()}
              className="px-8 py-3 rounded-full bg-white text-black text-lg font-semibold focus:outline-none"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6">
            {services.map((svc, i) => {
              const s = summary[svc];
              const counts = [
                s?.movies_count ? `${s.movies_count} movies` : null,
                s?.series_count ? `${s.series_count} series` : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={svc}
                  data-tv
                  {...(i === 0 ? { "data-tv-autofocus": true } : {})}
                  onClick={() => openService(svc)}
                  onFocus={() => prewarmService(svc)}
                  className="text-left rounded-xl bg-[#1a242f] ring-1 ring-white/10 px-8 py-7 focus:outline-none"
                >
                  <p className="text-2xl font-bold text-white">{svc}</p>
                  {counts && <p className="text-lg text-[#8197a4] mt-1">{counts}</p>}
                  {typeof s?.preview === "string" ? (
                    <p className="text-base text-[#5f7180] mt-3 line-clamp-2">{s.preview}</p>
                  ) : s?.preview?.length ? (
                    // Backend previews are sample titles — a little poster strip
                    // sells the tile better than any text could.
                    <div className="flex gap-2 mt-4 overflow-hidden">
                      {s.preview.slice(0, 3).map(
                        (p, j) =>
                          p.poster && (
                            <img
                              key={p.tmdb_id ?? j}
                              src={p.poster}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="w-16 h-24 rounded object-cover ring-1 ring-white/10"
                            />
                          ),
                      )}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ---------------- Inside a provider ---------------- */

  const gridItems: Array<CatalogItem & { kind: "movie" | "series" }> =
    tab === "movies"
      ? movies.slice(0, GRID_MAX).map((m) => ({ ...m, kind: "movie" as const }))
      : tab === "series"
        ? series.slice(0, GRID_MAX).map((s) => ({ ...s, kind: "series" as const }))
        : searchResults;

  const overflow =
    tab === "movies"
      ? Math.max(0, movies.length - GRID_MAX)
      : tab === "series"
        ? Math.max(0, series.length - GRID_MAX)
        : 0;

  const pill = (t: Tab, icon: React.ReactNode, text: string, count?: number) => (
    <button
      data-tv
      onClick={() => openTab(t)}
      className={`flex items-center gap-2.5 px-6 py-2.5 rounded-full text-lg font-semibold ring-1 focus:outline-none ${
        tab === t
          ? "bg-white text-black ring-white"
          : "bg-white/10 text-[#aebbc5] ring-white/15"
      }`}
    >
      {icon}
      {text}
      {typeof count === "number" && count > 0 && (
        <span className={`text-base ${tab === t ? "text-black/60" : "text-[#8197a4]"}`}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <div className="px-16 pb-16">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-white">{label || service}</h1>
        <p className="text-lg text-[#5f7180]">Back returns to providers</p>
      </div>

      <div className="flex items-center gap-4 mb-8">
        {pill("movies", <Film className="w-5 h-5" />, "Movies", movies.length)}
        {series.length > 0 && pill("series", <Tv className="w-5 h-5" />, "Series", series.length)}
        {pill("search", <Search className="w-5 h-5" />, "Search")}
      </div>

      {tab === "search" && (
        <div className="mb-8">
          <input
            ref={searchRef}
            data-tv
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label || service}…`}
            className="w-[40rem] max-w-full bg-[#1a242f] ring-1 ring-white/10 rounded-lg px-5 py-3 text-xl text-white placeholder-[#5f7180] focus:outline-none"
          />
        </div>
      )}

      {loading && gridItems.length === 0 ? (
        <p className="py-10 text-xl text-[#8197a4]">Loading {service}…</p>
      ) : gridItems.length === 0 ? (
        <p className="py-10 text-xl text-[#8197a4]">
          {tab === "search"
            ? query.trim()
              ? "No titles match."
              : "Press Enter on the box to type."
            : "Nothing here yet."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-6">
            {gridItems.map((item) => (
              <TvLandscapeCard
                key={`${item.kind}-${item.tmdb_id}`}
                tmdbId={item.tmdb_id}
                title={item.title}
                backdrop={item.backdrop}
                poster={item.poster}
                kind={item.kind}
                fluid
              />
            ))}
          </div>
          {overflow > 0 && (
            <p className="mt-8 text-lg text-[#5f7180]">
              {overflow} more title{overflow === 1 ? "" : "s"} — use Search to find them.
            </p>
          )}
        </>
      )}
    </div>
  );
}
