import type { Role } from "../../shared/schemas";
import { ApiError } from "./errors";
import { verifyToken, type SessionClaims } from "./crypto";

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  RATE_LIMIT: KVNamespace;
  EXPORTS: R2Bucket;
  SESSION_SECRET: string;
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
  SEED_DEMO_DATA?: string;
  DEMO_PASSWORD?: string;
}

export const SESSION_COOKIE = "slams_session";
export const CSRF_COOKIE = "slams_csrf";
export const CSRF_HEADER = "x-slams-csrf";
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h — shorter than the old 7d.

export interface RequestContext {
  env: Env;
  requestId: string;
  url: URL;
  request: Request;
  ctx: ExecutionContext;
  claims: SessionClaims | null;
  /** Collected response headers (Set-Cookie etc.) applied by the router. */
  responseHeaders: Headers;
  clientIp: string;
  log: (event: string, data?: Record<string, unknown>) => void;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1));
    } catch {
      out[key] = part.slice(eq + 1);
    }
  }
  return out;
}

/**
 * Session cookies are `SameSite=None; Secure` because the frontend on Vercel and
 * the API on Workers are different registrable domains — `Lax` would drop the
 * cookie on every cross-site XHR. CSRF is therefore defended explicitly with a
 * double-submit token rather than relying on SameSite.
 */
export function buildSessionCookie(token: string, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    secure ? "SameSite=None" : "SameSite=Lax",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Readable by JS on purpose: the client echoes it back in the CSRF header. */
export function buildCsrfCookie(value: string, secure: boolean): string {
  const attrs = [
    `${CSRF_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    secure ? "SameSite=None" : "SameSite=Lax",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildClearCookies(secure: boolean): string[] {
  const suffix = secure ? "SameSite=None; Secure" : "SameSite=Lax";
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0; ${suffix}`,
    `${CSRF_COOKIE}=; Path=/; Max-Age=0; ${suffix}`,
  ];
}

export async function loadClaims(request: Request, env: Env): Promise<SessionClaims | null> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return verifyToken(token, env.SESSION_SECRET);
}

/**
 * Enforces authentication and (optionally) role membership, and re-checks the
 * token version against the database so password changes, role changes and
 * deletions immediately invalidate outstanding sessions.
 */
export async function requireUser(
  c: RequestContext,
  roles?: readonly Role[],
): Promise<SessionClaims> {
  if (!c.claims) throw ApiError.unauthenticated();
  const row = await c.env.DB.prepare(
    "SELECT token_version, role, deleted_at FROM users WHERE id = ?",
  )
    .bind(c.claims.sub)
    .first<{ token_version: number; role: Role; deleted_at: number | null }>();

  if (!row || row.deleted_at != null)
    throw ApiError.unauthenticated("Your account is no longer active.");
  if (row.token_version !== c.claims.tv) {
    throw ApiError.unauthenticated("Your session has expired. Please sign in again.");
  }
  // Trust the database role over the token in case of an in-flight change.
  const claims = { ...c.claims, role: row.role };
  if (roles && !roles.includes(claims.role)) throw ApiError.forbidden();
  return claims;
}

/**
 * Double-submit CSRF check for state-changing requests. The session cookie is
 * HttpOnly and cross-site, so an attacker's page can send it — but cannot read
 * the readable CSRF cookie to mirror it into the required header.
 */
export function requireCsrf(c: RequestContext): void {
  const method = c.request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const cookies = parseCookies(c.request.headers.get("cookie"));
  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = c.request.headers.get(CSRF_HEADER);
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw ApiError.forbidden("Your session could not be verified. Please refresh and try again.");
  }
}
