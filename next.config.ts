import type { NextConfig } from "next";

/**
 * The commit this build actually contains.
 *
 * DEPLOY_COMMIT_SHA first, and it is not optional decoration: GITHUB_SHA is the
 * sha of the ref the WORKFLOW was dispatched on (main), while the deploy job
 * checks out and builds the `deploy` branch. Every build was therefore stamped
 * with main's sha, which never moves — so NEXT_PUBLIC_BUILD_ID and /api/version
 * were identical across every deploy, DeployRefresh always concluded "same
 * build, nothing to do", and an already-open app on a phone or TV never picked
 * up a new deploy. It kept running old chunks until it was force-quit.
 *
 * The workflow now exports DEPLOY_COMMIT_SHA=$(git rev-parse HEAD) after the
 * checkout, so this is the sha of the code being built. GITHUB_SHA stays as a
 * fallback for any other CI path, and VERCEL_GIT_COMMIT_SHA for dashboard
 * deploys.
 */
const commitSha =
  process.env.DEPLOY_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  "dev";

const nextConfig: NextConfig = {
  // Run these through SWC so browserslist's chrome 63 floor (the 2019 Samsung
  // TV webview) applies to them too — their published ESM builds carry syntax
  // (?. / ??) that engine can't parse, and hls.js loads ON the TV player.
  transpilePackages: ["hls.js", "framer-motion"],
  env: {
    // Baked into BOTH the client bundle and the /api/version function at build
    // time, so a loaded page can compare its own build against the deployment
    // currently serving — the signal DeployRefresh uses to detect that IT is
    // the stale one (e.g. a service-worker-cached shell from before a deploy).
    // CI (GITHUB_SHA) stamps real builds; local dev/builds fall back to "dev".
    NEXT_PUBLIC_BUILD_ID: commitSha,
  },
  // Pin Next's internal buildId to the same sha. Without this, redeploying an
  // UNCHANGED commit (deploy-only dispatch) mints a new RANDOM buildId: the
  // sha check above says "nothing changed" so DeployRefresh never reloads,
  // while every client navigation hits the new deployment with old-buildId
  // RSC/chunk requests and trips Next's hard version-skew reload — a
  // tap-triggered reload storm DeployRefresh can't see. Same sha → same
  // buildId → a same-code redeploy is a true no-op for open clients.
  ...(commitSha !== "dev" ? { generateBuildId: () => commitSha } : {}),
};

export default nextConfig;
