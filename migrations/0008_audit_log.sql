-- SLAMS audit trail (plan §4.6 / §9 / P0.3).
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)
--
-- The brief (§9) requires that "all attendance corrections must be recorded in
-- an audit log". Worker/src/audit.ts already derives privacy-preserving HMAC
-- pointers for sign-in forensics; this table is the actual append-only trail of
-- who did what, when, to which record, and why.
--
-- Append-only by construction: the API exposes no UPDATE/DELETE route for
-- audit_log, and rows are written in the same request as the change they
-- describe. Raw IPs and user-agents are never stored here — only HMAC pointers
-- (see hashedPointer), so the log joins to sign-in forensics without becoming a
-- privacy liability.

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  actor_id      TEXT,                 -- NULL for system/automated actions
  actor_role    TEXT,
  actor_email   TEXT,
  action        TEXT NOT NULL,        -- e.g. attendance.update, attendance.void, export.generate
  entity_type   TEXT NOT NULL,        -- attendance_record | course | user | semester | report | session
  entity_id     TEXT,
  course_id     TEXT,
  semester_id   TEXT,
  before_json   TEXT,                 -- the row as it was (JSON), for corrections
  after_json    TEXT,                 -- the row as it became (JSON)
  reason        TEXT,                 -- human-supplied justification where required
  ip_pointer    TEXT,                 -- HMAC pointer, never the raw address
  ua_pointer    TEXT,
  req_id        TEXT,                 -- correlates with the worker's request log line
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_course  ON audit_log(course_id, created_at DESC);
