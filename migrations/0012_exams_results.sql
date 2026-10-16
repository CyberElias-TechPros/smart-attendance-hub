-- SLAMS examinations & results (plan §4.4 / P4.3 — the brief's §2 sidebar
-- items "Examinations" and "Results").
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)
--
-- Design notes, because two decisions here are load-bearing:
--
-- 1. An exam belongs to a *course*, not to an offering. The period model is the
--    lighter variant documented in migration 0009: a course carries one current
--    roster/lecturer and `semester_id`. Scoring against the course while storing
--    the semester on the exam keeps "same course, different terms" answerable
--    (filter by semester) without cloning course rows.
--
-- 2. `score` and `max_score` are stored, never a bare percentage. A lecturer who
--    re-weights a continuous assessment from /20 to /100 must not silently change
--    a published grade, and a percentage is derivable from the pair but not the
--    other way round. `grade` is stored as well: it is an institutional decision
--    (an A is not 70% everywhere) and freezing what was awarded is what makes a
--    transcript defensible.
--
-- Everything is additive. Deleting an exam cascades its results in the repo
-- layer inside one transaction-shaped sequence (see Repo.deleteExam), and results
-- are upserted on (exam_id, student_id) so an import can be re-run safely.

CREATE TABLE IF NOT EXISTS exams (
  id               TEXT PRIMARY KEY,
  course_id        TEXT NOT NULL,
  semester_id      TEXT,
  title            TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'exam',   -- ca | test | exam | practical
  weight           REAL,                           -- contribution to the final score, %
  max_score        REAL NOT NULL DEFAULT 100,
  scheduled_at     INTEGER,
  duration_minutes INTEGER,
  venue            TEXT,
  room             TEXT,
  published        INTEGER NOT NULL DEFAULT 0,     -- results released to students
  created_by       TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exams_course   ON exams(course_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_exams_semester ON exams(semester_id);
CREATE INDEX IF NOT EXISTS idx_exams_date     ON exams(scheduled_at);

CREATE TABLE IF NOT EXISTS results (
  id          TEXT PRIMARY KEY,
  exam_id     TEXT NOT NULL,
  course_id   TEXT NOT NULL,      -- denormalised: a result is always read per course
  semester_id TEXT,
  student_id  TEXT NOT NULL,
  score       REAL,               -- NULL = not yet marked (distinct from 0)
  grade       TEXT,
  entered_by  TEXT,
  updated_at  INTEGER NOT NULL,
  UNIQUE (exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_results_exam    ON results(exam_id);
CREATE INDEX IF NOT EXISTS idx_results_student ON results(student_id, course_id);
CREATE INDEX IF NOT EXISTS idx_results_course  ON results(course_id);

-- ── Published period snapshots (plan §4.3 / P5.3) ──
-- A finalised semester must stay reproducible: the figures that were published
-- are frozen here as JSON so re-running the report years later cannot quietly
-- produce different numbers after a correction or a re-weighting.
CREATE TABLE IF NOT EXISTS report_snapshots (
  id           TEXT PRIMARY KEY,
  scope        TEXT NOT NULL,        -- semester | course | faculty | department | institution
  entity_id    TEXT,                 -- the semester/course/faculty id the snapshot covers
  label        TEXT NOT NULL,        -- human-readable ("2026/2027 · First Semester")
  payload_json TEXT NOT NULL,        -- the exact report payload that was published
  totals_json  TEXT,                 -- signature totals, extracted for quick comparison
  row_count    INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_scope ON report_snapshots(scope, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON report_snapshots(created_at DESC);

-- ── Attendance policy for examinations (plan §4.4 / P4.4) ──
-- Off by default. The Results page reports the split either way; this flag is
-- what makes the institution assert the consequence ("below the threshold is
-- barred") rather than merely describe it.
ALTER TABLE site_settings ADD COLUMN barred_from_exam_below_threshold INTEGER NOT NULL DEFAULT 0;
