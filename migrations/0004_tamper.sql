-- SLAMS tamper-proofing: rotating session codes, device binding, sign-in distance.
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)
--
-- All additive + nullable: existing rows (all historical) behave exactly as
-- before — NULL interval means "static code", NULL device/distance means
-- "recorded before tamper-proofing".

-- Rotating codes: when code_interval_seconds is set, the session code
-- refreshes every N seconds. prev_code + code_updated_at implement the grace
-- window so a student mid-sign-in isn't rejected by a rotation boundary.
ALTER TABLE sessions ADD COLUMN code_interval_seconds INTEGER;
ALTER TABLE sessions ADD COLUMN code_updated_at INTEGER;
ALTER TABLE sessions ADD COLUMN prev_code TEXT;

-- Per-sign-in forensics: which device signed in, and (for geofenced
-- sessions) how far from the venue the student was when signing in.
ALTER TABLE attendance_records ADD COLUMN device_id TEXT;
ALTER TABLE attendance_records ADD COLUMN distance_meters INTEGER;

-- The course/faculty report device-count subqueries filter on
-- (course_id, student_id); this also speeds the existing attended-count
-- subqueries on the same shape.
CREATE INDEX IF NOT EXISTS idx_records_course_student
  ON attendance_records(course_id, student_id);
