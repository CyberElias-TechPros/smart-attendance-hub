// The append-only audit trail (plan §4.6 / §9).
//
// Distinct from ./audit.ts, which derives the *privacy-preserving HMAC pointers*
// used for sign-in forensics. This module records intent and accountability:
// who changed what, when, from where (as a pointer), and — for corrections —
// why. The brief (§9) requires that "all attendance corrections must be
// recorded in an audit log"; that requirement is satisfied by routing every
// mutation through `appendAudit` below.
//
// Design rules:
//   1. Append-only. There is no update or delete path, in the repo or the API.
//   2. Never store raw IPs or user-agents — only HMAC pointers, so the log can
//      be joined against sign-in forensics without becoming a privacy hazard.
//   3. A failed audit write must never silently swallow the mutation it
//      describes: callers log the failure loudly (see `recordAudit`).
//   4. `before`/`after` are stored as JSON so an institution can answer
//      "what exactly did the old value say?" without a schema per entity.

import { hashedPointer } from "./audit";
import type { AuditQuery, AuditEntry, Paginated } from "./types";

/** The narrow slice of the repository the audit writer needs. Keeping this
 *  structural (rather than importing Repo) avoids a circular import. */
export interface AuditStore {
  appendAudit(input: AppendAuditInput): Promise<string>;
}

export interface AppendAuditInput {
  actorId?: string | null;
  actorRole?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  courseId?: string | null;
  semesterId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipPointer?: string | null;
  uaPointer?: string | null;
  reqId?: string | null;
}

/** Context the HTTP layer supplies so every entry is attributable. */
export interface AuditContext {
  actorId?: string;
  actorRole?: string;
  actorEmail?: string;
  ip?: string;
  userAgent?: string;
  reqId?: string;
  secret?: Uint8Array;
}

/** Short, non-reversible pointer for an IP or user-agent string. */
export async function pointerFor(
  value: string | undefined,
  secret: Uint8Array | undefined,
): Promise<string | null> {
  if (!value || !secret || secret.length < 16) return null;
  return hashedPointer(secret, value);
}

/**
 * Write one audit entry, never throwing into the caller's path.
 *
 * Rationale: an institution would rather have a successful correction with a
 * noisy log line than a 500 that leaves the operator unsure whether the change
 * applied. The error is surfaced via console.error so it shows up in the
 * Worker's observability sink and can be alerted on.
 */
export async function recordAudit(
  store: AuditStore,
  input: AppendAuditInput,
  ctx: AuditContext = {},
): Promise<boolean> {
  try {
    await store.appendAudit({
      ...input,
      actorId: input.actorId ?? ctx.actorId ?? null,
      actorRole: input.actorRole ?? ctx.actorRole ?? null,
      actorEmail: input.actorEmail ?? ctx.actorEmail ?? null,
      ipPointer: input.ipPointer ?? (await pointerFor(ctx.ip, ctx.secret)),
      uaPointer: input.uaPointer ?? (await pointerFor(ctx.userAgent, ctx.secret)),
      reqId: input.reqId ?? ctx.reqId ?? null,
    });
    return true;
  } catch (e) {
    console.error(
      JSON.stringify({ msg: "audit_write_failed", action: input.action, entity: input.entityType }),
      e,
    );
    return false;
  }
}

/** Human-readable summary of an audit row, used by the UI and CSV exports. */
export function describeAudit(entry: AuditEntry): string {
  const who = entry.actorEmail ?? entry.actorId ?? "system";
  const target = entry.entityId ? `${entry.entityType} ${entry.entityId}` : entry.entityType;
  const why = entry.reason ? ` — “${entry.reason}”` : "";
  return `${who} ${entry.action.replace(/\./g, " ")} on ${target}${why}`;
}

export type { AuditQuery, AuditEntry, Paginated };
