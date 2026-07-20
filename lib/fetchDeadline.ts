/**
 * Deadlines for client-side work that gates UI.
 *
 * WHY THIS EXISTS, AND WHY IT DOESN'T USE ABORT
 * ---------------------------------------------
 * The 2019 Samsung (RU7100, Chromium 63) cannot cancel a fetch. `signal` was
 * only honoured from Chrome 66, and public/tv-polyfills.js *defines*
 * AbortController on that webview — so `typeof AbortController !== "undefined"`
 * is TRUE while aborting does exactly nothing to the request. Every timeout
 * written as "abort after N ms" is therefore a no-op on the one device that
 * needs it, and a request that never SETTLES hangs every await behind it. That
 * is the whole family of TV "stuck on a splash" bugs: the fetch that rejects is
 * harmless, the one that never answers is fatal.
 *
 * So a deadline here RACES the work from the outside and never relies on
 * interrupting it. The orphaned request leaks until its socket dies — that is
 * the correct trade: a leaked socket costs memory, a wedged screen costs the
 * whole app. Abort is still fired as best-effort cleanup for engines where it
 * does something.
 *
 * Anything awaited after the response — notably res.json(), where headers can
 * land while the body stalls — must be INSIDE the raced work, or the hang just
 * moves one hop down. That mistake has already been shipped twice.
 */

/** The deadline expired, or the request never reached the server. Distinct from
 *  HttpError (the server answered, with a status we didn't like). */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`Timed out after ${ms}ms: ${label}`);
    this.name = "TimeoutError";
  }
}

/**
 * Budgets, named by what the user is staring at rather than by duration — the
 * right number depends entirely on what's legitimately slow.
 */
export const DEADLINE = {
  /** Auth and anything gating a full-screen splash: must feel decisive. */
  auth: 8_000,
  /** Normal content calls behind a rail/spinner. */
  normal: 15_000,
  /** Background/best-effort work nobody is waiting on. */
  background: 20_000,
  /**
   * Stream resolution, which gates "Finding streams…". Sits just under
   * VodPlayer's 35s never-started-remux watchdog so a doomed resolve surfaces
   * before the player's own timer would have, not after.
   */
  stream: 30_000,
  /**
   * The VOD provider index only. The backend rebuilds it in ~60-70s COLD
   * (measured — see useCatalog), and the /tv/vod copy openly warns the first
   * load "can take a minute". A tight budget here would turn a slow-but-working
   * backend into a broken picker. Bounded, just generously.
   */
  catalog: 90_000,
} as const;

/**
 * Runs `work` under a hard deadline that fires even when nothing can be
 * cancelled. `work` receives a signal that is aborted on expiry — pass it to
 * fetch so modern engines can release the socket, but never depend on it.
 */
export function withDeadline<T>(
  work: (signal?: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
  /** Caller's own cancellation (e.g. the channel changed). Honoured as a
   *  RACE as well, for the same reason as the deadline: on the TV, aborting
   *  a fetch does nothing, so a caller that only calls .abort() would keep
   *  waiting on a request it has already given up on. */
  external?: AbortSignal,
): Promise<T> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (external) {
        try { external.removeEventListener("abort", onExternalAbort); } catch {}
      }
      fn();
    };

    const timer = setTimeout(() => {
      try { ctl?.abort(); } catch {}
      finish(() => reject(new TimeoutError(label, ms)));
    }, ms);

    function onExternalAbort() {
      try { ctl?.abort(); } catch {}
      const err = new Error(`Aborted: ${label}`);
      err.name = "AbortError";
      finish(() => reject(err));
    }

    if (external) {
      if (external.aborted) return onExternalAbort();
      try { external.addEventListener("abort", onExternalAbort); } catch {}
    }

    work(ctl?.signal).then(
      (value) => finish(() => resolve(value)),
      (err) => finish(() => reject(err)),
    );
  });
}

/** fetch under a deadline. Response-body reads still need to happen inside the
 *  caller's own withDeadline if they gate UI — see fetchJson for the usual case. */
export function fetchWithDeadline(
  url: string,
  init: RequestInit = {},
  ms: number = DEADLINE.normal,
): Promise<Response> {
  // A caller-supplied init.signal keeps working as cancellation — raced, since
  // aborting alone doesn't stop anything on the TV.
  const external = init.signal ?? undefined;
  return withDeadline(
    (signal) => fetch(url, { ...init, ...(signal ? { signal } : {}) }),
    ms,
    url,
    external ?? undefined,
  );
}

/** fetch + JSON parse as ONE deadlined unit — the shape almost every caller
 *  wants, and the shape that doesn't leave the body parse unbounded. */
export function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  ms: number = DEADLINE.normal,
): Promise<{ ok: boolean; status: number; data: T }> {
  return withDeadline(
    async (signal) => {
      const res = await fetch(url, { ...init, ...(signal ? { signal } : {}) });
      // An unparseable body is not "the server said no" — status decides.
      const data = (await res.json().catch(() => null)) as T;
      return { ok: res.ok, status: res.status, data };
    },
    ms,
    url,
  );
}
