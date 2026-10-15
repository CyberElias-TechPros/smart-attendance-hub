-- SLAMS attendance integrity (plan §4.3 / P0.2 + P0.4 groundwork).
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)
--
-- Why this migration exists: until now a student who never signed in simply had
-- NO row in attendance_records, so "absent" could only be inferred as
-- (sessions − attended). That made Present/Absent/Late impossible to total
-- independently, made approved exclusions indistinguishable from truancy, and
-- made every "who missed today?" question a subquery puzzle.
--
-- From here on, when a session closes the roster's unmet expectations are
-- materialised as status='absent' rows (source='auto_absent'). Sign-in
-- surfaces filter them out, reporting counts them directly.
--
-- All statements are additive; existing rows behave exactly as before:
--   source      → 'scan'  (they were written by a real sign-in)
--   created_at  → backfilled from `timestamp`
--   locked      → 0       (nothing is frozen until a semester is finalised)
--   enrolled_at → 0       (means "enrolled since the beginning of time", so
--                          historical percentages are unchanged)

-- ── Provenance & correction bookkeeping on every attendance row ──
ALTER TABLE attendance_records ADD COLUMN source TEXT NOT NULL DEFAULT 'scan';
ALTER TABLE attendance_records ADD COLUMN marked_by TEXT;   -- user id for manual edits
ALTER TABLE attendance_records ADD COLUMN reason TEXT;      -- required when a human changes a record
ALTER TABLE attendance_records ADD COLUMN locked INTEGER NOT NULL DEFAULT 0; -- frozen by semester finalisation
ALTER TABLE attendance_records ADD COLUMN created_at INTEGER;
ALTER TABLE attendance_records ADD COLUMN updated_at INTEGER;

UPDATE attendance_records SET created_at = timestamp WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_records_source         ON attendance_records(source);
CREATE INDEX IF NOT EXISTS idx_records_session_status ON attendance_records(session_id, status);

-- ── Enrolment start date: "expected to attend" only from when they enrolled ──
-- DEFAULT 0 = "since the beginning", which keeps every existing course's
-- history exactly as reported today. New enrolments get a real timestamp, so a
-- student who joins in week 8 is not blamed for weeks 1–7.
ALTER TABLE course_enrollments ADD COLUMN enrolled_at INTEGER NOT NULL DEFAULT 0;

-- ── Period windows (used from P1 onward; harmless now) ──
-- Sessions gain an explicit semester bucket so a report can be scoped to a
-- period without guessing from timestamps. NULL = "not yet assigned".
ALTER TABLE sessions ADD COLUMN semester_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_semester ON sessions(semester_id);

-- Attendance records carry the same bucket (denormalised) so the hot reporting
-- queries never need a join back to sessions for period filtering.
ALTER TABLE attendance_records ADD COLUMN semester_id TEXT;
CREATE INDEX IF NOT EXISTS idx_records_semester ON attendance_records(semester_id);

-- ── Institution reporting settings (plan §3.2 / P0.4) ──
-- "Present today", "this week", and every period delta must be anchored to the
-- institution's own clock, not the server's UTC day or the visitor's browser.
-- The policy flags let an institution change the two decisions that move every
-- percentage (plan §14 D3/D4) without a code change.
ALTER TABLE site_settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Africa/Lagos';
ALTER TABLE site_settings ADD COLUMN late_counts_as_attended INTEGER NOT NULL DEFAULT 1;
ALTER TABLE site_settings ADD COLUMN excused_counts_as_absent INTEGER NOT NULL DEFAULT 1;
