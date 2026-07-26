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

/**
 * Identity of the CODE in this build, ignoring data/.
 *
 * The nightly link refresh commits data/*.json but no longer deploys — the app
 * reads that data from Blob at request time (lib/linkData.ts), which is what
 * stopped every refresh from force-reloading open clients. The commit sha alone
 * can't express that: it moves on a data-only night too.
 *
 * So the workflow stamps a hash of the tree with data/ excluded, and exposes it
 * on /api/version. A scheduled run compares its own code hash against the live
 * one and deploys only when actual code changed — preserving "code pushed to
 * `deploy` ships by the next nightly at the latest" without resurrecting the
 * nightly reload. Absent (older build, local build) → the workflow treats it as
 * unknown and deploys, which is the safe direction.
 */
const codeId = process.env.DEPLOY_CODE_ID || "";

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
    // Server-side only — referenced solely by /api/version, so it never reaches
    // a client chunk (deliberately NOT NEXT_PUBLIC_).
    DEPLOY_CODE_ID: codeId,
  },
  // Fire TV sideload endpoint. `public/tvspot.apk` is the signed release APK; the
  // Downloader app (and anyone typing a URL with a remote) fetches it directly.
  //
  // The path ends in `.apk` ON PURPOSE and the code registered with the AFTVnews
  // shortener points at THIS url, not at /fire: Downloader decides "file to
  // download" vs "page to open in the browser" from the response, and a bare
  // extensionless path invites it to render the bytes as a web page instead of
  // installing them. /fire exists only as the human-typable alias and redirects
  // here (see redirects() below) so the URL that finally lands in Downloader
  // still carries the extension.
  async headers() {
    return [
      {
        source: "/tvspot.apk",
        headers: [
          // Vercel serves unknown extensions as octet-stream; this is the MIME
          // type Fire OS's package installer expects to be handed.
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: 'attachment; filename="tvspot.apk"' },
          // A new release overwrites this same path, so the CDN must not pin an
          // old build for a day. Small file, cheap revalidation.
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
        ],
      },
    ];
  },
  async redirects() {
    return [{ source: "/fire", destination: "/tvspot.apk", permanent: false }];
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
