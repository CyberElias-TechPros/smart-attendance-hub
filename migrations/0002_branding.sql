-- SLAMS schema additions: course/department branding + site settings.
-- Apply with:
--   wrangler d1 migrations apply slams --local      (local dev)
--   wrangler d1 migrations apply slams --remote     (production)

ALTER TABLE departments ADD COLUMN icon TEXT;
ALTER TABLE departments ADD COLUMN color TEXT;

ALTER TABLE courses ADD COLUMN icon TEXT;
ALTER TABLE courses ADD COLUMN color TEXT;
ALTER TABLE courses ADD COLUMN category TEXT;
ALTER TABLE courses ADD COLUMN description TEXT;

CREATE TABLE IF NOT EXISTS site_settings (
  id                   TEXT PRIMARY KEY,
  institution_name     TEXT NOT NULL,
  at_risk_threshold     INTEGER NOT NULL,
  marquee_items         TEXT NOT NULL,
  testimonials          TEXT NOT NULL,
  demo_accounts_enabled INTEGER NOT NULL,
  demo_password         TEXT NOT NULL,
  demo_email_domain     TEXT NOT NULL,
  show_fake_stats       INTEGER NOT NULL,
  primary_color         TEXT,
  contact_email         TEXT
);
