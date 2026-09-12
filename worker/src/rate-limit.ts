// Lightweight fixed-window rate limiter.
//
// Storage is in-memory per Worker isolate. Cloudflare may run multiple
// isolates, so limits are approximate — sufficient for abuse protection
// (brute-force, code-guessing) without the latency/dependencies of a KV
// round-trip. Documented as such in DEPLOY.md.

interface Window {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  private windows = new Map<string, Window>();
  private readonly maxEntries = 20_000;

  /** Returns true when the request is allowed; records the hit either way. */
  hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    w.count += 1;
    return w.count <= limit;
  }

  /** Returns true when the next hit would be allowed, WITHOUT recording a hit. */
  peek(key: string, limit: number, now = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) return true;
    return w.count < limit;
  }

  /** Prune expired windows once the map grows (keeps memory bounded). */
  maybePrune(now = Date.now()): void {
    if (this.windows.size < this.maxEntries) return;
    for (const [key, w] of this.windows) {
      if (w.resetAt <= now) this.windows.delete(key);
    }
  }
}

export interface Limits {
  /** Login attempts per IP (brute-force protection). */
  login: { limit: number; windowMs: number };
  /** Unauthenticated API requests per IP. */
  publicApi: { limit: number; windowMs: number };
  /** Authenticated API requests per user. */
  authedApi: { limit: number; windowMs: number };
  /** Attendance submissions per student (code-guessing protection). */
  attendance: { limit: number; windowMs: number };
}

export const DEFAULT_LIMITS: Limits = {
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  publicApi: { limit: 120, windowMs: 60 * 1000 },
  authedApi: { limit: 600, windowMs: 60 * 1000 },
  attendance: { limit: 20, windowMs: 60 * 1000 },
};
