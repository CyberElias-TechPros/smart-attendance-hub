-- SLAMS schema hardening: integrity constraints + query indexes.
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)
--
-- Safe for existing databases: duplicates are removed before the unique
-- index is added, and all other statements are additive.

-- Duplicate sign-ins can exist from the app-level check-then-insert race in
-- older versions. Keep the earliest record per (session, student).
DELETE FROM attendance_records
WHERE id NOT IN (
  SELECT MIN(id) FROM attendance_records GROUP BY session_id, student_id
);

-- Final duplicate guard: one sign-in per student per session, enforced by the
-- database (the app relies on this in submitAttendance).
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_session_student
  ON attendance_records(session_id, student_id);

-- Supporting indexes for the hot query paths.
-- (Case-insensitive email uniqueness is enforced in the app layer; a UNIQUE
-- LOWER(email) index could fail on legacy rows that differ only in case.)
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_courses_lecturer  ON courses(lecturer_id);
CREATE INDEX IF NOT EXISTS idx_courses_department ON courses(department_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_timestamp ON attendance_records(timestamp);
