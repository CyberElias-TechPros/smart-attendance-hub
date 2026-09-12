// Opaque per-device identity for attendance forensics.
//
// Each browser gets a random, persisted id sent with every sign-in. The
// server counts DISTINCT devices per student per course, so a lecturer can
// see "this student signed in from 3 devices" in reports. It is a detection
// signal, not a lockout: clearing storage or switching browsers just shows
// up as another device (which is exactly what a proxy-sign-in ring would
// have to do at scale).

const KEY = "slams.device";

let mem: string | null = null;

/** Stable id for this browser (persisted; in-memory fallback for private mode). */
export function getDeviceId(): string {
  if (mem) return mem;
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) {
      mem = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    localStorage.setItem(KEY, fresh);
    mem = fresh;
    return fresh;
  } catch {
    // Storage unavailable (private mode, disabled cookies, SSR/test env).
    mem ??= `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return mem;
  }
}

/** Short, human-scannable form for tables ("a1b2c3d4"). */
export function shortDeviceId(id?: string | null): string {
  return id ? id.slice(0, 8) : "—";
}

/** Test-only: reset the memo so consecutive tests start clean. */
export function __resetDeviceMemo(): void {
  mem = null;
}
