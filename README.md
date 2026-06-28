# TVSPOT

Mobile-first web app for private, on-demand TV + movies + series streaming.
Next.js 15 (App Router) + React 19 + Tailwind v4, deployed to Vercel. Content is
proxied from the existing `api.example.com` backend. See [CLAUDE.md](./CLAUDE.md)
for the full architecture.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run lint         # ESLint
```

Environment variables live in `.env.local` (git-ignored): `JWT_SECRET`,
`AUTH_USERS`, `BACKEND_API_URL`, `BACKEND_RELAY_URL`, `TMDB_ACCESS_TOKEN`.

Deploy: `vercel --prod`.

## Live-stream reliability

Live channels arrive from the backend with a primary URL + several backups
(shown as "Source 1..N"). Many backups are dead at any moment (401 / timeout /
empty playlist), so reliability is handled in two layers:

### 1. Runtime verification (instant)

When you open a channel, `components/ChannelPlayer.tsx` probes every source via
`POST /api/stream-check` (`lib/stream-verify.ts`, a Tier-1/2 HLS check run
server-side to dodge browser CORS). It then:

- shows a ✓ / ✗ badge per source and an "N of M sources online" summary,
- hides dead sources, keeps the working ones (best-first, capped at 6),
- auto-plays the first working source — so a dead "Source 1" never leaves you on
  a black screen.

### 2. Nightly link freshness (the accumulating list)

`data/verified-sources.json` is a **persistent, dated list** of verified links
per channel. Each source records `url` (browser-playable), `tier`, `latencyMs`,
`verifiedUtc` (last tested), `firstSeenUtc`, and `origin`
(`backend` | `scraped` | `store`). `lib/sources.ts#getChannelSources` reads it at
runtime, ahead of the backend's live links.

The pipeline (`scripts/link-freshness/`) runs every night and is **stateful** —
it builds on the existing list rather than starting fresh:

1. Load the existing list.
2. Fetch the links currently on the backend.
3. Scrape r/REDACTED_SOURCE for fresh credentials → M3U playlists.
4. **Re-test every candidate** (existing list + backend + scraped).
5. Keep the working ones (≤6 per channel, best-first, re-dated); **drop the dead**;
   add new ones. Raw scraped URLs are stored wrapped in
   `api.example.com/stream-proxy?url=…` so they play in the browser.
6. Write the list back (with a safety net: a total-outage run that verifies 0
   channels will **not** overwrite a non-empty list).

Run it manually:

```bash
npm run refresh-links            # refresh the list only
./scripts/refresh-and-deploy.sh  # refresh + vercel --prod  (local/cron use)
```

### Automated nightly refresh (GitHub Actions)

`.github/workflows/refresh-links.yml` runs the pipeline nightly on GitHub's free
hosted runners (no machine of your own needs to be on), commits the refreshed
`data/verified-sources.json` back to the repo, and redeploys to Vercel. It also
has a manual **Run workflow** button (Actions tab).

First-time setup is one command:

```bash
./scripts/setup-github-actions.sh
```

It creates a **private** GitHub repo, pushes, and sets the required Action
secrets (`AUTH_USERS` and `JWT_SECRET` are read from your `.env.local`; you'll be
prompted to paste a `VERCEL_TOKEN` from <https://vercel.com/account/tokens>).
Schedule is `0 8 * * *` UTC (≈ 4am Eastern) — adjust the `cron:` line for your
timezone. GitHub cron is UTC and can be delayed under load.
