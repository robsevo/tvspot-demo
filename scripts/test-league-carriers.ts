/**
 * Regression test for league -> carrier-channel matching.
 *
 *   bun scripts/test-league-carriers.ts
 *
 * There is no test framework in this repo, so this is a standalone runnable that
 * imports the REAL module (no reimplementation — a test that re-derives the
 * logic it is testing proves nothing) and exits non-zero on failure.
 *
 * WHY IT EXISTS. `carriersForLeague` matched a channel with a bare
 * `slug.startsWith(key)`. Providers ship whole channel FAMILIES under one
 * prefix, so every sibling landed on the parent. This is the same defect that
 * made the backend serve MTV Lebanon for MTV and ESPN8 for TSN (fixed there
 * 2026-07-28 with feed-qualifier tokens; see tests/python/test_channel_matching.py
 * in Origin). Measured here against the live 126-channel lineup, the bare
 * prefix handed sports leagues their NEWS siblings:
 *
 *   NHL            -> CBC News Network, RDS INFO
 *   NFL / FIFA WC  -> CTV News, CTV News Network, RDS INFO
 *   7 more leagues -> RDS INFO
 *
 * i.e. the Events "Watch" deep-link could hand a viewer a news channel.
 *
 * The fixture below is REAL channel names taken from the production lineup, so
 * the two failure directions are both pinned: news siblings must be excluded,
 * and legitimate numbered/regional feeds (TSN1-5, Sportsnet East/West/…, RDS 2,
 * CTV 2) must be KEPT — dropping those would leave real carriers unlisted, which
 * is the opposite bug and just as user-visible.
 */
import { carriersForLeague, carriersForGame, isFeedOfBrand } from "../lib/leagues";
import { channelSlug } from "../lib/sources";

type Row = { name: string; online: boolean };

/** Real names from the production lineup (GET /api/lounge/live-channels). */
const LINEUP: Row[] = [
  "CBC", "CBC News Network",
  "CTV", "CTV 2", "CTV News", "CTV News Network", "Citytv",
  "RDS", "RDS 2", "RDS INFO",
  "Sportsnet", "Sportsnet 360", "Sportsnet East", "Sportsnet One",
  "Sportsnet Ontario", "Sportsnet Pacific", "Sportsnet West",
  "TSN", "TSN1", "TSN2", "TSN3", "TSN4", "TSN5",
  "FS1", "FS2", "NFL Network",
  // Real lineup entries that no league's `channels` list mentions — which is
  // exactly why per-game matching was needed.
  "ESPN", "ESPN2", "ESPN+", "MLS",
].map((name) => ({ name, online: true }));

let failures = 0;
const check = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

const carriers = (league: string) =>
  carriersForLeague(league, LINEUP, channelSlug).map((c) => c.name);

console.log("\nnews siblings must NOT be treated as carriers");
const nhl = carriers("nhl");
check("NHL excludes CBC News Network", !nhl.includes("CBC News Network"), nhl.join(", "));
check("NHL excludes RDS INFO", !nhl.includes("RDS INFO"));
const nfl = carriers("nfl");
check("NFL excludes CTV News", !nfl.includes("CTV News"), nfl.join(", "));
check("NFL excludes CTV News Network", !nfl.includes("CTV News Network"));
for (const lg of ["mls", "nba", "la-liga", "serie-a", "uefa-champions"]) {
  check(`${lg} excludes RDS INFO`, !carriers(lg).includes("RDS INFO"));
}

console.log("\nlegitimate feeds must STILL be carriers");
check("NHL keeps CBC", nhl.includes("CBC"));
check("NHL keeps TSN1..TSN5", ["TSN1", "TSN2", "TSN3", "TSN4", "TSN5"].every((t) => nhl.includes(t)));
check("NHL keeps Sportsnet regionals",
  ["Sportsnet East", "Sportsnet West", "Sportsnet Ontario", "Sportsnet Pacific", "Sportsnet 360"]
    .every((t) => nhl.includes(t)));
check("NHL keeps RDS and RDS 2", nhl.includes("RDS") && nhl.includes("RDS 2"));
check("NFL keeps CTV and CTV 2", nfl.includes("CTV") && nfl.includes("CTV 2"));
check("NFL keeps NFL Network", nfl.includes("NFL Network"));
check("MLS keeps FS1 and FS2", carriers("mls").includes("FS1") && carriers("mls").includes("FS2"));

console.log("\nisFeedOfBrand unit cases");
check("exact brand", isFeedOfBrand("tsn", "tsn"));
check("numbered feed", isFeedOfBrand("tsn5", "tsn"));
check("regional feed", isFeedOfBrand("sportsnet-pacific", "sportsnet"));
check("news sibling rejected", !isFeedOfBrand("cbc-news-network", "cbc"));
check("info sibling rejected", !isFeedOfBrand("rds-info", "rds"));
check("unrelated channel rejected", !isFeedOfBrand("tsn-the-ocho", "tsn"),
  "ESPN8 branded as TSN The Ocho — the original backend symptom");
check("different brand rejected", !isFeedOfBrand("citytv", "ctv"));

console.log("\nper-GAME carriers: the channel airing THIS game, not the league's brands");
const forGame = (league: string, broadcasts: string[]) => {
  const { carriers, exact } = carriersForGame(league, broadcasts, LINEUP, channelSlug);
  return { names: carriers.map((c) => c.name), exact };
};

// Measured live 2026-08-16: every MLS game reported Apple TV, every La Liga
// game ESPN+ — while the league lists offered tsn/rds/fs1/fs2, so the Watch
// button opened TSN1 for a match it was not airing.
const mls = forGame("mls", ["Apple TV"]);
check("Apple TV resolves to the MLS channel", mls.names.join(",") === "MLS", mls.names.join(","));
check("...and is reported as an EXACT match", mls.exact, String(mls.exact));

const laliga = forGame("la-liga", ["ESPN+"]);
// slugify strips "+", so ESPN+ and ESPN collide on slug — exact name must win.
check("ESPN+ resolves to ESPN+ ONLY (not ESPN/ESPN2)",
  laliga.names.join(",") === "ESPN+", laliga.names.join(","));

const both = forGame("la-liga", ["ESPN Deportes", "ESPN+"]);
check("two broadcasters resolve to both channels",
  both.names.includes("ESPN") && both.names.includes("ESPN+"), both.names.join(","));

const none = forGame("nhl", []);
check("no broadcast data falls back to the league brands", !none.exact && none.names.length > 0,
  `exact=${none.exact} n=${none.names.length}`);
const unknown = forGame("nhl", ["Some Regional Sports Net"]);
check("an unmatchable broadcaster also falls back, flagged inexact", !unknown.exact,
  String(unknown.exact));

console.log(
  failures === 0
    ? `\n✓ ALL PASS — league carrier matching\n`
    : `\n✗ ${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
