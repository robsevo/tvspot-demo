import type { NextConfig } from "next";

const commitSha =
  process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "dev";

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
