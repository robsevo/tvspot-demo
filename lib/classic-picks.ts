/**
 * Era-defining titles to GUARANTEE in Classics — the named requests plus reality
 * staples that discover misses on low vote counts. TMDB ids, verified.
 *
 * Shared by:
 *  - app/api/lounge/classics/route.ts — fetched by id and force-kept past the
 *    slice, so they always appear in the Classics rails
 *  - scripts/link-freshness/vod-index.ts — added to the index universe, so the
 *    nightly build indexes IPTV sources for them (they're pre-2010, outside the
 *    recent-skewed discover passes, and would otherwise never get direct links)
 */
export const CLASSIC_MOVIE_PICKS = [
  816, 817, 818,            // Austin Powers 1-3
  2105, 2770, 8273,         // American Pie, American Pie 2, American Wedding
  11397,                    // Not Another Teen Movie
  2109, 5175, 5174,         // Rush Hour 1-3
  9737, 8961,               // Bad Boys, Bad Boys II (classic-era; the 2020/2024 films
                            // are recent → already in the trending catalog + search)
  10050,                    // Get Over It (2001, Kirsten Dunst)
];

export const CLASSIC_TV_PICKS = [
  31343,                    // Jersey Shore
  607,                      // The Powerpuff Girls (1998)
  31677,                    // 30 for 30 (ESPN documentary series, 2009) — user request 2026-07-05
];

/**
 * POST-2010 titles to guarantee, for a different reason than the Classics above.
 *
 * The backend serves each service catalog capped at 200 movies, and that slice
 * IS the browsable universe. A title the panels genuinely carry but which lands
 * outside every service's 200 is invisible everywhere: not in browse, not in
 * search, and — worse — not in the nightly VOD index either, so even a direct
 * deep link resolves only to the slow Vercel-proxied fallback tier instead of
 * the relay's own sources.
 *
 * The Hobbit was exactly that: Crave's 200 happened to include part 3, so it had
 * 8 relay sources and showed up normally, while parts 1 and 2 had 1 proxied
 * source each and appeared nowhere — despite the backend index holding 8 and 10
 * sources for them under `name:thehobbitanunexpectedjourney` /
 * `…thedesolationofsmaug`.
 *
 * These are NOT classics — keep them out of CLASSIC_MOVIE_PICKS, which force-
 * keeps into the pre-2010 Classics rails and would file a 2012 film there.
 *
 * Consumed by:
 *  - app/api/lounge/catalog/route.ts — injected into trending, so they are
 *    browsable AND searchable (search-corpus reads the trending catalog)
 *  - scripts/link-freshness/vod-index.ts — added to the index universe, so the
 *    nightly build indexes the panels' real sources for them
 */
export const ALWAYS_INCLUDE_MOVIE_PICKS = [
  49051,                    // The Hobbit: An Unexpected Journey (2012) — user request 2026-07-27
  57158,                    // The Hobbit: The Desolation of Smaug (2013) — user request 2026-07-27
                            // (part 3, 122917, already arrives via Crave's catalog)
];
