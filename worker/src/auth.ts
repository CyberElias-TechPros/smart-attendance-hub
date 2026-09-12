// Auth primitives for the SLAMS API worker.
// - PBKDF2-SHA256 password hashing via WebCrypto (hash format is self-describing:
//   pbkdf2$<iterations>$<saltB64>$<hashB64>, so password hashes keep verifying
//   even if we raise iterations later).
// - HS256 session tokens via `jose`.

import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./types";

const enc = new TextEncoder();

export const PBKDF2_ITERATIONS = 210_000;
export const SESSION_TTL = "7d";
// Used only when no secret is configured (local dev). Never rely on this in
// production — set the SLAMS_JWT_SECRET worker secret.
const DEV_FALLBACK_SECRET = "slams-dev-secret-do-not-use-in-production-0123456789ab";
let warnedNoSecret = false;

export function getJwtSecret(env: { SLAMS_JWT_SECRET?: string }): Uint8Array {
  const s = env.SLAMS_JWT_SECRET;
  if (!s) {
    if (!warnedNoSecret) {
      console.warn(
        "[slams] WARNING: SLAMS_JWT_SECRET is not set. Using an insecure dev secret — set the SLAMS_JWT_SECRET secret (npx wrangler secret put SLAMS_JWT_SECRET) before deploying to production.",
      );
      warnedNoSecret = true;
    }
    return enc.encode(DEV_FALLBACK_SECRET);
  }
  return enc.encode(s);
}

function b64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  const saltBuf = new Uint8Array(salt).buffer as ArrayBuffer;
  return `pbkdf2$${iterations}$${b64(saltBuf)}$${b64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  try {
    const salt = unb64(parts[2]);
    const expected = unb64(parts[3]);
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(password) as BufferSource,
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
      key,
      256,
    );
    return timingSafeEqual(new Uint8Array(bits), expected);
  } catch {
    return false;
  }
}

// Pre-computed on first use so unknown-user logins burn the same PBKDF2 work
// as known-user logins (reduces account enumeration via timing).
let dummyHash: string | undefined;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= await hashPassword("slams-dummy-password");
  await verifyPassword(password, dummyHash);
}

export interface SessionPayload {
  sub: string;
  role: Role;
  name: string;
}

export async function signSession(
  payload: SessionPayload,
  env: { SLAMS_JWT_SECRET?: string },
): Promise<string> {
  return await new SignJWT({ role: payload.role, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(getJwtSecret(env));
}

export async function verifySession(
  token: string,
  env: { SLAMS_JWT_SECRET?: string },
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(env));
    if (!payload.sub || !payload.role) return null;
    const role = payload.role as Role;
    if (role !== "admin" && role !== "lecturer" && role !== "student") return null;
    return { sub: String(payload.sub), role, name: String(payload.name ?? "") };
  } catch {
    return null;
  }
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}
