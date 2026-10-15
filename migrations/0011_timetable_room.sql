-- SLAMS timetable rooms (plan §10 P4.1 — the Timetable page in the brief's §2 sidebar).
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)
--
-- The recurring-series table already carries everything a weekly grid needs —
-- recurrence, days_mask, minute_of_day, duration_minutes, tz_offset_minutes —
-- except *where* the lecture happens. Clash detection is only meaningful with a
-- venue, so the room becomes a first-class attribute of the series rather than
-- free text inside the topic.
--
-- Nullable on purpose: existing series keep working, and a series without a room
-- is simply never reported as a room clash (it can still clash by lecturer).

ALTER TABLE schedules ADD COLUMN room TEXT;

CREATE INDEX IF NOT EXISTS idx_schedules_room ON schedules(room);
