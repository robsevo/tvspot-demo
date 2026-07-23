import { withDeadline, DEADLINE, TimeoutError } from "@/lib/fetchDeadline";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_API_URL || "https://api.example.com";

/** Non-2xx response, with the status attached so callers can branch on it —
 *  a 404 ("title doesn't exist") and a 504 ("backend is down, retry") need
 *  different UI, and string-matching error messages is how that goes wrong. */
export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Every one of these calls gates a loading state somewhere, and on the TV a
 * request that never settles wedges that state forever (see lib/fetchDeadline
 * for why aborting can't save us there). So both helpers are deadlined, with
 * the response parse INSIDE the deadline — headers can arrive while the body
 * stalls, and a timeout covering only the fetch would just move the hang.
 *
 * `timeoutMs` is per-call because "too slow" is context-dependent: the VOD
 * provider index is legitimately a ~60-70s cold build (DEADLINE.catalog) while
 * a channel list that takes 15s is broken.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = DEADLINE.normal,
): Promise<T> {
  return withDeadline(
    async (signal) => {
      const res = await fetch(`${BACKEND}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) {
        throw new HttpError(res.status, `API ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as T;
    },
    timeoutMs,
    `apiFetch ${path}`,
  );
}

export async function proxyFetch<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = DEADLINE.normal,
): Promise<T> {
  return withDeadline(
    async (signal) => {
      const res = await fetch(path, {
        ...init,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) {
        throw new HttpError(res.status, `Proxy ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as T;
    },
    timeoutMs,
    `proxyFetch ${path}`,
  );
}

/**
 * True when a failure means "the backend is restarting/warming — try again",
 * as opposed to "this will never work". The whole family of evening VOD hangs
 * is a cold-start window: the box bounces, the catalog rebuilds (~60-70s), and
 * every detail fetch in that window comes back 503 `vod_warming`, or a 504/
 * timeout from the proxy giving up on a still-blocked backend, or a bare
 * network error while the socket is refused. All of those heal on their own in
 * under a minute — so we retry them instead of dead-ending the screen.
 *
 * 404 (title genuinely absent) and 401/403 (auth) are deliberately NOT here:
 * retrying those just burns the window on something that can't recover.
 */
export function isTransientBackendError(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof HttpError) {
    return [408, 425, 429, 500, 502, 503, 504].includes(err.status);
  }
  // fetch() itself rejects with a TypeError when the connection is refused/reset
  // — exactly what a bouncing box does mid-restart.
  if (err instanceof TypeError) return true;
  return false;
}

/**
 * Backoff between auto-retries (ms). Sized to span a full cold VOD catalog
 * build: sum ≈ 62s, and the box returns 503 fast once it has a snapshot, so the
 * common case (index/resolver still warming behind a restored catalog) heals in
 * the first hop or two. Only a truly cold box (no snapshot) needs the tail.
 */
const TRANSIENT_BACKOFF_MS = [2_000, 4_000, 8_000, 12_000, 16_000, 20_000];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

/**
 * proxyFetch that heals the cold-start window: on a transient backend error it
 * retries with backoff (see TRANSIENT_BACKOFF_MS) instead of failing the call.
 * A non-transient error (404, auth) throws immediately — no wasted retries.
 *
 * Pass `signal` from the caller's effect so navigating away mid-retry stops the
 * loop; pass `onRetry` to surface "still loading" state. This is why VOD detail
 * pages no longer dead-end when the box is mid-bounce: the screen keeps its
 * loading skeleton and the fetch resolves the moment the backend answers.
 */
export async function proxyFetchRetry<T>(
  path: string,
  opts: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onRetry?: (nextAttempt: number, total: number) => void;
  } = {},
): Promise<T> {
  const { timeoutMs = DEADLINE.normal, signal, onRetry } = opts;
  const maxRetries = TRANSIENT_BACKOFF_MS.length;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw abortError();
    try {
      return await proxyFetch<T>(path, signal ? { signal } : undefined, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !isTransientBackendError(err)) throw err;
      onRetry?.(attempt + 1, maxRetries);
      await sleep(TRANSIENT_BACKOFF_MS[attempt], signal);
    }
  }
  throw lastErr;
}