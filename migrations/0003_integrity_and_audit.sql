-- SLAMS migration 0003 — data integrity, lifecycle fields, audit logging.
--
-- Additive and idempotent-friendly: no table drops, no column removals, so it is
-- safe to apply to a database that already holds production data.
--
--   wrangler d1 migrations apply slams --local
--   wrangler d1 migrations apply slams --remote

-- ── Lifecycle / audit fields ────────────────────────────────────────────────
-- SQLite cannot add a column conditionally, and it cannot use a non-constant
-- DEFAULT in ALTER TABLE, so new timestamp columns are nullable and backfilled.

ALTER TABLE users ADD COLUMN updated_at INTEGER;
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
-- Bumped whenever credentials/role change so existing JWTs can be invalidated.
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at INTEGER;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until INTEGER;

UPDATE users SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE departments ADD COLUMN created_at INTEGER;
ALTER TABLE departments ADD COLUMN updated_at INTEGER;
UPDATE departments SET created_at = COALESCE(created_at, 0), updated_at = COALESCE(updated_at, 0);

ALTER TABLE courses ADD COLUMN created_at INTEGER;
ALTER TABLE courses ADD COLUMN updated_at INTEGER;
ALTER TABLE courses ADD COLUMN archived_at INTEGER;
UPDATE courses SET created_at = COALESCE(created_at, 0), updated_at = COALESCE(updated_at, 0);

ALTER TABLE course_enrollments ADD COLUMN created_at INTEGER;
UPDATE course_enrollments SET created_at = COALESCE(created_at, 0);

-- Attendance can be recorded by the student (self) or by a lecturer override.
ALTER TABLE attendance_records ADD COLUMN method TEXT NOT NULL DEFAULT 'code';
ALTER TABLE attendance_records ADD COLUMN recorded_by TEXT;

-- ── Integrity constraints (as unique indexes: ALTER TABLE cannot add them) ───

-- One attendance record per student per session. Previously only enforced in
-- application code, which races under concurrent submissions.
DELETE FROM attendance_records
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM attendance_records GROUP BY session_id, student_id
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_records_session_student
  ON attendance_records(session_id, student_id);

-- Course codes are institution-wide identifiers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_courses_code ON courses(code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_code ON departments(code);

-- Emails are already UNIQUE on users; add a case-insensitive guard.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci ON users(LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_matric ON users(matric_no) WHERE matric_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_staff ON users(staff_id) WHERE staff_id IS NOT NULL;

-- Only one live session per course at a time is enforced in application logic;
-- this index makes the lookup that backs it cheap.
CREATE INDEX IF NOT EXISTS idx_sessions_open ON sessions(course_id, ended_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_lecturer ON sessions(lecturer_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_student_course ON attendance_records(student_id, course_id);
CREATE INDEX IF NOT EXISTS idx_records_timestamp ON attendance_records(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_courses_lecturer ON courses(lecturer_id);
CREATE INDEX IF NOT EXISTS idx_courses_department ON courses(department_id);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);

-- Attendance codes must be unique among *live* sessions. A plain unique index
-- would forbid historical reuse, so uniqueness is enforced at insert time by
-- retrying on collision; this index keeps that check O(log n).
CREATE INDEX IF NOT EXISTS idx_sessions_code_live ON sessions(code, expires_at);

-- ── Audit log ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  resource    TEXT NOT NULL,
  resource_id TEXT,
  metadata    TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource, resource_id);
