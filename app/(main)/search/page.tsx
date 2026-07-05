"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import PosterRail from "@/components/PosterRail";
import { LogoImage } from "@/components/LogoImage";
import { Search, X, Clock, TrendingUp, Loader2, Tv } from "lucide-react";
import { proxyFetch } from "@/lib/api";
import { useChannels } from "@/hooks/useChannels";
import { channelSlug } from "@/lib/sources";
import type { CatalogItem } from "@/lib/types";

const CORPUS_CACHE_KEY = "tvspot_search_corpus_v2";

/** Case/diacritic-insensitive normalize for matching. */
function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * Score a title against a query. Higher = better.
 * Prefix and word-boundary matches rank above mid-string substring matches.
 */
function scoreMatch(title: string, q: string): number {
  const t = norm(title);
  const n = norm(q);
  if (!t.includes(n)) return -1;
  if (t === n) return 100;
  if (t.startsWith(n)) return 80;
  // Word-boundary match: n at start of string or after a non-letter char
  const i = t.indexOf(n);
  if (i > 0 && !/\p{L}/u.test(t[i - 1])) return 60;
  return 30;
}

/** What the user is searching for — pick BEFORE typing to narrow everything. */
const SCOPES = ["All", "Channels", "Movies", "TV Shows"] as const;
type Scope = (typeof SCOPES)[number];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("All");
  const [corpus, setCorpus] = useState<{ movies: CatalogItem[]; series: CatalogItem[] }>({ movies: [], series: [] });
  const [corpusLoading, setCorpusLoading] = useState(true);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { channels } = useChannels();

  // Load recent searches
  useEffect(() => {
    try {
      setRecentSearches(JSON.parse(localStorage.getItem("tvspot_recent_searches") || "[]"));
    } catch {}
  }, []);

  // Load the searchable corpus once — the FULL universe (all service catalogs +
  // classics + trending), not just the trending slice, so anything browsable is
  // findable. Falls back to trending if the corpus route fails.
  useEffect(() => {
    const cached = sessionStorage.getItem(CORPUS_CACHE_KEY);
    if (cached) {
      try {
        setCorpus(JSON.parse(cached));
        setCorpusLoading(false);
        return;
      } catch {}
    }
    proxyFetch<{ movies: CatalogItem[]; series: CatalogItem[] }>("/api/lounge/search-corpus")
      .catch(() => proxyFetch<{ movies: CatalogItem[]; series: CatalogItem[] }>("/api/lounge/catalog?trending=true"))
      .then((data) => {
        const c = { movies: data.movies || [], series: data.series || [] };
        setCorpus(c);
        if (c.movies.length + c.series.length > 0) {
          try { sessionStorage.setItem(CORPUS_CACHE_KEY, JSON.stringify(c)); } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setCorpusLoading(false));
  }, []);

  // Live results — recomputed as the user types (instant, in-memory).
  const results = useMemo(() => {
    const q = query.trim();
    if (q.length < 1) return { movies: [], series: [] };
    const rank = (items: CatalogItem[]) =>
      items
        .map((it) => ({ it, s: scoreMatch(it.title, q) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s || (b.it.vote_average || 0) - (a.it.vote_average || 0))
        .map((x) => x.it);
    return { movies: rank(corpus.movies), series: rank(corpus.series) };
  }, [query, corpus]);

  // Live-TV channels matching the query (name-based), best match first.
  const channelResults = useMemo(() => {
    const q = query.trim();
    if (q.length < 1) return [];
    return channels
      .map((ch) => ({ ch, s: scoreMatch(ch.name, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.ch);
  }, [query, channels]);

  // Sections gated by the selected scope.
  const showChannels = scope === "All" || scope === "Channels";
  const showMovies = scope === "All" || scope === "Movies";
  const showSeries = scope === "All" || scope === "TV Shows";

  // Title suggestions derived from real matches (top of the in-scope lists).
  const suggestions = useMemo(() => {
    if (query.trim().length < 2) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    const pool = [
      ...(showChannels ? channelResults.map((c) => ({ title: c.name })) : []),
      ...(showMovies ? results.movies : []),
      ...(showSeries ? results.series : []),
    ];
    for (const it of pool) {
      const t = it.title?.trim();
      if (t && !seen.has(norm(t))) {
        seen.add(norm(t));
        out.push(t);
      }
      if (out.length >= 6) break;
    }
    return out;
  }, [results, channelResults, query, showChannels, showMovies, showSeries]);

  const commitRecent = useCallback((term: string) => {
    const t = term.trim();
    if (!t) return;
    setRecentSearches((prev) => {
      const updated = [t, ...prev.filter((s) => s !== t)].slice(0, 8);
      try { localStorage.setItem("tvspot_recent_searches", JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const clearSearch = () => {
    setQuery("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const hasQuery = query.trim().length >= 1;
  const noResults =
    hasQuery && !corpusLoading &&
    (!showMovies || results.movies.length === 0) &&
    (!showSeries || results.series.length === 0) &&
    (!showChannels || channelResults.length === 0);

  return (
    <div className="hud-grid-bg pt-14 min-h-screen pb-20 animate-page-rise">
      {/* z-20 (vs the hud-grid-bg > * default of z-1): the results container is a
          LATER SIBLING stacking context, so without this it paints over the
          suggestions dropdown regardless of the dropdown's own z-index. */}
      <div className="px-4 mb-3 relative z-20">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-cyan-400 flex items-center justify-center hud-glow">
            <Search className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-white text-lg font-bold">Search</h1>
            <p className="text-text-muted text-[11px]">
              {corpusLoading
                ? "Loading library…"
                : `${corpus.movies.length + corpus.series.length} titles · ${channels.length} channels`}
            </p>
          </div>
        </div>

        <div className="relative">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={(e) => { if (e.key === "Enter") { commitRecent(query); setShowSuggestions(false); } }}
              placeholder="Search movies and series..."
              autoComplete="off"
              className="w-full glass-card rounded-xl pl-10 pr-10 py-2.5 text-white text-sm placeholder-text-muted outline-none focus:ring-1 focus:ring-brand focus:shadow-[0_0_18px_rgba(37,99,235,0.35)] transition-all"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            {corpusLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted animate-spin" />
            )}
            {query && !corpusLoading && (
              <button type="button" onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-text-muted hover:text-white" />
              </button>
            )}
          </div>

          {/* Live suggestions dropdown (real matching titles). OPAQUE background,
              no fade-in: a translucent frame (glass-card or mid-animation opacity)
              lets the results rail behind bleed through and the text "fuses". */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#0c1426] ring-1 ring-white/10 rounded-xl overflow-hidden shadow-2xl shadow-black/60 z-30">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={() => { setQuery(s); commitRecent(s); setShowSuggestions(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:text-white hover:bg-white/5 flex items-center gap-2 transition-colors"
                >
                  <TrendingUp className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                  <span className="truncate">{s}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Scope picker — narrow to channels / movies / shows BEFORE typing. */}
        <div className="flex gap-2 overflow-x-auto poster-rail mt-3">
          {SCOPES.map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all ${
                scope === s
                  ? "bg-brand text-white ring-1 ring-brand/50 shadow-md shadow-brand/30"
                  : "glass-card text-text-secondary hover:text-white"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Recent searches (shown when query is empty) */}
        {!hasQuery && recentSearches.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-medium text-text-muted mb-2 flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> Recent
            </h3>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((s) => (
                <button
                  key={s}
                  onClick={() => { setQuery(s); commitRecent(s); }}
                  className="text-xs bg-card hover:bg-card/80 text-text-secondary hover:text-white px-3 py-1.5 rounded-full transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {hasQuery && (
        <div>
          {noResults ? (
            <div className="px-4 pt-8 text-center">
              <div className="w-16 h-16 rounded-full bg-card mx-auto mb-4 flex items-center justify-center">
                <Search className="w-6 h-6 text-text-muted" />
              </div>
              <p className="text-text-secondary text-sm">No results for "{query.trim()}"</p>
              <p className="text-text-muted text-xs mt-1">Try a different title</p>
            </div>
          ) : (
            <>
              {showChannels && channelResults.length > 0 && (
                <div className="mb-5">
                  <h2 className="text-white text-sm font-semibold px-4 mb-2">
                    Channels ({channelResults.length})
                  </h2>
                  <div className="flex gap-2 overflow-x-auto px-4 poster-rail">
                    {channelResults.slice(0, 20).map((ch) => (
                      <Link
                        key={ch.name}
                        href={`/live/${channelSlug(ch.name)}`}
                        className="flex-shrink-0 w-[104px] flex flex-col items-center gap-1.5 glass-card rounded-xl p-2.5 hover:bg-card/60 transition-colors"
                      >
                        <div className="w-14 h-11 rounded-lg bg-gradient-to-br from-zinc-200/90 via-zinc-400/75 to-zinc-600/70 flex items-center justify-center overflow-hidden p-1 ring-1 ring-white/15 relative">
                          <LogoImage
                            name={ch.name}
                            logoUrl={ch.logo_url || ch.logo}
                            className="w-full h-full object-contain"
                            fallbackClassName="text-gray-800"
                          />
                          {ch.online && (
                            <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-green-500 ring-1 ring-white" />
                          )}
                        </div>
                        <span className="text-text-secondary text-[10px] leading-tight text-center truncate w-full">{ch.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {showMovies && results.movies.length > 0 && (
                <PosterRail title={`Movies (${results.movies.length})`} items={results.movies.slice(0, 30)} kind="movie" />
              )}
              {showSeries && results.series.length > 0 && (
                <PosterRail title={`Series (${results.series.length})`} items={results.series.slice(0, 30)} kind="series" />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
