import type { EpgProgram } from "@/lib/types";

export interface NowNext {
  now: EpgProgram | null;
  next: EpgProgram | null;
  /** 0-100 through the current program (0 when none). */
  progress: number;
}

/** Current + upcoming program from an EPG list (guide rows, player overlays). */
export function nowAndNext(programs: EpgProgram[] | undefined): NowNext {
  if (!programs?.length) return { now: null, next: null, progress: 0 };
  const t = Date.now();
  let now: EpgProgram | null = null;
  let next: EpgProgram | null = null;
  for (const p of programs) {
    const start = new Date(p.start_utc).getTime();
    const stop = new Date(p.stop_utc).getTime();
    if (start <= t && t < stop) {
      now = p;
    } else if (start > t && (!next || start < new Date(next.start_utc).getTime())) {
      next = p;
    }
  }
  const progress = now
    ? Math.min(
        100,
        Math.max(
          0,
          ((t - new Date(now.start_utc).getTime()) /
            (new Date(now.stop_utc).getTime() - new Date(now.start_utc).getTime())) *
            100,
        ),
      )
    : 0;
  return { now, next, progress };
}

/** "8:00 PM" in the viewer's locale. */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
