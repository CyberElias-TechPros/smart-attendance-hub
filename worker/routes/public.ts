// Endpoints reachable without a session: health and public branding.

import type { Env, RequestContext } from "../lib/context";
import { json } from "../lib/http";
import { Repo } from "../lib/repo";

const SETTINGS_CACHE_KEY = "settings:public:v1";
const SETTINGS_TTL_SECONDS = 300;

export async function invalidateSettingsCache(env: Env): Promise<void> {
  await env.CACHE.delete(SETTINGS_CACHE_KEY);
}

/**
 * Branding used by the landing page and login screen. Cached in KV because it
 * is identical for every visitor and read on nearly every page load; a stale
 * window of a few minutes after an admin edit is acceptable and the cache is
 * invalidated explicitly on write.
 */
export async function publicSettings(c: RequestContext): Promise<Response> {
  const cached = await c.env.CACHE.get(SETTINGS_CACHE_KEY, "json");
  if (cached) {
    return json(cached, { headers: { "x-cache": "hit" } });
  }
  const repo = new Repo(c.env.DB);
  const settings = await repo.getSiteSettings();
  c.ctx.waitUntil(
    c.env.CACHE.put(SETTINGS_CACHE_KEY, JSON.stringify(settings), {
      expirationTtl: SETTINGS_TTL_SECONDS,
    }),
  );
  return json(settings, { headers: { "x-cache": "miss" } });
}

export async function health(c: RequestContext): Promise<Response> {
  // Touch D1 so the check fails loudly if the binding or database is broken.
  let database = "ok";
  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch (error) {
    database = error instanceof Error ? `error: ${error.message}` : "error";
  }
  return json({
    status: database === "ok" ? "ok" : "degraded",
    environment: c.env.ENVIRONMENT ?? "development",
    database,
    time: new Date().toISOString(),
  });
}

export async function listDepartments(c: RequestContext): Promise<Response> {
  const repo = new Repo(c.env.DB);
  return json({ items: await repo.listDepartments() });
}

export async function listCourses(c: RequestContext): Promise<Response> {
  const repo = new Repo(c.env.DB);
  return json({ items: await repo.listCourses() });
}
