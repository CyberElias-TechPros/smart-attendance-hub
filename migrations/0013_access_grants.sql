-- Extra capabilities granted to a named user (plan §9 / P5.2).
--
-- The three roles (admin | lecturer | student) stay as they are: they are how the
-- product decides *which application* somebody is in, and widening them into a
-- hierarchy would change every guard at once. What was missing is the middle
-- ground the brief's §9 asks for — a lecturer who is trusted with the whole
-- department's reports, an examinations officer who may publish marks, a senior
-- tutor who may read the audit trail — without making them administrators.
--
-- So a grant is an additive capability, tied to a person, granted by a named
-- administrator and revocable. It is deliberately a table rather than a JSON
-- column on `users`:
--
--   * "who gave this person this capability, and when" is a question an
--     institution asks during a security review, and a JSON blob cannot answer
--     it;
--   * revoking is a DELETE of one row rather than a read-modify-write of a blob
--     (which two administrators clicking at once can lose);
--   * the audit log records the same facts again, so the trail survives a grant
--     row being removed.
--
-- Nothing here grants a capability *within* the role model that the API does not
-- also check: every reader calls Repo.hasPermission(), and the checks live next
-- to the data they protect.

CREATE TABLE IF NOT EXISTS access_grants (
  user_id      TEXT NOT NULL,
  permission   TEXT NOT NULL,          -- see shared/permissions.ts
  granted_by   TEXT,                   -- admin who granted it (NULL = seeded)
  granted_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_access_grants_user ON access_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_access_grants_perm ON access_grants(permission);
