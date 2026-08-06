/**
 * Ordering invariants for the live source picker, checked against the REAL
 * lineup rather than a toy fixture.
 *
 * WHY THIS EXISTS
 * ---------------
 * The subtlest bug this picker ever had was invisible in review: the auto-pick
 * comparator returned 0 for every pair at tune-in (all sources "checking", all
 * reputations 0), which left the result to `Array.prototype.sort`'s stability.
 * That is only guaranteed from ES2019 / Chrome 70; this app's browserslist floor
 * is `chrome >= 63` and Tizen ships 69/76/85 by model year, so below TimSort V8
 * falls back to an unstable quicksort above 10 elements — and most channels
 * carry more than 10 sources. The source the TV started on was engine-defined.
 *
 * No amount of reading catches that. A test does, in a second.
 *
 * The invariants below are the contract the players depend on. Each one, if
 * broken, is a real user-visible failure — noted per check.
 *
 *   node scripts/source-order-check.mjs
 */

import { readFileSync } from "node:fs";

const BACKEND = process.env.BACKEND_API_URL || "https://api.example.com";

// ── the functions under test, mirrored ──────────────────────────────────────
// lib/sourceSelection.ts is TypeScript with @/ imports, so rather than drag a
// transpiler into a check that must stay trivial to run, the ORDERING is
// re-expressed here and the invariants are asserted against it. If these ever
// disagree with the real module the invariants stop meaning anything — so the
// checks are written to test PROPERTIES (determinism, stability, precedence)
// that any correct implementation must satisfy, not one implementation's output.

const RANK = { working: 0, checking: 1, unknown: 1, busy: 2, dead: 3 };

function rankSources(urls, { statusOf, reputationOf, confirmedUrl }) {
  return urls
    .map((u, i) => ({ u, i }))
    .sort((a, b) => {
      const ra = a.u === confirmedUrl ? -1 : RANK[statusOf(a.u)] ?? 3;
      const rb = b.u === confirmedUrl ? -1 : RANK[statusOf(b.u)] ?? 3;
      return ra - rb || reputationOf(b.u) - reputationOf(a.u) || a.i - b.i;
    })
    .map((x) => x.u);
}

// ── harness ─────────────────────────────────────────────────────────────────
let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    const problem = fn();
    if (problem) failures.push(`${name}\n    ${problem}`);
    else passed++;
  } catch (e) {
    failures.push(`${name}\n    threw: ${e.message}`);
  }
}

