-- SLAMS lifecycle & scheduling: session auto-close, venue capacity,
-- recurring schedules, and attendance status (excused/late/absent).
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)
--
-- All additive. Existing rows (all historical) behave exactly as before:
--   sessions.auto_end_enabled defaults to 1  → old abandoned sessions now
--   close themselves when they expire (same as the UI promised).
--   sessions.seats NULL                     → unlimited capacity.
--   attendance_records.status 'present'     → counted as attended, unchanged.

-- Auto-close: when 1 the session is ended at expires_at by housekeeping
-- (and by any request touching session paths). Lecturers can opt out.
ALTER TABLE sessions ADD COLUMN auto_end_enabled INTEGER NOT NULL DEFAULT 1;

-- Venue capacity. NULL = unlimited (legacy rows and default sessions).
ALTER TABLE sessions ADD COLUMN seats INTEGER;

-- Attendance status per record. 'present' and 'late' count as attended;
-- 'excused' and 'absent' are tracked but do not count toward the percentage.
ALTER TABLE attendance_records ADD COLUMN status TEXT NOT NULL DEFAULT 'present';
CREATE INDEX IF NOT EXISTS idx_records_status ON attendance_records(status);

-- Recurring session series (a session is materialized only when it starts,
-- so the `sessions` table keeps meaning "a session that actually happened").
CREATE TABLE IF NOT EXISTS schedules (
  id                  TEXT PRIMARY KEY,
  course_id           TEXT NOT NULL,
  lecturer_id         TEXT NOT NULL,
  duration_minutes    INTEGER NOT NULL,
  topic               TEXT,
  latitude            REAL,
  longitude           REAL,
  radius_meters       INTEGER,
  code_interval_seconds INTEGER,
  seats               INTEGER,
  recurrence          TEXT NOT NULL,          -- 'daily' | 'weekdays' | 'weekly' | 'custom'
  days_mask           TEXT NOT NULL DEFAULT '',-- CSV of ISO weekday numbers 1..7 (weekly/custom)
  minute_of_day       INTEGER NOT NULL,       -- wall-clock minutes from midnight, local
  tz_offset_minutes   INTEGER NOT NULL DEFAULT 0,
  ends_on             INTEGER,                -- stop materializing after this UTC ms
  max_occurrences     INTEGER,                -- hard cap on materialized legs
  occurrences         INTEGER NOT NULL DEFAULT 0, -- legs materialized so far
  last_start_at       INTEGER NOT NULL DEFAULT 0, -- start time of the most recent leg
  enabled             INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_course   ON schedules(course_id);
CREATE INDEX IF NOT EXISTS idx_schedules_lecturer ON schedules(lecturer_id);
