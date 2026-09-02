import { randomId } from "./crypto";
import type { RequestContext } from "./context";

export interface AuditInput {
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
  actorRole?: string | null;
}

const SENSITIVE_KEYS = /^(password|newPassword|currentPassword|token|secret|passwordHash)$/i;

/** Strips credentials before anything reaches durable storage or logs. */
export function redact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEYS.test(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redact(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Writes an audit entry. Deliberately fire-and-forget via `waitUntil`: audit
 * logging must never fail or slow down the user-facing operation it records.
 */
export function audit(c: RequestContext, input: AuditInput): void {
  const row = {
    id: randomId(10),
    actorId: input.actorId ?? c.claims?.sub ?? null,
    actorRole: input.actorRole ?? c.claims?.role ?? null,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId ?? null,
    metadata: input.metadata ? JSON.stringify(redact(input.metadata)) : null,
    ip: c.clientIp,
    createdAt: Date.now(),
  };
  c.log("audit", { action: row.action, resource: row.resource, resourceId: row.resourceId });
  c.ctx.waitUntil(
    c.env.DB.prepare(
      `INSERT INTO audit_log (id, actor_id, actor_role, action, resource, resource_id, metadata, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.id,
        row.actorId,
        row.actorRole,
        row.action,
        row.resource,
        row.resourceId,
        row.metadata,
        row.ip,
        row.createdAt,
      )
      .run()
      .catch((error: unknown) => {
        console.error(
          JSON.stringify({ level: "error", event: "audit_write_failed", message: String(error) }),
        );
      }),
  );
}
