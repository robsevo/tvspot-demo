/**
 * Regression test for D-pad spatial navigation — EPG guide rows with no
 * programme data were being skipped.
 *
 *   bun scripts/test-tv-nav.ts
 *
 * No test framework here, so this is a standalone runnable that exits non-zero
 * on failure. It drives the REAL scoring function from lib/tvNavGeometry (which
 * is why that split exists): pure rectangles in, index out — no DOM, no React,
 * no jsdom dependency.
 *
 * Geometry is the guide's own: PX_PER_MIN 8, ROW_H 112, over a 6-hour span.
 */
import { pickNextIndex, type NavRect, type NavDir } from "../lib/tvNavGeometry";

const PX_PER_MIN = 8;
const ROW_H = 112;
const SPAN = 360 * PX_PER_MIN;

const box = (left: number, width: number, row: number): NavRect => ({
  left, right: left + width, top: row * ROW_H, bottom: row * ROW_H + ROW_H,
});

// row 0: a 30-min programme at the far left, then a 60-min one after it
// row 1: NO programme data — ONE button spanning the whole timeline
// row 2: a programme aligned under row 0's first block
const NAMES = ["r0-prog", "r0-prog2", "r1-empty", "r2-prog"];
const RECTS: NavRect[] = [
  box(2, 30 * PX_PER_MIN, 0),
  box(2 + 30 * PX_PER_MIN, 60 * PX_PER_MIN, 0),
  box(2, SPAN - 4, 1),
  box(2, 30 * PX_PER_MIN, 2),
];

let failures = 0;
const move = (from: string, dir: NavDir) => {
  const i = NAMES.indexOf(from);
  const rest = RECTS.filter((_, j) => j !== i);
  const names = NAMES.filter((_, j) => j !== i);
  const k = pickNextIndex(RECTS[i]!, rest, dir);
  return k < 0 ? null : names[k]!;
};
const check = (label: string, got: string | null, want: string) => {
  if (got === want) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label} — expected ${want}, got ${got}`); }
};

console.log("\nempty guide rows must NOT be skipped");
check("DOWN from a programme lands on the adjacent EMPTY row", move("r0-prog", "down"), "r1-empty");
check("DOWN again continues to the next row", move("r1-empty", "down"), "r2-prog");
check("UP from row 2 lands back on the empty row", move("r2-prog", "up"), "r1-empty");
check("UP from the empty row reaches row 0", move("r1-empty", "up"), "r0-prog");

console.log("\nordinary movement is unchanged");
check("RIGHT moves along the row", move("r0-prog", "right"), "r0-prog2");
check("LEFT moves back", move("r0-prog2", "left"), "r0-prog");

console.log(failures === 0 ? "\n✓ ALL PASS — TV spatial navigation\n" : `\n✗ ${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
