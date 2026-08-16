/**
 * Regression test for how a failed probe is CLASSIFIED.
 *
 *   bun scripts/test-stream-verdicts.ts
 *
 * No test framework in this repo, so this is a standalone runnable that imports
 * the REAL module and exits non-zero on failure. `fetch` is stubbed per case so
 * the classification is tested without touching a panel.
 *
 * WHY IT EXISTS. `checkStream` treated 456/429 as "busy (connection limit)" and
 * everything else as a permanent failure. 403 fell into "permanent" — but 403 is
 * how an upstream host.an upstream host.co says "my one connection is already in use", and that
 * panel is the FIRST source for 23 of the 126 live channels.
 *
 * Measured 2026-08-16 against the live relay, four an upstream host channels probed
 * together, three trials, identical every time:
 *
 *   each alone  -> 200 200 200 200
 *   concurrent  -> ['403','403','403','200']    exactly one winner
 *
 * So a second TV in the house (the reported case: a Samsung app and a Fire Stick)
 * gets 403 for streams that are fine. As a permanent failure that is the one
 * verdict useStreamCheck.statusOf() badges dead ON SIGHT, with no hysteresis —
 * condemning a working source for the rest of the session.
 *
 * The fix marks 403 `retryable` but NOT `busy`, and BOTH halves are load-bearing:
 *
 *   - retryable  -> statusOf() holds it as "busy" while DEAD_STREAK rounds
 *                   disagree, so a contended source survives to be retried.
 *   - not busy   -> statusOf() returns "busy" for r.busy BEFORE it looks at the
 *                   fail streak, so a genuinely forbidden 403 (geo-block, dead
 *                   credentials) would sit at "busy" forever and never resolve.
 *
 * Capacity recovers; forbidden still dies. Pin both directions.
 */
import { checkStream, checkVodSource, type StreamCheck } from "../lib/stream-verify";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

const realFetch = globalThis.fetch;

/** Answer every probe with `status`, and a valid playlist body when it's a 200. */
function stubFetch(status: number) {
  const body = "#EXTM3U\n#EXTINF:10.0,\nhttps://relay.example.com/ts?u=x\n";
  globalThis.fetch = (async () =>
    new Response(status === 200 ? body : "", {
      status,
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    })) as typeof fetch;
}

async function live(status: number): Promise<StreamCheck> {
  stubFetch(status);
  return checkStream("https://relay.example.com/m3u8?u=test");
}
async function vod(status: number): Promise<StreamCheck> {
  stubFetch(status);
  return checkVodSource("https://relay.example.com/vod?u=test", "https://tvspot.vercel.app");
}

async function main() {
  console.log("\nlive probe (checkStream)\n");

  const ok = await live(200);
  check("200 verifies working", ok.ok === true, JSON.stringify(ok));

  // THE REGRESSION.
  const f403 = await live(403);
  check("403 is NOT a permanent failure — it is retryable", f403.retryable === true,
    `retryable=${f403.retryable}`);
  check("403 is NOT flagged busy (must stay able to resolve to dead)", !f403.busy,
    `busy=${f403.busy}`);
  check("403 is still a failure (ok=false)", f403.ok === false, `ok=${f403.ok}`);

  // The codes that ARE an explicit connection-limit signal keep short-circuiting
  // to busy — those panels say so unambiguously, so no hysteresis is needed.
  for (const s of [456, 429, 509]) {
    const r = await live(s);
    check(`${s} is flagged busy outright`, r.busy === true && r.retryable === true,
      `busy=${r.busy} retryable=${r.retryable}`);
  }

  // Genuinely broken statuses must stay permanent, or a dead source is never
  // condemned and keeps getting picked ahead of one that plays.
  for (const s of [401, 404, 410, 500]) {
    const r = await live(s);
    check(`${s} stays a permanent failure`, !r.busy && !r.retryable,
      `busy=${r.busy} retryable=${r.retryable}`);
  }

  console.log("\nVOD probe (checkVodSource) — same panels, same 403\n");

  const v403 = await vod(403);
  check("403 is retryable", v403.retryable === true, `retryable=${v403.retryable}`);
  check("403 is not busy", !v403.busy, `busy=${v403.busy}`);
  const v401 = await vod(401);
  check("401 stays permanent", !v401.busy && !v401.retryable,
    `busy=${v401.busy} retryable=${v401.retryable}`);
  const v456 = await vod(456);
  check("456 is busy", v456.busy === true, `busy=${v456.busy}`);

  globalThis.fetch = realFetch;

  console.log(
    failures === 0
      ? `\n✓ ALL PASS — probe verdict classification\n`
      : `\n✗ ${failures} FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