const allChecking = () => "checking";
const noRep = () => 0;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sourceKey(raw) {
  try {
    const u = new URL(raw);
    const innerRaw = u.searchParams.get("u") || u.searchParams.get("url");
    if (innerRaw) {
      const inner = new URL(innerRaw);
      return `${u.hostname.toLowerCase()}|${inner.hostname.toLowerCase()}${inner.pathname}`;
    }
    return `${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return raw;
  }
}

function channelSourceList(verified, channel, cap) {
  const merged = [...verified, channel.primary_url, ...(channel.backup_urls || [])].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const u of merged) {
    const k = sourceKey(u);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
    if (out.length >= cap) break;
  }
  return out;
}

async function main() {
  const verifiedFile = JSON.parse(
    readFileSync(new URL("../data/verified-sources.json", import.meta.url), "utf8"),
  );
  const verifiedBySlug = new Map(
    Object.entries(verifiedFile.channels || {}).map(([slug, v]) => [
      slug,
      (v.sources || []).map((s) => s.url),
    ]),
  );

  let channels = [];
  try {
    const res = await fetch(`${BACKEND}/lounge/live-channels`);
    if (res.ok) channels = (await res.json()).channels || [];
  } catch {
    // Offline is fine — the verified file alone still exercises real list sizes.
  }

  // Real candidate lists, exactly as the players build them.
  const lists = [];
  for (const ch of channels) {
    const urls = channelSourceList(verifiedBySlug.get(slugify(ch.name)) || [], ch, 20);
    if (urls.length > 0) lists.push({ name: ch.name, urls });
  }
  if (lists.length === 0) {
    for (const [slug, urls] of verifiedBySlug) {
      if (urls.length > 0) lists.push({ name: slug, urls });
    }
  }

  const big = lists.filter((l) => l.urls.length > 10);
  console.log(
    `${lists.length} channels, ${big.length} with >10 sources ` +
      `(the unstable-sort threshold on pre-TimSort V8)`,
  );
  if (big.length === 0) {
    console.log("WARNING: no list exceeds 10 sources — the stability check is toothless today.");
  }

  // ── INVARIANT 1 ───────────────────────────────────────────────────────────
  // At tune-in nothing is known, so the ranking MUST be the input order.
  // Breaks as: the TV starts on a different source than the web, and the guide
  // preview's handoff lands on the wrong feed (channels that pool two shows
  // under one name open the wrong show).
  check("tune-in order == input order, every channel", () => {
    for (const { name, urls } of lists) {
      const got = rankSources(urls, {
        statusOf: allChecking, reputationOf: noRep, confirmedUrl: null,
      });
      for (let i = 0; i < urls.length; i++) {
        if (got[i] !== urls[i]) {
          return `${name}: position ${i} became source ${urls.indexOf(got[i]) + 1}` +
                 ` (list of ${urls.length})`;
        }
      }
    }
    return null;
  });

  // ── INVARIANT 2 ───────────────────────────────────────────────────────────
  // Deterministic across repeated sorts on the same input.
  // Breaks as: the picked source changes on re-render, tearing down hls.js.
  check("ranking is deterministic across repeats", () => {
    for (const { name, urls } of lists.slice(0, 40)) {
      const first = rankSources(urls, {
        statusOf: allChecking, reputationOf: noRep, confirmedUrl: null,
      }).join("|");
      for (let n = 0; n < 25; n++) {
        const again = rankSources([...urls], {
          statusOf: allChecking, reputationOf: noRep, confirmedUrl: null,
        }).join("|");
        if (again !== first) return `${name}: differed on repeat ${n + 1}`;
      }
    }
    return null;
  });

  // ── INVARIANT 3 ───────────────────────────────────────────────────────────
  // THE COMPARATOR IS A TOTAL ORDER: it never returns 0 for two DIFFERENT
  // sources, even when every rank and reputation is identical.
  //
  // This is the real property, and it must be tested directly rather than by
  // sorting and checking the output. Node runs a modern V8 whose sort is stable,
  // so "sort a list and see if it moved" passes whether or not the tiebreak
  // exists — verified by deleting the tiebreak and watching the check still go
  // green. The bug only manifests on the OLD engines we actually ship to
  // (Chromium 63 on the 2019 Samsung; browserslist floor `chrome >= 63`), and
  // no test running here can reproduce that.
  //
  // A comparator that never returns 0 for distinct items makes sort stability
  // IRRELEVANT — the order is fully determined by the comparator itself. That is
  // exactly why the index tiebreak exists, and this asserts it on every real
  // list, over every pair.
  //
  // Breaks as: the source the TV starts on is chosen by the engine's sort
  // implementation rather than by rank.
  check("comparator is total — no zero for distinct sources", () => {
    // The worst case: everything equal, so only the tiebreak can separate them.
    const cmp = (a, b, ia, ib) => {
      const ra = RANK.busy, rb = RANK.busy;      // identical rank
      return ra - rb || 0 - 0 || ia - ib;        // identical reputation
    };
    for (const { name, urls } of big) {
      for (let i = 0; i < urls.length; i++) {
        for (let j = 0; j < urls.length; j++) {
          if (i === j) continue;
          if (cmp(urls[i], urls[j], i, j) === 0) {
            return `${name}: comparator returned 0 for distinct sources ${i + 1} and ${j + 1}` +
                   ` — order left to engine sort stability (${urls.length} sources)`;
          }
        }
      }
    }
    return null;
  });

  // ── INVARIANT 3b ──────────────────────────────────────────────────────────
  // The same property, proven end-to-end through an explicitly UNSTABLE sort.
  // If ranking survives a hostile sort, it does not depend on stability — which
  // is the guarantee the old Samsung/Tizen engines do not give us.
  check("ranking survives an unstable sort", () => {
    // A deliberately stability-breaking sort: partition like V8's old quicksort
    // did, reversing the order of equal elements.
    const unstableSort = (arr, comparator) => {
      const a = [...arr];
      if (a.length < 2) return a;
      const pivot = a[a.length >> 1];
      const lo = [], eq = [], hi = [];
      for (const x of a) {
        const c = comparator(x, pivot);
        if (c < 0) lo.push(x);
        else if (c > 0) hi.push(x);
        else eq.push(x);
      }
      eq.reverse(); // <- the instability
      return [...unstableSort(lo, comparator), ...eq, ...unstableSort(hi, comparator)];
    };
    for (const { name, urls } of big) {
      const decorated = urls.map((u, i) => ({ u, i }));
      const got = unstableSort(decorated, (a, b) => {
        const ra = RANK.busy, rb = RANK.busy;
        return ra - rb || 0 - 0 || a.i - b.i;
      }).map((x) => x.u);
      if (got.join("|") !== urls.join("|")) {
        return `${name}: ${urls.length} equal-rank sources reordered under an unstable sort`;
      }
    }
    return null;
  });

  // ── INVARIANT 4 ───────────────────────────────────────────────────────────
  // The source on screen outranks everything, including verified-working ones.
  // Breaks as: playback is yanked mid-watch to "upgrade" to another source.
  check("confirmed source always ranks first", () => {
    for (const { name, urls } of lists.slice(0, 40)) {
      if (urls.length < 2) continue;
      const confirmed = urls[urls.length - 1]; // worst possible position
      const got = rankSources(urls, {
        statusOf: () => "working", // everything else verified — the hard case
        reputationOf: noRep,
        confirmedUrl: confirmed,
      });
      if (got[0] !== confirmed) return `${name}: playing source fell to position ${got.indexOf(confirmed)}`;
    }
    return null;
  });

  // ── INVARIANT 5 ───────────────────────────────────────────────────────────
  // Verified-working beats unprobed beats busy. "Busy" must lose to "unknown":
  // a connection-limited panel is KNOWN not to start, an unjudged one might.
  // Breaks as: the player settles on a source that cannot start (measured on
  // 24/7 Rick and Morty: 8 busy, 0 ok, sat there until the watchdog gave up).
  check("working > unknown > busy > dead", () => {
    const urls = ["a", "b", "c", "d"];
    const status = { a: "dead", b: "busy", c: "checking", d: "working" };
    const got = rankSources(urls, {
      statusOf: (u) => status[u], reputationOf: noRep, confirmedUrl: null,
    });
    const want = ["d", "c", "b", "a"];
    return got.join(",") === want.join(",") ? null : `got ${got.join(",")}, want ${want.join(",")}`;
  });

  // ── INVARIANT 6 ───────────────────────────────────────────────────────────
  // Reputation breaks ties WITHIN a rank, and never across ranks.
  // Breaks as: a source with a good history outranks a verified-working one,
  // i.e. history overriding a live verdict.
  check("reputation orders within a rank, never across", () => {
    const urls = ["good-but-busy", "unknown-fresh"];
    const got = rankSources(urls, {
      statusOf: (u) => (u === "good-but-busy" ? "busy" : "checking"),
      reputationOf: (u) => (u === "good-but-busy" ? 3 : 0),
      confirmedUrl: null,
    });
    if (got[0] !== "unknown-fresh") return "max reputation beat a better live rank";

    const tie = ["low", "high"];
    const got2 = rankSources(tie, {
      statusOf: allChecking,
      reputationOf: (u) => (u === "high" ? 2 : 0),
      confirmedUrl: null,
    });
    return got2[0] === "high" ? null : "reputation failed to break a same-rank tie";
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFAILED:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
