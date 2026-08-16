/**
 * The geometry half of D-pad spatial navigation, split out from TvNav so it can
 * be tested without a DOM, a browser, or React. TvNav owns the key handling and
 * the element lookup; this owns "given these rectangles, which one is `dir` of
 * the current one".
 */

export type NavDir = "up" | "down" | "left" | "right";

/** The subset of DOMRect this needs — so a test can supply plain numbers. */
export interface NavRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Index of the best candidate in `dir`, or -1.
 *
 * Primary axis is centre-to-centre distance along the direction of travel.
 * Cross-axis drift is the GAP BETWEEN THE RANGES — zero whenever they overlap —
 * and NOT the distance between centres.
 *
 * That distinction is the whole reason this function exists separately. Drift
 * used to be `Math.abs(dx)` between centres, which punished WIDE candidates for
 * being wide even when they fully CONTAINED the current element. The EPG guide
 * is where it bit: a channel row with no programme data renders ONE full-width
 * button spanning the whole timeline, so its centre sits hours away from a
 * narrow programme block directly above it.
 *
 * Measured with the guide's own geometry (PX_PER_MIN 8, ROW_H 112, 6h span),
 * pressing DOWN from a 30-minute block in row 0:
 *     adjacent empty row 1 (which contains it) ... 2748
 *     row 2 with an aligned programme ............  224   <- won
 * so the remote skipped straight past every channel with no schedule. As a gap
 * those score 112 and 224, the adjacent row wins, and that is what a viewer
 * means by "down". Overlapping candidates now cost 0 drift, so width stops being
 * a penalty while alignment still breaks ties.
 *
 * Non-overlapping candidates carry a flat 10000 so they only win when nothing in
 * the same row/column exists at all (e.g. dropping from a hero button to a rail).
 */
export function pickNextIndex(cur: NavRect, rects: NavRect[], dir: NavDir): number {
  const cx = cur.left + (cur.right - cur.left) / 2;
  const cy = cur.top + (cur.bottom - cur.top) / 2;
  let best = -1;
  let bestScore = Infinity;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    const dx = r.left + (r.right - r.left) / 2 - cx;
    const dy = r.top + (r.bottom - r.top) / 2 - cy;

    let primary: number;
    let secondary: number;
    let overlaps: boolean;
    if (dir === "left" || dir === "right") {
      if (dir === "left" ? dx >= -1 : dx <= 1) continue;
      primary = Math.abs(dx);
      secondary = Math.max(0, cur.top - r.bottom, r.top - cur.bottom);
      overlaps = r.bottom > cur.top && r.top < cur.bottom;
    } else {
      if (dir === "up" ? dy >= -1 : dy <= 1) continue;
      primary = Math.abs(dy);
      secondary = Math.max(0, cur.left - r.right, r.left - cur.right);
      overlaps = r.right > cur.left && r.left < cur.right;
    }

    const score = primary + secondary * 2 + (overlaps ? 0 : 10000);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
