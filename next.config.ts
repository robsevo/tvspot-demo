import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Baked into BOTH the client bundle and the /api/version function at build
    // time, so a loaded page can compare its own build against the deployment
    // currently serving — the signal DeployRefresh uses to detect that IT is
    // the stale one (e.g. a service-worker-cached shell from before a deploy).
    // CI (GITHUB_SHA) stamps real builds; local dev/builds fall back to "dev".
    NEXT_PUBLIC_BUILD_ID:
      process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "dev",
  },
};

export default nextConfig;
