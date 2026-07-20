/**
 * Source ranking for VOD, the sibling of the live-TV scorer in
 * scripts/link-freshness/verifier.ts (bufferScore).
 *
 * ── Why this is a SEPARATE model, not a reuse ────────────────────────────────
 * bufferScore is dominated by playlist window vs liveSyncDuration=36 — how much
 * cushion the player has behind a moving live edge. VOD has no live edge and no
 * sliding window; a file either serves bytes or it doesn't. The failure modes we
 * actually see here are different:
 *
 *   1. "Press play and nothing happens." VodPlayer arms a never-started
 *      watchdog (25s direct / 35s remux) precisely because dead-slow panels
 *      neither error nor play. Probe latency is the best cheap predictor of
 *      blowing that budget, so it's the heaviest continuous term.
 *   2. "It plays but I can't seek." Resume (continue-watching) and Skip intro
 *      BOTH require seeking. A panel that ignores Range, or a relay remux
 *      (rolling live-style HLS with no seekable range), silently breaks them.
 *   3. "It plays on my phone but not the TV." Container support is
 *      browser-dependent: mp4 is universal, Matroska needs a demuxer the 2019
 *      Samsung's Chromium 63 doesn't have.
 *
 * ── Tier vs score ───────────────────────────────────────────────────────────
 * Playability guarantees are expressed as a hard TIER, not as weights, because
 * no amount of speed should promote an unseekable or undecodable source above a
 * working mp4 — a fast source you can't seek is worse than a slow one you can.
 * The score then orders WITHIN a tier, which is the part that was missing: rows
 * were previously left in index order, i.e. whichever upstream account happened to
 * be scraped first.
 */

/** Ranking tier. Higher always wins, regardless of score.
 *  Plain const object rather than a `const enum` — Next builds with
 *  isolatedModules, where const enums don't survive transpilation. */
export const VodTier = {
  /** Unplayable / probe failed. */
  Dead: 0,
  /** Relay remux: guaranteed h264, but rolling HLS — NO seeking. */
  Remux: 1,
  /** Direct mkv/ts: seekable, but needs a Matroska demuxer (not on the TV). */
  DirectExotic: 2,
  /** Direct mp4: universally playable and seekable. The target. */
  DirectMp4: 3,
} as const;
export type VodTierValue = (typeof VodTier)[keyof typeof VodTier];

export interface VodProbe {
  /** Probe returned a usable video response. */
  ok: boolean;
  /** Round-trip of the 2-byte range probe. Predicts the never-started timeout. */
  latencyMs: number;
  /** Total file size in bytes from Content-Range/Content-Length; 0 = unknown. */
  bytes: number;
  /** Server answered 206 to a Range request — seeking will actually work. */
  rangeOk: boolean;
  container: "mp4" | "mkv" | "ts";
  /** Which playable form this row produced. */
  form: "direct" | "remux";
}

export function tierOf(p: VodProbe): VodTierValue {
  // Remux rows are kept regardless of their probe: these panels are
  // connection-limited and flap probe-to-probe (the probe itself takes a slot),
  // and the relay re-validates at play time anyway. Their probe result still
  // ORDERS them within the tier.
  if (p.form === "remux") return VodTier.Remux;
  if (!p.ok) return VodTier.Dead;
  return p.container === "mp4" ? VodTier.DirectMp4 : VodTier.DirectExotic;
}

/**
 * 0-100 within-tier quality. Higher = more likely to start fast and behave.
 *
 * Deliberately NOT used to cross tiers — see the header. Everything here is
 * derived from the probe we already make, so scoring costs nothing extra.
 */
export function vodScore(p: VodProbe): number {
  let score = 0;

  // 1. Time to first byte (0-45). The dominant VOD failure is a panel that
  //    never starts; VodPlayer gives it 25s (direct) / 35s (remux) before
  //    failing over, and a panel that needs seconds to answer a TWO BYTE range
  //    request is the one that will burn that budget on a real read.
  const l = p.latencyMs;
  if (l > 0 && l < 300) score += 45;
  else if (l < 800) score += 38;
  else if (l < 1500) score += 28;
  else if (l < 3000) score += 16;
  else if (l < 5000) score += 6;
  // >=5s: 0. These are the "press play, nothing happens" panels.

  // 2. Range support (0-25). Seeking is not a nicety for VOD: continue-watching
  //    resume and Skip intro both seek. A 200 (whole file) instead of a 206
  //    means the panel ignores Range and both features silently break.
  if (p.rangeOk) score += 25;

  // 3. Size sanity (0-20). No runtime is available here, so size stands in for
  //    bitrate. The TV plays inside a 25MB buffer cap (VideoPlayer's TV diet),
  //    so a 4K-sized remux rebuffers where a normal 1080p encode coasts. Unknown
  //    size scores neutral rather than being punished.
  const gb = p.bytes / 1_073_741_824;
  if (p.bytes === 0) score += 12;      // unknown — neutral
  else if (gb <= 0.3) score += 8;      // suspiciously small: often a sample/trailer
  else if (gb <= 2.5) score += 20;     // typical 1080p feature
  else if (gb <= 5) score += 15;
  else if (gb <= 10) score += 8;
  else score += 2;                     // >10GB: 4K/remux, rough on the TV

  // 4. Container bonus within a tier (0-10). Mostly a tiebreak, since container
  //    already decided the tier.
  if (p.container === "mp4") score += 10;
  else if (p.container === "mkv") score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Sort comparator: tier, then probe-alive, then score, then latency.
 *
 * The `ok` step is NOT redundant with the score, and leaving it out is a live
 * bug: remux rows keep their tier even when the probe fails (by design — those
 * panels flap and the relay re-validates at play time), but a FAILED probe
 * returns fast, and low latency scores HIGH. Without this, a dead remux
 * outranks a working one and the player leads with a source that can't play.
 * The pre-scoring code ordered remux alive-first explicitly; this preserves it.
 */
export function compareVod(a: VodProbe, b: VodProbe): number {
  const ta = tierOf(a), tb = tierOf(b);
  if (ta !== tb) return tb - ta;
  if (a.ok !== b.ok) return a.ok ? -1 : 1;
  const sa = vodScore(a), sb = vodScore(b);
  if (sa !== sb) return sb - sa;
  return a.latencyMs - b.latencyMs;
}
