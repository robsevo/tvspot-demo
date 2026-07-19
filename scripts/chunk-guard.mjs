/**
 * Prepend a globalThis self-heal guard to every built client chunk.
 *
 * Why: on the 2019 Samsung webview (Tizen 5.0 ≈ Chromium 63) the app chunks are
 * <script async> tags emitted ABOVE the layout's inline polyfill script, and the
 * service worker serves them cache-first — so a chunk can evaluate before the
 * polyfill defines globalThis. Turbopack chunks reference globalThis on line 1,
 * so a lost race kills the entire page at eval time (observed live on the TV as
 * "ReferenceError: globalThis is not defined" at chunk 1:1, page frozen at its
 * SSR state). Making every chunk define globalThis itself removes the ordering
 * dependency entirely; the full polyfill set still loads from the layout before
 * hydration, which is when everything else is first used.
 *
 * Runs as part of `npm run build` (after `next build`), so both `vercel build`
 * and local builds emit guarded chunks. Idempotent — re-running is a no-op.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

// `self` exists in both window and worker contexts; ES5-only syntax on purpose.
const GUARD = 'if(typeof globalThis==="undefined"){self.globalThis=self;}';

const root = join(process.cwd(), ".next", "static");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith(".js")) yield p;
  }
}

let patched = 0;
let skipped = 0;
for (const file of walk(root)) {
  const src = readFileSync(file, "utf8");
  if (src.startsWith(GUARD) || src.includes(GUARD)) {
    skipped++;
    continue;
  }
  // A leading "use strict" directive must stay first to keep its effect —
  // insert the guard just after it; otherwise prepend.
  const m = src.match(/^(\s*(?:"use strict"|'use strict');?)/);
  const out = m ? src.slice(0, m[0].length) + GUARD + src.slice(m[0].length) : GUARD + src;
  writeFileSync(file, out);
  patched++;
}

if (patched + skipped === 0) {
  console.error("chunk-guard: no .js chunks found under .next/static — build layout changed?");
  process.exit(1);
}
console.log(`chunk-guard: ${patched} chunk(s) guarded, ${skipped} already guarded.`);
