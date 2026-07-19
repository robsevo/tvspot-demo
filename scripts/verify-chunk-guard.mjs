/**
 * Verify that PRODUCTION serves guard-prefixed bytes for every built chunk.
 *
 * Why this exists: chunk-guard patches chunk CONTENT after Turbopack has fixed
 * the content-hashed FILENAME, so a guarded and an unguarded build of the same
 * code publish identical URLs with different bytes. If an unguarded build ever
 * goes (or stays) live, nothing local can detect it — the local artifact looks
 * perfect while the edge serves pre-guard bytes (observed live 2026-07-19:
 * .vercel/output chunk guarded at 44541 B, production returned 44483 B — the
 * exact pre-guard size — and the TV died with "globalThis is not defined").
 * So verification MUST read production, not the local build.
 *
 * Usage: node scripts/verify-chunk-guard.mjs [origin]   (after every deploy)
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ORIGIN = process.argv[2] || "https://tvspot.vercel.app";
const GUARD = 'if(typeof globalThis==="undefined"){self.globalThis=self;}';

// Prefer the artifact that was actually deployed (--prebuilt), else the build.
const roots = [
  join(process.cwd(), ".vercel", "output", "static", "_next", "static"),
  join(process.cwd(), ".next", "static"),
];
const root = roots.find((r) => {
  try { return statSync(r).isDirectory(); } catch { return false; }
});
if (!root) {
  console.error("verify-chunk-guard: no build output found — run the build first.");
  process.exit(1);
}

function* walk(dir, rel = "") {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p, `${rel}${name}/`);
    else if (name.endsWith(".js")) yield `${rel}${name}`;
  }
}

const files = Array.from(walk(root));
let ok = 0;
const bad = [];
for (const rel of files) {
  const url = `${ORIGIN}/_next/static/${rel}`;
  try {
    // Cache-buster: force a fresh edge fill so we test what NEW clients get,
    // not a stale entry this script itself warmed on a previous run.
    const res = await fetch(`${url}?vcg=${Date.now()}`);
    if (!res.ok) { bad.push(`${rel} — HTTP ${res.status}`); continue; }
    const head = (await res.text()).slice(0, 200);
    if (head.startsWith(GUARD) || head.includes(GUARD)) ok++;
    else bad.push(`${rel} — UNGUARDED (starts: ${head.slice(0, 60)}…)`);
  } catch (e) {
    bad.push(`${rel} — fetch failed: ${e.message}`);
  }
}

console.log(`verify-chunk-guard: ${ok}/${files.length} production chunks guarded (${ORIGIN})`);
if (bad.length) {
  console.error("FAILURES:");
  for (const b of bad) console.error("  " + b);
  process.exit(1);
}
