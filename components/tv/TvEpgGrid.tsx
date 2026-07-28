"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoImage } from "@/components/LogoImage";
import ChannelPreview from "@/components/ChannelPreview";
import { useTvBack } from "@/components/tv/TvNav";
import { channelSlug } from "@/lib/sources";
import { fallbackProgramming } from "@/lib/channelProgramming";
import type { Channel, EpgProgram } from "@/lib/types";

/** Pixels per minute — 8 → 480px per hour, a 5h window ≈ 2400px wide. */
const PX_PER_MIN = 8;
/** Guide window: previous half-hour → +5h. */
const WINDOW_HOURS = 5;
const ROW_H = 112;
/** Horizontal gap between adjacent program blocks (2px inset each side). */
const BLOCK_GAP = 4;
/** Floor so a 2-minute program is still readable/focusable — never applied past
 *  the next block's edge (see the layout pass). */
const MIN_BLOCK_W = 64;
/** Sticky channel column width. The ruler spacer, the per-row channel cell and
 *  the NOW line's offset all have to agree on this, so it's one number rather
 *  than a `w-44` class and two hardcoded pixel offsets that can drift apart. */
const CHAN_W = 208;
/** Sticky time-ruler height — likewise shared with the NOW line's top offset. */
const RULER_H = 48;

