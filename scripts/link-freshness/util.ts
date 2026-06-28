/**
 * Resolve to `fallback` if `p` hasn't settled within `ms`.
 *
 * Safety net for fetch-heavy stages: malformed responses from some IPTV servers
 * trip an assertion deep in Node's undici HTTP parser that surfaces as an
 * uncaughtException instead of rejecting the fetch — leaving that promise pending
 * forever. Without a bound, one bad server hangs its whole batch, and because no
 * timers/handles remain the process can exit before the pipeline finishes. The
 * timer here both caps the wait AND keeps the event loop alive.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(fallback); },
    );
  });
}
