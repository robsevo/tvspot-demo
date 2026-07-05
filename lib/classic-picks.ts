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