function fmtTick(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Timeline EPG grid for the 10-foot UI (the web app's guide, D-pad-ready):
 * sticky channel logos on the left, sticky time ruler on top, absolutely
 * positioned program blocks, a NOW line. Every block is a data-tv button —
 * TvNav's geometric navigation handles the irregular grid with no wiring,
 * and its scrollIntoView keeps the focused block centered both ways.
 * Chromium-63-safe on purpose: flex + absolute px positioning + sticky
 * (Chromium 56), no CSS grid templates, no gradients.
 */
export default function TvEpgGrid({
  channels,
  epg,
}: {
  channels: Channel[];
  epg: Record<string, EpgProgram[]>;
}) {
  const router = useRouter();
  // Window is snapshotted once per mount (lazy state init) — a guide that
  // shifts under the cursor while browsing is worse than one a minute stale.
  const [win] = useState(() => {
    const s = new Date();
    s.setMinutes(s.getMinutes() < 30 ? 0 : 30, 0, 0);
    const start = s.getTime();
    return { start, end: start + WINDOW_HOURS * 3600_000, now: Date.now() };
  });
  const { start, end, now } = win;
  const width = ((end - start) / 60000) * PX_PER_MIN;

  const ticks = useMemo(() => {
    const out: Array<{ left: number; label: string }> = [];
    for (let t = start; t < end; t += 30 * 60000) {
      out.push({ left: ((t - start) / 60000) * PX_PER_MIN, label: fmtTick(new Date(t)) });
    }
    return out;
  }, [start, end]);

  const nowLeft = ((now - start) / 60000) * PX_PER_MIN;

  const rows = useMemo(
    () =>
      channels.map((c) => {
        const raw = (epg[c.name]?.length ? epg[c.name] : (c.programs ?? []))
          .map((p) => ({
            p,
            from: new Date(p.start_utc).getTime(),
            to: new Date(p.stop_utc).getTime(),
          }))
          .filter((x) => x.to > start && x.from < end)
          .sort((a, b) => a.from - b.from);

        // Upstream EPG is a merge of several XMLTV feeds and routinely carries
        // OVERLAPPING entries for one channel (a stale listing whose stop_utc
        // runs past the next show's start, or a duplicate airing). Absolutely
        // positioned blocks then paint on top of each other — the "overlapping
        // containers" bug. Resolve to a strictly sequential timeline: trim the
        // earlier block at the next one's start, and drop any block an earlier
        // one already fully covers.
        const seq: typeof raw = [];
        for (const cur of raw) {
          while (seq.length) {
            const prev = seq[seq.length - 1];
            if (cur.from >= prev.to) break; // no overlap — keep prev as-is
            if (cur.from <= prev.from) seq.pop(); // prev fully covered — drop it
            else {
              prev.to = cur.from; // partial overlap — truncate prev
              break;
            }
          }
          if (cur.to > cur.from) seq.push(cur);
        }

        // Pre-compute pixel geometry so each block knows where its NEIGHBOUR
        // starts; the min-width floor below must never cross that line.
        const programs = seq.map((x, i) => {
          const left = Math.max(0, ((x.from - start) / 60000) * PX_PER_MIN);
          const right = Math.min(width, ((x.to - start) / 60000) * PX_PER_MIN);
          const nextLeft =
            i + 1 < seq.length
              ? Math.max(0, ((seq[i + 1].from - start) / 60000) * PX_PER_MIN)
              : width;
          // Grow short programs up to MIN_BLOCK_W for legibility, but clamp to
          // the space actually available before the next block. Previously this
          // was a bare Math.max(..., 48), so any programme under ~9 minutes
          // rendered 48px wide and overran its neighbour.
          const avail = nextLeft - left - BLOCK_GAP;
          const w = Math.min(Math.max(right - left - BLOCK_GAP, MIN_BLOCK_W), avail);
          return { ...x, left, width: w };
        })
          // A block with no room left (back-to-back listings inside one pixel)
          // is dropped rather than drawn at zero/negative width.
          .filter((x) => x.width > 0);

        return { channel: c, programs };
      }),
    [channels, epg, start, end, width],
  );

  // Press-once-to-preview, press-again-to-watch.
  //
  // Pressing a block used to tune straight to the channel full-screen, which
  // makes browsing the guide expensive: the only way to find out what a channel
  // is actually showing was to leave the guide and come back. Now the first
  // press opens a muted preview pinned top-right and the guide stays where it
  // is; a second press ON THE SAME CHANNEL commits. Landing on a different
  // channel swaps the preview instead of opening it, so walking the guide never
  // navigates by accident.
  const [preview, setPreview] = useState<string | null>(null);
  const previewChannel = channels.find((c) => c.name === preview) || null;

  const openChannel = (c: Channel) => router.push(`/tv/live/${channelSlug(c.name)}`);

  const selectChannel = (c: Channel) => {
    if (preview === c.name) openChannel(c);
    else setPreview(c.name);
  };

  // Back closes the preview before it leaves the guide — the innermost handler
  // wins (see TvNav.useTvBack), and `null` while nothing is previewing hands
  // Back straight back to the page.
  useTvBack(preview ? () => setPreview(null) : null);

  return (
    <div className="overflow-auto h-full">
      {/* key: switching channels remounts the preview, so the previous stream is
          torn down before the next attaches — see TvGuidePreview. */}
      {previewChannel && <ChannelPreview key={previewChannel.name} channel={previewChannel} />}
      <div style={{ width: width + CHAN_W }} className="relative">
        {/* Time ruler */}
        <div className="sticky top-0 z-30 flex bg-[#0b1524]" style={{ height: RULER_H }}>
          <div className="sticky left-0 z-10 shrink-0 bg-[#0b1524]" style={{ width: CHAN_W }} />
          <div className="relative" style={{ width }}>
            {ticks.map((t) => (
              <span
                key={t.left}
                className="absolute top-3 text-base font-medium text-[#8197a4]"
                style={{ left: t.left + 8 }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {/* NOW line across all rows */}
        {nowLeft >= 0 && nowLeft <= width && (
          <div
            className="absolute bottom-0 z-20 w-0.5 bg-[#1399ff] pointer-events-none"
            style={{ top: RULER_H, left: CHAN_W + nowLeft }}
          />
        )}

        {rows.map(({ channel: c, programs }, rowIdx) => (
          <div key={c.name} className="flex" style={{ height: ROW_H }}>
            {/* Sticky channel cell */}
            <div
              className="sticky left-0 z-10 shrink-0 bg-[#0b1524] flex items-center gap-2 pr-3"
              style={{ width: CHAN_W }}
            >
              <div className="w-24 h-16 shrink-0 flex items-center justify-center rounded bg-[#121a24] ring-1 ring-white/10">
                <LogoImage
                  name={c.name}
                  logoUrl={c.logo_url || c.logo}
                  className="w-full h-full p-1"
                  fallbackClassName="text-base font-bold text-white/80"
                  eager
                />
              </div>
              <span className="text-base text-[#8197a4] truncate">{c.name}</span>
            </div>

            {/* Program blocks */}
            <div className="relative" style={{ width }}>
              {programs.length > 0 ? (
                programs.map(({ p, from, to, left, width: blockW }, i) => {
                  const onNow = from <= now && to > now;
                  return (
                    <button
                      key={`${p.start_utc}-${i}`}
                      data-tv
                      {...(rowIdx === 0 && onNow ? { "data-tv-autofocus": true } : {})}
                      onClick={() => selectChannel(c)}
                      className={`absolute top-1 bottom-1 rounded-lg px-4 text-left overflow-hidden ring-1 focus:outline-none ${
                        onNow
                          ? "bg-[#14283d] ring-[#1399ff]/50"
                          : "bg-[#121a24] ring-white/10"
                      }`}
                      style={{ left: left + 2, width: blockW }}
                    >
                      <p className="text-lg font-semibold text-white truncate mt-3">{p.title}</p>
                      <p className="text-base text-[#8197a4] truncate">
                        {fmtTick(new Date(from))}
                        {onNow ? " · On now" : ""}
                      </p>
                    </button>
                  );
                })
              ) : (
                <button
                  data-tv
                  onClick={() => selectChannel(c)}
                  className="absolute top-1 bottom-1 rounded-lg px-4 text-left ring-1 ring-white/10 bg-[#121a24] focus:outline-none"
                  style={{ left: 2, width: width - 4 }}
                >
                  {(() => {
                    // A "24/7 <Show>" channel has no schedule to fetch because
                    // it has no schedule — but the channel name says exactly
                    // what's on. See lib/channelProgramming.ts.
                    const fb = fallbackProgramming(c.name, Boolean(c.online));
                    return (
                      <>
                        <p className="text-lg font-semibold text-white mt-3">{fb.title}</p>
                        {fb.detail ? (
                          <p className="text-base text-[#8197a4]">{fb.detail}</p>
                        ) : null}
                      </>
                    );
                  })()}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
