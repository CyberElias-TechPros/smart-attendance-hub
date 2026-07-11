-- SLAMS D1 schema (SQLite). Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)

CREATE TABLE IF NOT EXISTS departments (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  matric_no     TEXT,
  staff_id      TEXT,
  department_id TEXT,
  level         TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,
  title         TEXT NOT NULL,
  department_id TEXT NOT NULL,
  level         TEXT NOT NULL,
  units         INTEGER NOT NULL,
  lecturer_id   TEXT
);

CREATE TABLE IF NOT EXISTS course_enrollments (
  course_id  TEXT NOT NULL,
  student_id TEXT NOT NULL,
  PRIMARY KEY (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  course_id     TEXT NOT NULL,
  lecturer_id   TEXT NOT NULL,
  code          TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  latitude      REAL,
  longitude     REAL,
  radius_meters INTEGER,
  topic         TEXT
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  course_id  TEXT NOT NULL,
  timestamp  INTEGER NOT NULL,
  latitude   REAL,
  longitude  REAL
);

CREATE INDEX IF NOT EXISTS idx_sessions_code    ON sessions(code);
CREATE INDEX IF NOT EXISTS idx_sessions_course  ON sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_records_session  ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_records_course   ON attendance_records(course_id);
CREATE INDEX IF NOT EXISTS idx_records_student  ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_enroll_course    ON course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_enroll_student   ON course_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
