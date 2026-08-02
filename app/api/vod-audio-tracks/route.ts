import { NextRequest, NextResponse } from "next/server";
import { signedProxyUrl } from "@/lib/streamToken";
import { langLabel, dedupeLabels } from "@/lib/audioLang";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RELAY = (process.env.BACKEND_RELAY_URL || "https://relay.example.com").replace(/\/+$/, "");
const UA = "VLC/3.0.20 LibVLC/3.0.20";

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
 * switchable track set THIS WAY — a direct mp4 is one baked-in track — so a
 * non-remux `src` correctly yields an empty list here. That is no longer the
 * end of the story for the viewer: the player also reads whatever audio
 * renditions the STREAM declares (hls.js / native AudioTrackList) and defaults
 * those to English too, so provider-a/Origin/Provider B sources get a menu of their own.
 */
export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src");
  if (!src) return NextResponse.json({ tracks: [], duration: null }, { status: 400 });

  // A remux source reaches the player in ONE OF TWO SHAPES, and this route has
  // to read both:
  //
  //   1. `https://relay.example.com/remux.m3u8?u=<file>&t=<tok>` — handed to the
  //      player directly, exactly like live. This is the normal shape.
  //   2. `/api/vod-stream?url=<relay remux>&st=…` — the same-origin proxy hop,
  //      now used only as the fallback when we have no relay token to sign with.
  //
  // Shape 1 became the default when VOD stopped going through a Vercel function
  // (lib/vod-resolve.ts remuxPlayable), and this route was left understanding
  // only shape 2 — so `new URLSearchParams(...).get("url")` came back null for
  // every real source and the answer was an unconditional empty list. That is
  // why the audio-language menu vanished from VOD: not "no tracks on this file",
  // but "this endpoint never recognised the source it was given". It also took
  // remux SEEKING down with it, since the file's `duration` rides the same reply.
  let relayRemux: string | null = null;
  try {
    const q = src.includes("?") ? src.slice(src.indexOf("?") + 1) : "";
    relayRemux = new URLSearchParams(q).get("url") ?? src;
  } catch {
    return NextResponse.json({ tracks: [], duration: null });
  }
  if (!relayRemux.includes("/remux.m3u8")) {
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

  // One signed, playable source per track. Labels are de-duplicated across the
  // whole set — a file with two tracks both tagged `eng` and no titles would
  // otherwise render two rows reading "English".
  const labels = dedupeLabels(tracks.map((t, i) => langLabel(t.lang, t.title, i)));
  const out = await Promise.all(
    tracks.map(async (t, i) => {
      const remux = `${RELAY}/remux.m3u8?u=${encodeURIComponent(file!)}${tq}&aidx=${t.rel}`;
      return {
        rel: t.rel,
        lang: t.lang,
        label: labels[i],
        url: await signedProxyUrl(remux),
      };
    }),
  );

  return NextResponse.json({ tracks: out, duration });
}
