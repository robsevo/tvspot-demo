"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Transient remote-control hints for the TV players (Fire TV + Samsung — both
 * shells load these same /tv routes, so one component covers both).
 *
 * A remote has no hover, no tooltips and no visible affordances: every control
 * in the players is an invisible key binding. The overlays that document them
 * (the live source list, the VOD picker) are themselves reached by a key you
 * have to already know about — so someone who doesn't press Enter never learns
 * that sources and Recheck exist, and reads a buffering stream as "the app is
 * broken". This is the one surface that volunteers it.
 *
 * NOT rendered on mobile/desktop: it is only mounted by TvChannelPlayer and
 * TvVodPlayback, which are only reachable under /tv.
 */

/** How long the card stays up before fading itself out. */
const HINT_MS = 7000;

/**
 * The ONLY thing that suppresses a repeat. There is deliberately no lifetime
 * cap: the hints show every time someone opens a player, for everyone, forever.
 *
 * This exists purely because the live player REMOUNTS on every channel zap —
 * Up/Down changes the route param — so without it, surfing channels would strobe
 * the card on every press. A zap lands well inside this window and stays quiet;
 * genuinely opening a player again later is past it and shows normally. Set to 0
 * to show the card on literally every mount, zaps included.
 */
const REPEAT_COOLDOWN_MS = 60000;

/** When each card id was last put on screen. Module scope survives client-side
 *  navigation between /tv routes; a reload starts fresh, which is harmless. */
const lastShownAt = new Map<string, number>();

export interface TvHint {
  /** Key cap text, e.g. "Enter" or "◀ ▶". Unicode arrows only — no emojis. */
  keys: string;
  /** What that key does, in the user's words rather than the code's. */
  label: string;
}

export default function TvKeyHints({
  id,
  hints,
  footer,
  suppressed = false,
}: {
  /** Stable id for the lifetime counter — one per player kind. */
  id: string;
  hints: TvHint[];
  /** Optional closing line, e.g. the buffering advice. */
  footer?: string;
  /** Hide immediately (an overlay took over the screen). */
  suppressed?: boolean;
}) {
  const [show, setShow] = useState(false);
  const decided = useRef(false);

  // Decided in an effect rather than during render: it reads a clock, and the
  // server has no idea what the client's zap cooldown looks like. The ref makes
  // it run once per mount — React invokes effects twice in dev StrictMode, which
  // would otherwise stamp the cooldown before the real pass reads it and make
  // the card never appear in dev.
  useEffect(() => {
    if (decided.current) return;
    decided.current = true;

    const last = lastShownAt.get(id);
    if (last !== undefined && Date.now() - last < REPEAT_COOLDOWN_MS) return;

    lastShownAt.set(id, Date.now());
    // The rule-compliant alternative — render the card always, then hide it from
    // the DOM when the cooldown says this is a zap — flashes the hints on every
    // channel change, and does it worst on exactly the slow TV webviews this
    // ships to. One extra render is cheaper.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(true);
  }, [id]);

  // Auto-dismiss. Kept in its OWN effect keyed on `show`, not folded into the
  // one above: with the ref guard there, a StrictMode double-invoke would clear
  // the timer on the first pass and then bail out before re-arming it, leaving
  // the card up forever in dev.
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), HINT_MS);
    return () => clearTimeout(t);
  }, [show]);

  if (!show || suppressed) return null;

  return (
    // Deliberately NOT .tv-glass: that class drops to 55% alpha wherever
    // backdrop-filter exists (i.e. every modern stick), and this card sits over
    // arbitrary video — measured against a full-brightness colour-bar frame, the
    // footer line was unreadable. The near-opaque panel below is the same
    // treatment the zap banner and failover notice already use.
    <div className="absolute top-10 right-12 z-30 bg-[#0f171e]/92 ring-1 ring-white/10 rounded-2xl px-7 py-5 shadow-2xl shadow-black/70 animate-fade-in pointer-events-none max-w-md">
      <div className="flex flex-col gap-2.5">
        {hints.map((h) => (
          <div key={h.keys + h.label} className="flex items-center gap-4">
            <span className="shrink-0 min-w-[5.5rem] text-center text-lg font-bold text-white bg-white/15 rounded-lg px-3 py-1.5">
              {h.keys}
            </span>
            <span className="text-lg text-[#aebbc5]">{h.label}</span>
          </div>
        ))}
      </div>
      {footer && (
        <p className="mt-4 pt-3 border-t border-white/10 text-base text-[#aebbc5]">{footer}</p>
      )}
    </div>
  );
}
