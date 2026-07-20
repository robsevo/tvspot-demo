import { withDeadline, DEADLINE } from "@/lib/fetchDeadline";

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