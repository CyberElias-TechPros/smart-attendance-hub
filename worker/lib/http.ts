import { z } from "zod";

import { ApiError } from "./errors";
import { CSRF_HEADER, type Env, type RequestContext } from "./context";

/**
 * Strict origin allow-list. `ALLOWED_ORIGINS` is a comma-separated list of exact
 * origins; a leading `*.` marks a wildcard subdomain (used for Vercel previews).
 * We never reflect an arbitrary origin, and never send `*` alongside credentials.
 */
export function resolveOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const entry of allowed) {
    if (entry === origin) return origin;
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1); // ".vercel.app"
      try {
        const host = new URL(origin).host;
        if (host.endsWith(suffix) && origin.startsWith("https://")) return origin;
      } catch {
        /* malformed origin — reject */
      }
    }
  }
  return null;
}

export function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = resolveOrigin(request, env);
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("vary", "Origin");
  }
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", `content-type,${CSRF_HEADER}`);
  headers.set("access-control-max-age", "86400");
  return headers;
}

/** Security headers applied to every API response. */
export function securityHeaders(): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "geolocation=(), camera=(), microphone=()",
    "cross-origin-resource-policy": "same-site",
    // API responses are user-specific; never let a shared cache hold them.
    "cache-control": "no-store",
  };
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** Parses and validates a JSON body, rejecting oversized or malformed payloads. */
export async function readJson<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw ApiError.validation("Expected a JSON request body.");
  }
  const raw = await request.text();
  if (raw.length > 512 * 1024) throw ApiError.validation("Request body is too large.");
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw ApiError.validation("Request body is not valid JSON.");
  }
  return schema.parse(parsed);
}

export function readQuery<T extends z.ZodTypeAny>(url: URL, schema: T): z.infer<T> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) obj[key] = value;
  return schema.parse(obj);
}

// ── Rate limiting ───────────────────────────────────────────────────────────

export interface RateLimitRule {
  /** Bucket name, e.g. "login". */
  key: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window rate limiter backed by Workers KV. KV is eventually consistent,
 * so this is a best-effort abuse control rather than a hard quota — appropriate
 * for login throttling and expensive-endpoint protection. Hard per-account
 * lockout for credential stuffing is enforced separately in D1 (failed_logins).
 */
export async function enforceRateLimit(
  c: RequestContext,
  rule: RateLimitRule,
  identifier: string,
): Promise<void> {
  const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
  const key = `rl:${rule.key}:${identifier}:${window}`;
  const current = Number.parseInt((await c.env.RATE_LIMIT.get(key)) ?? "0", 10) || 0;
  if (current >= rule.limit) {
    c.log("rate_limit_exceeded", { rule: rule.key, identifier });
    throw ApiError.rateLimited();
  }
  c.ctx.waitUntil(
    c.env.RATE_LIMIT.put(key, String(current + 1), {
      expirationTtl: Math.max(60, rule.windowSeconds * 2),
    }),
  );
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
