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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new HttpError(res.status, `API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export async function proxyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new HttpError(res.status, `Proxy ${res.status}: ${res.statusText}`);
  }
  return res.json();
}