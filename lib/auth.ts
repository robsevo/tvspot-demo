export interface TokenPayload {
  username: string;
  iat?: number;
  exp?: number;
}

export interface AuthUser {
  username: string;
  password: string;
  secret_word: string;
}

function getUsers(): AuthUser[] {
  try {
    return JSON.parse(process.env.AUTH_USERS || "[]");
  } catch {
    return [];
  }
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

export async function signToken(username: string): Promise<string> {
  const secret = process.env.JWT_SECRET || "dev-secret";
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      username,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    })
  );
  const sig = await hmacSign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${sig}`;
}

export async function verifyToken(
  token: string
): Promise<TokenPayload | null> {
  try {
    const secret = process.env.JWT_SECRET || "dev-secret";
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = await hmacSign(`${header}.${payload}`, secret);
    if (sig !== expected) return null;
    const data = JSON.parse(base64UrlDecode(payload));
    if (data.exp && Date.now() / 1000 > data.exp) return null;
    return { username: data.username };
  } catch {
    return null;
  }
}

export function validateCredentials(
  username: string,
  password: string,
  secret_word: string
): boolean {
  const users = getUsers();
  return users.some(
    (u) =>
      u.username === username &&
      u.password === password &&
      u.secret_word === secret_word
  );
}