/**
 * Fail the build if the nightly link data got compiled into a CLIENT chunk.
 *
 * This is the regression guard for the change that stopped the nightly link
 * refresh from force-reloading every open client. data/verified-sources.json and
 * data/vod-index.json are rewritten every night; while `lib/sources.ts` imported
 * verified-sources.json and client components called getChannelSources(), ~480KB
 * of stream links sat in a client chunk. So each refresh changed a chunk hash →
 * new buildId → DeployRefresh reloaded every phone and TV, nightly, and the whole
 * link list was served from /_next/static, which middleware.ts excludes from auth.
 *
 * The data is now fetched at request time (lib/linkData.ts, private Blob store)
 * and only ever touched server-side. `import "server-only"` already makes a
 * client import a compile error — this checks the built output too, which also
 * catches the case where someone copies a literal slice of the data into a
 * component.
 *
 * Runs as part of `npm run build`, after `next build`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), ".next", "static");
if (!existsSync(root)) {
  console.error("[link-data-guard] no .next/static — run after `next build`.");
  process.exit(1);
}

/**
 * Markers that only ever appear in the freshness pipeline's output. Kept
 * specific on purpose: a channel name or a bare domain would false-positive on
 * ordinary UI code, whereas these are per-source record fields and the relay's
 * proxy path, which the client only ever receives as runtime response DATA.
 */
const MARKERS = [
  "firstSeenUtc", // verified-sources.json per-source record field
  "verifiedUtc", //  ditto
  "pipeline_version", // verified-sources.json meta
  "relay.example.com/m3u8?u=", // a materialised relay link (not the bare host)
];

/** A handful of hits is a literal in code; a bundled data file is thousands. */
const THRESHOLD = 5;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith(".js")) yield p;
  }
}

const offenders = [];
for (const file of walk(root)) {
  const src = readFileSync(file, "utf8");
  const hits = MARKERS.map((m) => [m, src.split(m).length - 1]).filter(([, n]) => n > 0);
  const total = hits.reduce((a, [, n]) => a + n, 0);
  if (total >= THRESHOLD) {
    offenders.push({ file: file.replace(process.cwd() + "/", ""), total, hits });
  }
}

if (offenders.length) {
  console.error(
    "\n[link-data-guard] FAIL — nightly link data is in the client bundle again.\n" +
      "Every nightly refresh would change these chunks and force every open\n" +
      "client to reload. Keep the data server-side (lib/linkData.ts) and pass it\n" +
      "to the player as response data (channel.verified_sources).\n",
  );
  for (const o of offenders) {
    console.error(`  ${o.file}  (${o.total} matches)`);
    for (const [marker, n] of o.hits) console.error(`      ${marker} × ${n}`);
  }
  console.error("");
  process.exit(1);
}

console.log(`[link-data-guard] ok — no link data in client chunks.`);
