import { NextRequest, NextResponse } from "next/server";
import { signedProxyUrl } from "@/lib/streamToken";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RELAY = (process.env.BACKEND_RELAY_URL || "https://relay.example.com").replace(/\/+$/, "");
const UA = "VLC/3.0.20 LibVLC/3.0.20";

/** ISO-639 (both 2- and 3-letter, and the sloppy variants panels use) → a name
 *  a person reads on a couch. Unknown codes fall back to the embedded track
 *  title, then to the raw code, so nothing ever renders blank. */
const LANG_NAMES: Record<string, string> = {
  eng: "English", en: "English",
  fre: "French", fra: "French", fr: "French",
  ger: "German", deu: "German", de: "German",
  spa: "Spanish", es: "Spanish",
  ita: "Italian", it: "Italian",
  dut: "Dutch", nld: "Dutch", nl: "Dutch",
  por: "Portuguese", pt: "Portuguese",
  rus: "Russian", ru: "Russian",
  pol: "Polish", pl: "Polish",
  jpn: "Japanese", ja: "Japanese",
  kor: "Korean", ko: "Korean",
  chi: "Chinese", zho: "Chinese", zh: "Chinese",
  ara: "Arabic", ar: "Arabic",
  hin: "Hindi", hi: "Hindi",
  tur: "Turkish", tr: "Turkish",
  swe: "Swedish", nor: "Norwegian", dan: "Danish", fin: "Finnish",
};

function label(lang: string, title: string, rel: number): string {
  const name = LANG_NAMES[lang];
  if (name) return name;
  if (title) return title;
  if (lang) return lang.toUpperCase();
  return `Track ${rel + 1}`;
}

interface RelayTrack {
  rel: number;
  lang: string;
  title: string;
  channels: number;
}

/**
 * Audio-track menu for a VOD title.
 *
 * The player passes its CURRENT remux source (`?src=`). We unwrap it to the
 * underlying panel file, ask the relay which audio tracks that file carries,
 * and hand back — for each track — a ready-to-play, SIGNED source URL that
 * remuxes with THAT track mapped (`&aidx=<rel>`). The player just swaps to the
 * chosen one; all the signing and relay-token handling stays server-side, where
 * the secrets are.
 *
 * English stays the default everywhere: with no `aidx` the relay auto-selects
 * English (see iptv_relay `_probe_english_audio_index`), so this endpoint only
 * exists to let someone deliberately change it. Only remux sources have a
 * switchable track set — a direct mp4 is one baked-in track — so a non-remux
 * `src` correctly yields an empty list and the player shows no menu.
 */
export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src");
  if (!src) return NextResponse.json({ tracks: [], duration: null }, { status: 400 });

  // Unwrap /api/vod-stream?url=<relay remux>&st=… → the relay remux URL.
  let relayRemux: string | null = null;
  try {
    const q = src.includes("?") ? src.slice(src.indexOf("?") + 1) : "";
    relayRemux = new URLSearchParams(q).get("url");
  } catch {
    return NextResponse.json({ tracks: [], duration: null });
  }
  if (!relayRemux || !relayRemux.includes("/remux.m3u8")) {
    return NextResponse.json({ tracks: [], duration: null });
  }

  let file: string | null = null;
  let relayTok = "";
  try {
    const rp = new URL(relayRemux);
    file = rp.searchParams.get("u");
    relayTok = rp.searchParams.get("t") || "";
  } catch {
    return NextResponse.json({ tracks: [], duration: null });
  }
  if (!file) return NextResponse.json({ tracks: [], duration: null });

  const tq = relayTok ? `&t=${encodeURIComponent(relayTok)}` : "";

  let tracks: RelayTrack[] = [];
  // Total length of the underlying file. This is what makes a rolling remux
  // SEEKABLE: the stream itself has no end (live-style playlist), so the player
  // can't learn the runtime from it, but with the file's duration it can scale a
  // seek bar and re-request remux.m3u8 at a new &start=. null → seeking stays off.
  let duration: number | null = null;
  try {
    const res = await fetch(
      `${RELAY}/audio-tracks?u=${encodeURIComponent(file)}${tq}`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) },
    );
    if (res.ok) {
      const body = await res.json();
      tracks = (body?.tracks as RelayTrack[]) || [];
      const d = Number(body?.duration);
      duration = Number.isFinite(d) && d > 0 ? d : null;
    }
  } catch {
    // Relay busy/cold — no menu rather than an error; English default still plays.
    return NextResponse.json({ tracks: [], duration: null });
  }

  // One signed, playable source per track.
  const out = await Promise.all(
    tracks.map(async (t) => {
      const remux = `${RELAY}/remux.m3u8?u=${encodeURIComponent(file!)}${tq}&aidx=${t.rel}`;
      return {
        rel: t.rel,
        lang: t.lang,
        label: label(t.lang, t.title, t.rel),
        url: await signedProxyUrl(remux),
      };
    }),
  );

  return NextResponse.json({ tracks: out, duration });
}
