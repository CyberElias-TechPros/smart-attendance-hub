-- SLAMS academic structure (plan §4.1–§4.2 / P1.1).
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)
--
-- Adds the institution layer the brief's dashboard depends on:
--   Faculty → Department → Course, and Academic session → Semester → lectures.
--
-- Design note (deviation from the plan, documented): UPGRADE-PLAN §4.2 proposed
-- a full `course_offerings` split (a catalogue course re-offered per semester,
-- each with its own lecturer and roster). This migration implements the lighter
-- variant the plan also analyses: a course carries a `semester_id`, while every
-- session and attendance record stores the semester it actually happened in.
--
-- Why the lighter variant:
--   * Cross-semester reporting still works — sessions/records remember their own
--     semester, so last term's figures do not move when a course is re-scheduled.
--   * No roster/lecturer history is lost, and no course rows are cloned (which
--     would duplicate course codes and break "same course over time" queries).
--   * It is additive: nothing that already reads `courses` changes meaning.
-- The trade-off: one course row = one current roster/lecturer. If an institution
-- needs two simultaneous cohorts of the same course code in one semester, the
-- offering split becomes necessary — the compatibility rule and the migration
-- path are recorded in docs/UPGRADE-PLAN.md §4.2/§13.
--
-- Everything here is additive; existing rows keep behaving exactly as before
-- (NULL semester/faculty = "not yet classified", which the UI labels explicitly
-- rather than guessing).

-- ── Faculties: the level above departments (brief §2 sidebar) ──
CREATE TABLE IF NOT EXISTS faculties (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  code         TEXT NOT NULL,
  dean_user_id TEXT,
  icon         TEXT,
  color        TEXT,
  created_at   INTEGER NOT NULL
);
ALTER TABLE departments ADD COLUMN faculty_id TEXT;
ALTER TABLE departments ADD COLUMN hod_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_departments_faculty ON departments(faculty_id);

-- ── Academic sessions ("2024/2025") and semesters ("First Semester 2025") ──
CREATE TABLE IF NOT EXISTS academic_sessions (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  starts_on  INTEGER,
  ends_on    INTEGER,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_sessions_code ON academic_sessions(code);

CREATE TABLE IF NOT EXISTS semesters (
  id                  TEXT PRIMARY KEY,
  academic_session_id TEXT NOT NULL,
  name                TEXT NOT NULL,          -- "First Semester"
  sequence            INTEGER NOT NULL DEFAULT 1,
  starts_on           INTEGER,
  ends_on             INTEGER,
  is_current          INTEGER NOT NULL DEFAULT 0,
  -- Set when the period is published: new lectures and corrections are then
  -- rejected unless an administrator overrides (plan §9 / P5.3).
  finalized_at        INTEGER,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_semesters_session ON semesters(academic_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_semesters_session_sequence
  ON semesters(academic_session_id, sequence);

-- ── Period scoping for the catalogue and the institution's active period ──
ALTER TABLE courses ADD COLUMN semester_id TEXT;
CREATE INDEX IF NOT EXISTS idx_courses_semester ON courses(semester_id);

ALTER TABLE site_settings ADD COLUMN current_academic_session_id TEXT;
ALTER TABLE site_settings ADD COLUMN current_semester_id TEXT;
ALTER TABLE site_settings ADD COLUMN logo_url TEXT;
ALTER TABLE site_settings ADD COLUMN report_footer_note TEXT;

-- ── Backfill: one current academic session + semester, so the selectors in the
--    top bar are never empty on an existing deployment. The default period is
--    deliberately left "open" (no dates) and is marked as current.
INSERT OR IGNORE INTO academic_sessions (id, name, code, starts_on, ends_on, is_current, created_at)
VALUES (
  'as_current',
  CAST(strftime('%Y', 'now') AS TEXT) || '/' || CAST(strftime('%Y', 'now') + 1 AS TEXT),
  'CURRENT-' || strftime('%Y', 'now'),
  NULL,
  NULL,
  1,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);

INSERT OR IGNORE INTO semesters (id, academic_session_id, name, sequence, starts_on, ends_on, is_current, finalized_at, created_at)
VALUES (
  'sem_current',
  'as_current',
  'First Semester',
  1,
  NULL,
  NULL,
  1,
  NULL,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);

-- Adopt the backfilled period as the institution's active one (only when the
-- admin has not already chosen something).
UPDATE site_settings
SET current_academic_session_id = COALESCE(current_academic_session_id, 'as_current'),
    current_semester_id = COALESCE(current_semester_id, 'sem_current')
WHERE id = 'site';

-- Every existing course belongs to the backfilled current semester: this keeps
-- "filter by semester" honest (rather than showing a blank period) while the
-- semester_id column stays meaningful for newly created courses.
UPDATE courses SET semester_id = 'sem_current' WHERE semester_id IS NULL;

-- Existing lectures inherit their course's semester so historical reports are
-- immediately scoped correctly.
UPDATE sessions
SET semester_id = (SELECT c.semester_id FROM courses c WHERE c.id = sessions.course_id)
WHERE semester_id IS NULL;

UPDATE attendance_records
SET semester_id = (
  SELECT s.semester_id FROM sessions s WHERE s.id = attendance_records.session_id
)
WHERE semester_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_records_semester_status
  ON attendance_records(semester_id, status);
