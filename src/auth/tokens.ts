const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function randomId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

// Pages sign one link per person, so import each secret's key once per isolate.
const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keys.set(secret, key);
  }
  return key;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(message)));
}

// Only needs to be unknown to callers, so one per isolate is enough (and keeps the key cache small).
// Created on first use: Workers refuse to start if random values are generated at module level.
let comparisonKey: string | undefined;

/** Compares digests, so neither length nor content leaks through timing. */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  const key = (comparisonKey ??= randomId());
  const [x, y] = await Promise.all([hmac(key, a), hmac(key, b)]);
  return x.reduce((diff, byte, i) => diff | (byte ^ y[i]!), 0) === 0;
}

export type TokenKind = "personal" | "invitation";

/**
 * Tokens are derived rather than stored, so a link can be shown again later.
 * `version` changes revoke every earlier token.
 */
export async function signToken(
  secret: string,
  kind: TokenKind,
  publicId: string,
  version: string,
): Promise<string> {
  if (!secret || secret.length < 32) throw new Error("LINK_SECRET must be at least 32 characters");
  const signature = base64url(await hmac(secret, `${kind}.${publicId}.${version}`));
  return `${publicId}.${version}.${signature}`;
}

export function tokenPublicId(token: string): string | null {
  return /^([\w-]{22})\.[\d-]+\.[\w-]{43}$/.exec(token)?.[1] ?? null;
}
