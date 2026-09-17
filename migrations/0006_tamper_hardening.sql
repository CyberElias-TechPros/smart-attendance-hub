-- SLAMS tamper-hardening (Phase 2): cryptographic sign-in evidence,
-- server-side revocation (logout-everywhere / password-change), and
-- IP-forensics for every sign-in.
--
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)
--
-- All additive. Legacy rows behave exactly as before:
--   attendance_records.evidence NULL            → recorded before attestation.
--   users.auth_version 1                        → existing sessions stay valid until refresh/relogin.
--   attendance_records.ip NULL / ua NULL / colo NULL → recorded before IP forensics.

-- HMAC-signed, server-attestable proof that a given device claimed to be at
-- the venue. Never mutable by the client; deleted/edited only via admin
-- operations that are themselves logged (see the worker's audit logging).
ALTER TABLE attendance_records ADD COLUMN evidence TEXT;

-- IP + user-agent + Cloudflare colo captured at sign-in, so a lecturer can
-- see "sign-ins from 3 different cities in the same hour" as a proxy-sharing
-- signal. Stored as metadata only; never used to authorise by itself.
ALTER TABLE attendance_records ADD COLUMN ip TEXT;
ALTER TABLE attendance_records ADD COLUMN ua TEXT;
ALTER TABLE attendance_records ADD COLUMN colo TEXT;
ALTER TABLE attendance_records ADD COLUMN net_distance_meters INTEGER;
ALTER TABLE attendance_records ADD COLUMN net_lat REAL;
ALTER TABLE attendance_records ADD COLUMN net_lng REAL;

-- Per-user token generation. Bumping this invalidates every outstanding JWT
-- for the user (stored-token logout / revocation-on-password-change). Row
-- keeps legacy sessions working: rows written before this migration get
-- auth_version 1 and the worker only revokes when it differs from the token.
ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;

-- Course-level default venue geofence. When set, every session (one-off or
-- recurring) that doesn't pin its own location inherits this venue lock, so
-- students can't sign in away from the classroom. lat/lng/radius are set
-- together (validated in the worker); all NULL = "no venue lock".
ALTER TABLE courses ADD COLUMN venue_lat REAL;
ALTER TABLE courses ADD COLUMN venue_lng REAL;
ALTER TABLE courses ADD COLUMN venue_radius INTEGER;

-- Anti-hammer + code-spray index for forensic lookups.
CREATE INDEX IF NOT EXISTS idx_records_ip ON attendance_records(ip);
CREATE INDEX IF NOT EXISTS idx_records_timestamp_course ON attendance_records(timestamp, course_id);
