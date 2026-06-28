import type { VerifiedMovie } from "./types";

const NON_LATIN_RE =
  /[Ѐ-ӿ֐-׿؀-ۿ฀-๿　-鿿가-힯＀-￯]/;

/** Best-effort "English" check: has Latin letters and no non-Latin script. */
function looksEnglish(title: string): boolean {
  const t = title || "";
  return /[a-zA-Z]/.test(t) && !NON_LATIN_RE.test(t);
}

interface VodItem {
  tmdb_id: number;
  title: string;
  embed_urls?: string[];
  stream_urls?: string[];
}

async function verifyUrl(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "tvspot-link-freshness/1.0" },
    });
    clearTimeout(timer);

    if (!res.ok) return false;
    const ct = res.headers.get("content-type") || "";
    return !ct.includes("html");
  } catch {
    return false;
  }
}

async function verifyUrlBatch(urls: string[], timeoutMs: number, concurrency: number): Promise<string[]> {
  const working: string[] = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => ((await verifyUrl(url, timeoutMs)) ? url : null))
    );
    for (const r of results) {
      if (r) working.push(r);
    }
  }
  return working;
}

/**
 * Verify VOD items (movies/series) from example.com.
 * - Filters English-only
 * - Tests embed_urls and stream_urls
 * - Returns verified items
 */
export async function verifyVodItems(items: VodItem[]): Promise<VerifiedMovie[]> {
  const results: VerifiedMovie[] = [];

  for (const item of items) {
    if (!looksEnglish(item.title)) continue;

    const embedUrls = item.embed_urls || [];
    const streamUrls = item.stream_urls || [];

    // Verify in parallel batches of 4
    const verifiedEmbeds = await verifyUrlBatch(embedUrls, 15000, 4);
    const verifiedStreams = await verifyUrlBatch(streamUrls, 15000, 4);

    if (verifiedEmbeds.length > 0 || verifiedStreams.length > 0) {
      results.push({
        tmdb_id: item.tmdb_id,
        title: item.title,
        embed_urls: verifiedEmbeds,
        stream_urls: verifiedStreams,
      });
    }
  }

  return results;
}