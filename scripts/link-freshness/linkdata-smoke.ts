/**
 * Smoke-test the runtime link-data path without touching the Blob store.
 *
 * The property that matters most is the DEGRADED one: with no store reachable
 * (no BLOB_READ_WRITE_TOKEN here), loadVerifiedSources() must still answer from
 * the build-time copy rather than throwing — otherwise a store hiccup would
 * empty every channel instead of merely serving yesterday's links.
 *
 * Usage: npx tsx scripts/link-freshness/linkdata-smoke.ts
 */
import { loadVerifiedSources, loadVodIndex } from "../../lib/linkData";
import { getChannelSources, getChannelSourcesMap } from "../../lib/channelSources";

async function main() {
  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
    if (!ok) failures++;
  };

  const vs = await loadVerifiedSources();
  const channelCount = Object.keys(vs.channels || {}).length;
  check("loadVerifiedSources falls back without a store", channelCount > 0, `${channelCount} channels`);

  const vod = await loadVodIndex();
  const movieCount = Object.keys((vod as { movies?: object }).movies || {}).length;
  check("loadVodIndex falls back without a store", movieCount > 0, `${movieCount} movies`);

  const names = Object.keys(vs.channels || {});
  const sample = names.slice(0, 3);
  const { urls: map, confidence } = await getChannelSourcesMap(sample);
  check(
    "getChannelSourcesMap resolves slugs to URLs",
    sample.every((n) => (map[n]?.length ?? 0) > 0),
    sample.map((n) => `${n}=${map[n]?.length ?? 0}`).join(" "),
  );
  check(
    "inline list is capped",
    Object.values(map).every((u) => u.length <= 10),
    `max=${Math.max(0, ...Object.values(map).map((u) => u.length))}`,
  );
  // The player pulls the waiting bench up front on a weak channel, so a missing
  // or nonsense confidence would silently disable that path.
  check(
    "confidence accompanies every resolved channel",
    Object.keys(map).every((n) => typeof confidence[n] === "number" && confidence[n] >= 0),
    Object.keys(map).map((n) => `${n}=${confidence[n]}`).join(" "),
  );

  // Display-name lookup must survive slugging ("24/7 South Park" -> 24-7-...).
  const hgtv = await getChannelSources("HGTV");
  check("curated override leads", hgtv[0]?.includes("sky-hgtv") ?? false, hgtv[0] ?? "(none)");

  const missing = await getChannelSources("No Such Channel Ever");
  check("unknown channel yields empty, not a throw", Array.isArray(missing) && missing.length === 0);

  // With the store unreachable, repeated calls must NOT each attempt a fetch —
  // otherwise an outage puts a failed round-trip in front of every request.
  const errs: string[] = [];
  const realError = console.error;
  console.error = (...a: unknown[]) => void errs.push(String(a[0]));
  for (let i = 0; i < 5; i++) await loadVerifiedSources();
  console.error = realError;
  check("failed reads back off instead of retrying per call", errs.length === 0, `${errs.length} retries`);

  console.log(failures ? `\n${failures} check(s) failed.` : "\nall checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("smoke test threw — the degraded path is not safe:", err);
  process.exit(1);
});
