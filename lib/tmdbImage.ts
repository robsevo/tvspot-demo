/**
 * Upsize a TMDB image URL to the largest useful size for a BIG display (the
 * 10-foot hero and the detail-page hero) — the deliberate opposite of the card
 * downsizer in TvLandscapeCard.
 *
 * Why this is needed: the catalog serves w1280 backdrops (crisp on a 1080p TV),
 * but two paths feed the big heroes lower-res art that then upscales and looks
 * soft/pixelated:
 *   • /lounge/vod/details returns w780 backdrops (detail-page hero), and
 *   • posters are only ever w500, so any poster shown as hero art is stretched.
 *
 * The size ladders differ by asset type and DO NOT overlap: backdrops offer
 * …/w780/w1280, posters offer …/w500/w780 (there is no w1280 poster — asking
 * for a size the type lacks 404s). So the caller says which it has.
 *
 * Handles both the raw TMDB URL and the /api/images-proxied form (where the
 * path is percent-encoded, so the size reads as %2Fw780%2F). A URL with no TMDB
 * size segment (already-proxied Origin art, a data: URI, …) passes through
 * unchanged. Safe on an already-max URL — it just rewrites to the same size.
 */
export function heroArt(url: string, isBackdrop: boolean): string {
  const size = isBackdrop ? "w1280" : "w780";
  return url
    .replace(/%2F(?:w\d+|original)%2F/, `%2F${size}%2F`)
    .replace(/\/(?:w\d+|original)\//, `/${size}/`);
}
