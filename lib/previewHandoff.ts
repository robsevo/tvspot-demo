/**
 * Hands the source the guide preview has ON SCREEN to the full player, so
 * "press again to watch" opens the stream you were just looking at.
 *
 * THE BUG THIS FIXES: a channel's sources are not interchangeable. Several
 * channels are two genuinely different feeds pooled under one name — 24/7
 * Pokemon carries the modern series on one source and the 1997 series on the
 * other — and the 24/7 loops run at their own positions regardless. The preview
 * plays source 1 immediately (it never probes; a glance shouldn't cost a probe
 * round), while the player probes the whole list and auto-picks the best
 * verdict. On a connection-limited panel — where a source that is playing fine
 * answers a probe with 403 often enough to be scored "busy" — those two land on
 * different sources, and you tune in to a different show than the preview was
 * showing.
 *
 * The preview is the one with the evidence: its source is playing, on screen,
 * right now. So it records what it's actually decoding and the player starts
 * there, as if the user had picked that source by hand. The pin is not
 * absolute — the player drops it the moment that source is judged dead or
 * stalls, and fails over normally — it just stops the player from *starting*
 * somewhere else.
 *
 * Session-scoped by design: this is continuity for one tune-in, not a
 * preference. It expires quickly, holds only the most recent preview, and is
 * kept per-tab.
 */

const KEY = "tvspot_preview_source_v1";

/** Long enough to cover preview → press → route change → player mount (and a
 *  reload of the TV wrapper in between), short enough that a channel opened
 *  later from somewhere else gets the normal auto-pick. */
const TTL_MS = 5 * 60_000;

interface Handoff {
  /** channelSlug of the previewed channel — a handoff never crosses channels. */
  slug: string;
  url: string;
  at: number;
}

/** Mirror of the stored record. sessionStorage survives a real page load (the
 *  TV wrappers can navigate that way); the module copy covers a browser that
 *  refuses storage. */
let mem: Handoff | null = null;

/** Record the source the preview has confirmed playing. */
export function notePreviewSource(slug: string, url: string): void {
  if (!slug || !url) return;
  const rec: Handoff = { slug, url, at: Date.now() };
  mem = rec;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(rec));
  } catch {}
}

/**
 * The source the preview was playing for this channel, or null.
 *
 * Pure and idempotent — the players read it during render (and again whenever
 * the channel changes), so it must not consume or mutate anything. The TTL is
 * what retires it.
 */
export function previewSourceFor(slug: string): string | null {
  if (!slug) return null;
  let rec = mem;
  if (!rec) {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Handoff>;
        if (
          typeof parsed?.slug === "string" &&
          typeof parsed?.url === "string" &&
          typeof parsed?.at === "number"
        ) {
          rec = parsed as Handoff;
          mem = rec;
        }
      }
    } catch {}
  }
  if (!rec || rec.slug !== slug) return null;
  if (Date.now() - rec.at > TTL_MS) return null;
  return rec.url;
}
