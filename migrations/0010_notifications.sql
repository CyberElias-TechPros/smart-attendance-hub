-- SLAMS notifications (plan §4.5 / P4.5, brief §2 side nav + §2B top bar).
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)
--
-- The brief asks for a Notifications item in the sidebar and a bell in the top
-- bar. Both read this table through a single `notify()` helper, so an event is
-- described once and lands in every recipient's inbox.
--
-- Recipients are stored one row per user rather than one row per event: the
-- unread badge is then an index lookup on (user_id, read_at), and marking a
-- single user's copy as read cannot affect anybody else's.
--
-- Deliberately no UPDATE/DELETE route exists for the payload: only `read_at`
-- can change, which is what makes the inbox a record rather than a scratchpad.
-- The table is scoped, not silent: `audience` records why a user received the
-- row ('user' — addressed directly, 'course' — everyone enrolled on a course,
-- 'role' — everyone holding a role, 'admin' — institution broadcast), which is
-- what an auditor needs in order to tell a targeted message from a broadcast.

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,              -- recipient
  audience      TEXT NOT NULL DEFAULT 'user', -- why they are a recipient
  role          TEXT,                       -- recipient's role at delivery time
  kind          TEXT NOT NULL,              -- session.started | attendance.corrected | attendance.voided | export.ready | at_risk.course | semester.finalized
  title         TEXT NOT NULL,
  body          TEXT,
  entity_type   TEXT,                       -- attendance_record | course | session | report | semester
  entity_id     TEXT,
  href          TEXT,                       -- where the bell/inbox sends the reader
  course_id     TEXT,                       -- denormalised for per-course scoping
  semester_id   TEXT,
  read_at       INTEGER,                    -- NULL = unread
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_course ON notifications(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at, created_at DESC);
