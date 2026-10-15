# SLAMS — School Administrative Dashboard Upgrade Plan

**Version:** 2.0 (planning document)
**Date:** 15 October 2026
**Scope:** Upgrade the existing SLAMS repository into the _School Administrative Dashboard_ specified by the client brief (Felix Hosea, v1.0).
**Companion docs:** [`GAP-ANALYSIS.md`](./GAP-ANALYSIS.md) (engineering gap log), [`../DEPLOY.md`](../DEPLOY.md) (deployment), [`reference/admin-dashboard-v1-reference.jpeg`](./reference/admin-dashboard-v1-reference.jpeg) (the supplied visual reference mock).

---

## 0. Verdict in one page

The repository is **not** a static dashboard and is **not** a prototype. It is a working, tested, deployed-as-configuration full-stack product: a React SPA on Vercel talking to a Cloudflare Worker + D1 API, with real QR/rotating-code attendance sessions, GPS geofencing, HMAC sign-in attestation, device forensics, recurring lecture schedules, cron-driven auto-start/auto-close, PBKDF2 + JWT auth with server-side revocation, seed data, 6 migrations and a multi-suite test harness.

What it is **missing is the administrative _reporting institution layer_** the brief describes:

| The brief asks for                                                                                                      | Today                                                                          | Gap size            |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------- |
| Faculties, Timetable, Attendance, Examinations, Results, Notifications menu items                                       | Sidebar has 8 flat items                                                       | Medium              |
| Expandable **Courses** menu → All Courses / Add Course / Course Categories                                              | Courses is a flat link                                                         | Small               |
| Academic **session + semester** in the top bar, filters, and every report                                               | No session/semester concept anywhere                                           | **Large (schema)**  |
| Dashboard KPI cards: Total Courses, Students, **Classes Held**, Overall Attendance %, **Present Today**                 | 6 count cards + one weekly chart                                               | Medium              |
| **All Courses table** with 12 columns (classes held, attended, present/absent/late, %)                                  | Course **card grid**; no attendance columns                                    | Medium              |
| **Admin** individual course detail page (lecturer, sessions, per-date drill-down, trends)                               | Exists for **lecturers only**                                                  | Medium              |
| 7 filters (session, semester, faculty, dept, course, lecturer, date range, status)                                      | One course dropdown                                                            | Medium              |
| Excel + PDF export **of the current filter selection**, multi-course, print preview, repeated headings, totals/averages | Single-course, student-level, no logo, no print preview                        | **Large**           |
| Weighted course-wide percentage (opportunity-based)                                                                     | UI averages _student_ percentages (spec §8 violation)                          | **Correctness bug** |
| Audit log of every attendance correction + export permissions                                                           | Corrections are **unlogged**; `audit.ts` is HMAC forensics, not an audit trail | Medium              |
| Role-based access beyond 3 flat roles (Dean/HOD/Exam officer, lecturer scoping)                                         | `admin` / `lecturer` / `student` only                                          | Medium              |

**Plan shape:** 6 phases (P0 → P5), ~8–10 engineering weeks for the full v2.0, with a **shippable acceptance-criteria MVP at ~3 weeks** (P0 + P1 + P2 + P3 = 14 engineering days, §10). Every artifact the brief demands (§10) maps to a numbered task and to a test, and every acceptance criterion (§11) has a traceability row in §11.

---

## 1. How to read this document

- **§2** is the verified inventory — what exists _today_, with file paths. Nothing here is assumed.
- **§3** is the spec-vs-code gap matrix, section by section, matching the brief's own numbering (§2 Sidebar, §3 Cards, … §11 Acceptance).
- **§4–§9** are the design decisions: data model, API, UI/UX, export engine, attendance math, security.
- **§10** is the phased execution plan (the thing to actually build, in order).
- **§11–§12** are the traceability tables for the brief's §11 acceptance criteria and §10 deliverables.
- **§13–§15** are effort, risks, and the decisions we need from the client before P1.

Status legend used throughout: ✅ shipped · 🔶 partial · 🧩 missing · ⚠️ wrong/risky.

---

## 2. Verified current state (what we are upgrading _from_)

### 2.1 Stack (unchanged by this plan)

| Layer            | Choice                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Frontend         | Vite + React 19 SPA, TanStack Router (file-based) + TanStack Query, Tailwind v4 + shadcn/ui (Radix) |
| Charts           | Recharts                                                                                            |
| QR               | `qrcode` (generate), `html5-qrcode` (scan)                                                          |
| Reports (client) | `jspdf` + `jspdf-autotable` + `xlsx` — **lazy-loaded**                                              |
| API              | Cloudflare Worker (TypeScript, zod validation, rate limits, CORS, security headers)                 |
| DB               | Cloudflare D1 (SQLite), additive migrations `0001`–`0006`                                           |
| Auth             | `jose` JWT + Web Crypto PBKDF2; `users.auth_version` revocation                                     |
| Hosting          | SPA on Vercel (`vercel.json`), API on Cloudflare Workers (`wrangler.toml`, cron trigger)            |

### 2.2 Database (D1) — as-is

`departments`, `users`, `courses`, `course_enrollments`, `sessions`, `attendance_records`, `schedules`, `site_settings`.

Notable columns already present that make the brief's math possible:
`attendance_records.status` (`present`/`late`/`excused`/`absent`), `sessions.started_at/ended_at/expires_at`, `sessions.code_interval_seconds`, `attendance_records.device_id/distance_meters/evidence/ip/ua/colo`, `courses.venue_lat/lng/radius`, `users.auth_version`.

**Absent:** `faculties`, `academic_sessions`, `semesters`, `offerings`/semester-scoped enrolment, `exams`/`results`, `notifications`, `audit_log`, `report_snapshots`.

### 2.3 API (Cloudflare Worker, `worker/src/index.ts` — 1,264 lines, 46 routes)

Shipped and used by the UI: `GET /api/health`, `POST /api/auth/{login,refresh,logout}`, `GET /api/auth/me`, settings (`/api/settings`, `/api/public/settings`), `GET|POST /api/users`, `PATCH|DELETE /api/users/:id`, `POST /api/users/change-password`, `PATCH /api/users/profile`, departments CRUD, `GET|POST|PATCH|DELETE /api/courses`, course lecturer/venue/enrollments, `GET /api/lecturer/courses`, unassigned + claim, `POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/end`, `GET /api/courses/:id/sessions`, `DELETE /api/attendance/:id`, `PATCH /api/attendance/:id/status`, schedules CRUD, `POST /api/attendance`, `/api/me/*` (courses, sessions, history, open-sessions), `GET /api/reports/course/:id`, `GET /api/reports/faculty`, `GET /api/admin/overview`.

Authorization today: `needAuth(req, base, roles?)` for coarse role checks + `requireCourseOwnership()` for lecturer scoping (`worker/src/index.ts:364–407`).

### 2.4 Frontend routes (as-is)

```
/                     marketing landing (929 lines)
/login
/admin                → Overview · Students · Lecturers · Departments · Courses · Reports · Branding · Settings
/admin/courses        card grid + create/edit dialog + enrolment picker
/admin/reports        one course dropdown + 3 summary cards + student table + PDF/Excel buttons
/admin/students|lecturers|departments|settings
/lecturer, /lecturer/courses, /lecturer/courses/$courseId   (real detail page: sessions, roster, schedule panel, exports)
/lecturer/sessions, /lecturer/sessions/$sessionId           (live sign-ins, forensics, status edits)
/student, /student/attend, /student/history, /student/courses/$courseId
/settings             profile + password
```

### 2.5 Known deficiencies this plan must fix (verified in code)

| #   | Issue                                                                                                                                                | Evidence                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A   | Course-wide average is the **mean of student percentages**, not opportunity-weighted                                                                 | `src/routes/admin.reports.tsx` — `students.reduce(...)/students.length`            |
| B   | `attendance_records` writes default to `status='present'`; **no record is created for absence**, so "Absent" only exists as `sessions − attended`    | `worker/src/db.ts`, `migrations/0005_lifecycle.sql`                                |
| C   | Attendance **corrections are not audited** (`PATCH /api/attendance/:id/status`, `DELETE /api/attendance/:id`)                                        | `worker/src/index.ts:860–896`; `worker/src/audit.ts` is HMAC forensic hashing only |
| D   | Exports are **student-level rows only**, no institution name/logo line beyond a text fallback, no totals/averages, no multi-course, no print preview | `src/lib/exporters.ts`                                                             |
| E   | Sidebar is flat with no group/collapsible support                                                                                                    | `src/components/AppShell.tsx` (`NavItem { to, label, icon }`)                      |
| F   | No period concept ⇒ every "vs last semester" style KPI is uncomputable                                                                               | no `semesters` table                                                               |
| G   | Seed data is 3 courses / 7 users — the brief's 11-course, multi-department demonstration has no fixture                                              | `worker/src/seed.ts`                                                               |

---

## 3. Requirement-by-requirement gap matrix

### 3.1 Brief §2 — Dashboard layout

**A. Left sidebar.** Required: Dashboard, Students, Lecturers/Staff, Departments, **Faculties**, **Courses (expandable: All Courses / Add Course / Course Categories)**, **Timetable**, **Attendance**, **Examinations**, **Results**, Reports, **Notifications**, Settings, Logout.

- ✅ Dashboard/Students/Lecturers/Departments/Courses/Reports/Settings exist as flat links.
- 🧩 Missing: Faculties, Timetable, Attendance (admin-wide register), Examinations, Results, Notifications, an explicit **Logout** row (logout is an icon in the sidebar footer today).
- 🔶 Courses must become an **expandable group** that (a) auto-expands when the route is under `/admin/courses*`, (b) highlights the parent _and_ the active child, (c) preserves expansion state in `localStorage`, (d) collapses to icon-rail on `lg`-down and becomes a slide-over drawer on mobile.
- Upgrade work: `NavItem` → `NavGroup | NavLink`, `Collapsible` from shadcn, keyboard-accessible disclosure (`aria-expanded`, `aria-controls`), active-route breadcrumb in `PageHeader`.

**B. Top navigation bar.** Required: logo + system name, search (courses/students/lecturers), notifications, admin profile menu, **institution name**, **academic session selector**, **semester selector**.

- ✅ Command palette exists (`src/components/CommandPalette.tsx`) and already serves as the "search everything" surface — it will be extended with server-side search (courses, students, lecturers) and wired to a visible top-bar search input (Ctrl/⌘-K affordance).
- ✅ Profile + theme toggle exist (footer + mobile bar); logo + name exist in the sidebar.
- 🧩 Missing: institution name in the header (comes from `site_settings.institution_name`), and the **session/semester selectors** (blocked by §4 schema).

**C. Main content area.** Required: opening Courses shows the _All Courses Attendance Management page_. Currently Courses opens a **card grid of CRUD tiles**. New `/admin/courses` = attendance management table; course CRUD moves to `/admin/courses/manage` (or a view toggle), with `Add Course` and `Course Categories` as their own child routes to satisfy the sidebar contract.

### 3.2 Brief §3 — Dashboard summary cards

Required: Total Courses · Total Students · Total Classes Held · Overall Attendance % · Students Present Today, **all computed from live records** and recomputed when attendance changes.

- 🔶 `GET /api/admin/overview` returns students/lecturers/courses/departments/sessions/attendance counts, `recentSessions` and `weeklyAttendance`.
- 🧩 Missing: classes held (sessions with `started_at` in window, `ended_at` not null or expired), **opportunity-weighted overall attendance %**, "present today" (needs institution timezone), and period deltas.
- ⚠️ Correctness: "Present Today" must be **timezone-anchored** (Africa/Lagos for this deployment) — plan adds `site_settings.timezone` and computes day boundaries server-side, never in the browser.

### 3.3 Brief §4 — All Courses attendance table

Required columns: `#`, Course Code, Course Title, Department, Total Registered Students, **Total Classes Held**, **Classes Attended**, Attendance %, Number Present, Number Absent, Number Late, Action/View Details. Plus scrolling/pagination, and (from §7) Excel + Print/PDF buttons **above** the table.

- 🧩 Entirely missing; replaced by the card grid. `GET /api/courses` returns courses + `enrolledStudentIds` only.
- New endpoint `GET /api/reports/courses` (§5.2) computes all 12 columns in **one SQL pass** (no N+1 over 11+ courses), supports server-side sort/paginate/search so a 400-course institution stays fast.
- UI: `DataTable` primitive (new shared component) — sticky header, column sort, row selection, page size, mobile card fallback, per-row `View Details`, and a footer totals row.

### 3.4 Brief §5 — Individual course selection

Required detail page: code/title, assigned lecturer, department, registered students, sessions held, present/absent/late per lecture, individual student attendance history, overall %, weekly trend, semester summary, **select a lecture date and view that session's records**.

- 🔶 A strong version of this exists **only for lecturers** (`/lecturer/courses/$courseId`) and partially for admins (`/admin/reports` student table). There is no admin course detail route.
- 🧩 Missing: admin route `/admin/courses/$courseId`, session-date drill-down for admins, per-session present/absent/late split, semester summary, trend chart per course.
- 🔶 `GET /api/reports/course/:id` returns `course`, `totalSessions`, `sessions[]`, `students[{attended, percentage, devices}]` — extend with `present/absent/late/excused`, per-session breakdown, trend series, and (new) `GET /api/reports/course/:id/sessions/:sessionId` for the date drill-down.

### 3.5 Brief §6 — Attendance filters

Required: academic session, semester, faculty, department, course, lecturer, date range, attendance status; "one course or all courses".

- 🧩 All eight. Today: a single `courseId` state in `/admin/reports`.
- Design: a shared, **URL-synced** `ReportFilterBar` (TanStack Router `validateSearch`), a `filters` object that is the _single_ input to both the table query and every export ("exports must use current filters" — enforced by passing the same serialized filter state into the export call and echoing it into the report header).
- Add: saved views (localStorage presets), "compare with previous period" toggle, filter chips with clear-all, empty-state that explains which filter excluded everything.

### 3.6 Brief §7 — Excel and PDF export _(flagged as a major requirement)_

Required: two clearly visible buttons above the table; Excel workbook of selected courses + stats; PDF containing institution name **and logo**, report title, session/semester, selected course(s), totals (registered students, classes held/attended, present/absent/late, %), **summary totals and averages**, generation date; **print preview** before printing, professional margins, **repeated table headings across pages**; export one course, several, all, a whole semester, or a date-specific report; exports honour current filters.

- 🔶 Today: single-course only, student rows only, `doc.save()` straight to download, no preview, no logo, no totals, no selection, no permission scoping.
- 🧩 New: an **export layer** (§7) with (1) a shared `ReportDataset` builder used by table _and_ exports, (2) an Excel workbook writer with Summary / Per-course / Per-session / Per-student / Metadata sheets, (3) a print-CSS report route (`/admin/reports/print`) that is the print-preview surface (`thead { display: table-header-group }` ⇒ headings repeat on every page, native page breaks, real logo, A4 landscape), (4) jsPDF fallback for a true `.pdf` download with `didDrawPage` headers/footers, page numbers and repeated head rows, (5) audit logging of every export.

### 3.7 Brief §8 — Attendance calculation rules

Required: per-student `attended ÷ expected × 100`; **course-wide % computed over total attendance opportunities across eligible students and sessions, never the average of course percentages**; distinguish Present / Absent / Late / approved Excused.

- ⚠️ Current UI violates the weighted rule (mean of student %). Server `facultyReport()` already weights correctly (`attended / (sessions × enrolled)`), so the fix is to centralise: **one SQL expression, one documented module** (`worker/src/stats.ts`) used by every endpoint and mirrored by a single client helper.
- Formula set to adopt (authoritative, see §8):
  - `student% = (present + late) ÷ expectedSessions × 100`, `expectedSessions` = sessions held while the student was enrolled and not excused-wholly.
  - `course% = Σ(present + late) ÷ Σ(expected opportunities) × 100` — opportunity-weighted, enrolment-size independent.
  - `department/faculty/institution% = Σ(present + late) ÷ Σ(expected opportunities)` rolled up over the same denominator.
  - `excused` is excluded from the denominator **only** with an explicit flag (default: excused counts as expected-and-not-attended unless `site_settings.excused_counts_as_absent` says otherwise) — a decision (§14 D3).
- Add **snapshot/freeze** (`report_snapshots`) so a closed semester's published figures cannot drift; plus `POST /api/admin/semesters/:id/finalize`.

### 3.8 Brief §9 — Security and permissions

Required: only authorized admins reach institution-wide reports; lecturers limited to their courses unless granted more; roles respected; records protected from unauthorized change; **all attendance corrections in an audit log**; exports respect permissions.

- ✅ Strong base: JWT + `auth_version` revocation, `needAuth(roles)`, `requireCourseOwnership`, rate limits, security headers, HMAC attestation.
- 🧩 Missing: (1) granular permission model (scoped roles), (2) **audit log** for corrections/edits/exports, (3) immutable-record enforcement policy (records are editable by owning lecturer permanently today), (4) export authorization scoping server-side.
- Plan: `permissions` matrix + `audit_log` append-only table + `requireScope()` helper + a reason-required correction flow + review UI (`/admin/audit`).

### 3.9 Brief §10 — Deliverables

See §12. Every deliverable is a task in §10 of this plan with a definition of done and a test.

### 3.10 Brief §11 — Acceptance criteria

See §11 traceability table.

---

## 4. Target data model

All migrations remain **additive and non-destructive** (repo convention: `migrations/000N_*.sql`, applied with `wrangler d1 migrations apply`). New files: `0007_academics.sql`, `0008_audit.sql`, `0009_exams_results.sql`, `0010_notifications.sql`, `0011_scopes.sql`, `0012_snapshots.sql`.

### 4.1 Institution hierarchy

```
institutions (implicit: one tenant today — site_settings)
  └── faculties        (new)
        └── departments  (exists → gains faculty_id)
              └── programmes/levels (existing free-text `level`; keep, optionally normalise later)
```

```sql
-- 0007_academics.sql
CREATE TABLE faculties (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL,
  dean_user_id TEXT, icon TEXT, color TEXT, created_at INTEGER NOT NULL
);
ALTER TABLE departments ADD COLUMN faculty_id TEXT;
ALTER TABLE departments ADD COLUMN hod_user_id TEXT;

-- Academic periods
CREATE TABLE academic_sessions (            -- "2024/2025"
  id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
  starts_on INTEGER, ends_on INTEGER,
  is_current INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE semesters (                    -- "First Semester 2025"
  id TEXT PRIMARY KEY, academic_session_id TEXT NOT NULL,
  name TEXT NOT NULL,                          -- "First Semester"
  sequence INTEGER NOT NULL DEFAULT 1,         -- 1 = first, 2 = second
  starts_on INTEGER, ends_on INTEGER,
  is_current INTEGER NOT NULL DEFAULT 0,
  finalized_at INTEGER,                        -- frozen: no new sessions/corrections
  created_at INTEGER NOT NULL
);
```

**Institution-wide period setting:** `site_settings.current_academic_session_id`, `current_semester_id`, `timezone` (default `Africa/Lagos`), `logo_url`, `report_footer_note`, `excused_counts_as_absent`.

### 4.2 Course catalogue vs. offering (the structural decision)

Today one `courses` row == one catalogue entry == one lecturer == one roster, forever. A real institution needs _CSC 203 (catalogue)_ vs _CSC 203, First Semester 2025, Dr. Yusuf, 428 students_. The plan therefore separates them **with a compatibility layer** so nothing else breaks in one step:

```sql
CREATE TABLE course_offerings (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL, semester_id TEXT NOT NULL,
  lecturer_id TEXT, level TEXT, units INTEGER,
  seats INTEGER, venue_lat REAL, venue_lng REAL, venue_radius INTEGER,
  status TEXT NOT NULL DEFAULT 'active',   -- active | finalized | archived
  created_at INTEGER NOT NULL
);
ALTER TABLE course_enrollments ADD COLUMN offering_id TEXT;   -- NULL = legacy/offering-less
ALTER TABLE sessions            ADD COLUMN offering_id TEXT;
ALTER TABLE sessions            ADD COLUMN semester_id TEXT;  -- denormalised for fast filters
ALTER TABLE attendance_records  ADD COLUMN offering_id TEXT;
CREATE INDEX idx_offerings_semester ON course_offerings(semester_id);
CREATE INDEX idx_offerings_course   ON course_offerings(course_id);
CREATE INDEX idx_enroll_offering    ON course_enrollments(offering_id);
CREATE INDEX idx_sessions_semester  ON sessions(semester_id);
```

**Compatibility rule (must be honoured by every query in `worker/src/db.ts`):**

> Effective lecturer/roster/semester for a course = _offering_ value when `offering_id` is present, else the legacy `courses.lecturer_id` / `course_enrollments(course_id)` / unassigned-semester value.

This means: existing rows and existing endpoints keep working, the migration backfill creates one offering per existing course inside a seeded "Current Semester", and every new endpoint reads the offering path first.

_(Lighter alternative if the client wants the fastest possible route: skip `course_offerings`, add `courses.semester_id` + `sessions.semester_id` only. Cheaper by ~4 days, but re-offering a course in a new semester then requires cloning course rows, which duplicates codes and breaks cross-semester comparisons. **Recommendation: do the offering split.**)_

### 4.3 Attendance integrity

```sql
-- Materialise absence (fixes deficiency B): one row per (session, expected student)
-- written when a session closes, status='absent' unless a record already exists.
-- attendance_records.status then becomes the single source of truth for all counters.
ALTER TABLE attendance_records ADD COLUMN source TEXT NOT NULL DEFAULT 'scan'; -- scan | manual | import | auto_absent
ALTER TABLE attendance_records ADD COLUMN marked_by TEXT;                      -- user id for manual edits
ALTER TABLE attendance_records ADD COLUMN reason TEXT;                         -- required for manual correction
ALTER TABLE attendance_records ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;   -- frozen by finalization
ALTER TABLE attendance_records ADD COLUMN created_at INTEGER;
ALTER TABLE attendance_records ADD COLUMN updated_at INTEGER;
```

Rules:

- Closing a session (manual end, auto-close, cron) enqueues `materializeAbsences(sessionId)`: insert `absent` rows for every enrolled-but-unrecorded student, idempotently (`INSERT OR IGNORE` on the existing unique `(session_id, student_id)` index — already in migration `0003`). This makes Present+Absent+Late+Excused always equal the roster size, so every counter in New §4 is a plain `SUM`, not a subtraction.
- Corrections (`PATCH /api/attendance/:id/status`) now require `reason` and write an audit row before/after; `DELETE` becomes a soft _void_ (`status='excused'` or a `voided` flag) once a period is finalized.
- `report_snapshots` stores frozen period aggregates (JSON + totals) so published semester reports are reproducible.

### 4.4 Examinations & results (brief §2 sidebar entries)

```sql
CREATE TABLE exams (
  id TEXT PRIMARY KEY, offering_id TEXT NOT NULL, title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'exam',        -- ca | test | exam | practical
  weight REAL, max_score REAL NOT NULL DEFAULT 100,
  scheduled_at INTEGER, duration_minutes INTEGER, venue TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE results (
  id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, student_id TEXT NOT NULL,
  score REAL, grade TEXT, entered_by TEXT, updated_at INTEGER,
  UNIQUE(exam_id, student_id)
);
```

Results are **out of the acceptance criteria but in the brief's navigation**. Plan: schema now (P4), UI in P4 (enter/import scores, lecturer-scoped, exam officer role), and — the product payoff — `results` joined with attendance % on one page ("attendance vs. performance" scatter), plus an optional policy engine ("below 75% attendance ⇒ barred from exam", already partially expressed by `site_settings.at_risk_threshold`).

### 4.5 Notifications (brief §2)

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, user_id TEXT, role TEXT, audience TEXT NOT NULL DEFAULT 'user',
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  entity_type TEXT, entity_id TEXT, href TEXT,
  read_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at DESC);
```

Generated by existing events (session started for enrolled students, attendance status corrected for the student, at-risk threshold crossed for admin/HOD, export finished, exam scheduled) via a single `notify()` helper. UI: top-bar bell + dropdown, `/admin/notifications`, unread badge via a lightweight poll (or Durable-Object-free SSE later; polling is fine at this scale).

### 4.6 Audit log (brief §9)

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT, actor_role TEXT, actor_email TEXT,
  action TEXT NOT NULL,          -- attendance.update | attendance.void | course.delete | export.generate | semester.finalize | login.failed | ...
  entity_type TEXT NOT NULL, entity_id TEXT,
  course_id TEXT, offering_id TEXT, semester_id TEXT,
  before_json TEXT, after_json TEXT, reason TEXT,
  ip_pointer TEXT, ua_pointer TEXT, req_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_entity  ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor   ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
```

Append-only at the API layer (no UPDATE/DELETE route exists), IP/UA stored through the existing HMAC pointer helper in `worker/src/audit.ts` (privacy-preserving and consistent with the sign-in forensics design). Retention: 24 months with a documented purge job.

### 4.7 Scopes / permissions (brief §9)

```sql
ALTER TABLE users ADD COLUMN scope_faculty_id TEXT;
ALTER TABLE users ADD COLUMN scope_department_id TEXT;
ALTER TABLE users ADD COLUMN permissions TEXT;   -- JSON array of extra grants, e.g. ["reports:all"]
CREATE TABLE role_permissions (role TEXT, permission TEXT, PRIMARY KEY(role, permission));
```

Roles: `super_admin`, `admin`, `exam_officer`, `dean`, `hod`, `lecturer`, `student` — see §9 for the matrix. `needAuth` gains `requirePermission(ctx, "reports:export")` style checks; data-scope resolution is one helper (`resolveScope(user) → { faculties[], departments[], offeringIds[] | "all" }`) that **every** report/export/table query applies — this is what makes "exports respect the user's access permissions" true by construction rather than by review.

---

## 5. API plan

### 5.1 Changed endpoints

| Endpoint                           | Change                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/overview`          | Rebuilt for the brief §3 cards: `{ totals: { courses, students, lecturers, classesHeld, attendanceRate, presentToday, lateToday, absentToday }, deltas: { studentsVsPrevSemester, attendanceVsPrevWeek, … }, trend: [{week, rate, present}], departments: [{name, code, rate}] }`, all period-aware and opportunity-weighted |
| `GET /api/reports/course/:id`      | Add `present/absent/late/excused`, `offering`, per-session aggregates, weekly trend, semester summary, `weightedRate`                                                                                                                                                                                                        |
| `GET /api/reports/faculty`         | Rename semantics to institution/department report with the same weighted math; keep the old shape under `?legacy=1` for one release                                                                                                                                                                                          |
| `PATCH /api/attendance/:id/status` | Requires `reason`; writes `audit_log`; rejects when the semester is finalized (unless `permissions` includes `attendance:override`)                                                                                                                                                                                          |
| `DELETE /api/attendance/:id`       | Soft-void + audit (`attendance.void`); hard delete only for super_admin before finalization                                                                                                                                                                                                                                  |
| `GET /api/courses`                 | Add `?semesterId=&departmentId=&facultyId=&lecturerId=&q=` and return offering-aware `lecturerId`, `enrolledCount`                                                                                                                                                                                                           |
| `POST /api/sessions`               | Resolve/attach `offering_id` + `semester_id`; reject when the semester is finalized                                                                                                                                                                                                                                          |

### 5.2 New endpoints

```
Academics
  GET    /api/faculties                      POST   /api/faculties
  PATCH  /api/faculties/:id                  DELETE /api/faculties/:id
  GET    /api/academic-sessions              POST   /api/academic-sessions
  PATCH  /api/academic-sessions/:id
  GET    /api/semesters?academicSessionId=   POST   /api/semesters
  PATCH  /api/semesters/:id                  POST   /api/semesters/:id/finalize
  GET    /api/offerings?semesterId=          POST   /api/offerings
  PATCH  /api/offerings/:id                  PATCH  /api/offerings/:id/lecturer
  PATCH  /api/offerings/:id/enrollments

Reporting (the brief's core)
  GET    /api/reports/courses                ← All-Courses table: 12 columns, filters, sort, page, search
  GET    /api/reports/courses/:id/sessions   ← per-lecture rows (date, held, present, absent, late, rate)
  GET    /api/reports/session/:sessionId     ← date-specific attendance report (brief §7)
  GET    /api/reports/institution            ← faculty/dept roll-up with weighted rates + distribution
  GET    /api/reports/trends?weeks=6         ← weekly trend for the dashboard chart
  GET    /api/reports/export                 ← server-side export payload for large selections
                                               (returns ReportDataset JSON; same filters as the table)
  POST   /api/reports/exports                ← logs the export in audit_log (action, filters, row count)

Examinations & results
  GET|POST|PATCH|DELETE /api/exams[/:id]     GET|POST|PATCH /api/results

Notifications
  GET    /api/notifications                  POST   /api/notifications/:id/read
  POST   /api/notifications/read-all

Audit & ops
  GET    /api/audit?action=&actorId=&from=&to=&page=
  GET    /api/admin/health                   ← counts + last migration + data-quality checks
```

### 5.3 Contract discipline

- Types live in `worker/src/types.ts` and are mirrored in `src/lib/types.ts` (existing convention — keep the pairing and add a unit test that asserts the client's report shapes parse a fixture produced by the worker).
- All new query params validated with zod (`bodyOf` equivalent for query strings — new `queryOf()` helper to avoid sprinkling `Number(...)`/`??` logic in handlers).
- Every list endpoint: `{ items, total, page, pageSize }` envelope so the table can paginate server-side.
- Every report endpoint returns a `meta` block (`filters`, `generatedAt`, `calculation: "opportunity-weighted"`, `period`) so the export header and the audit row are derived from the payload, not from UI state.

---

## 6. Frontend / UX upgrade plan

### 6.1 Upgrade the reference design, don't copy it

The supplied mock (`docs/reference/admin-dashboard-v1-reference.jpeg`) is the layout contract. We implement it faithfully and then fix what the mock gets wrong:

| Mock                                                                           | Our version                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "vs last semester / vs last week" chips with no data source                    | Real period deltas from `report_snapshots` + prior-window queries; hidden when no comparison period exists (never fake a trend)                                                                         |
| Donut + trend + dept donut + top courses + activity feed stacked → long scroll | Same information in a **command-deck layout**: 5 KPI cards, 2-up charts row, "needs attention" panel (at-risk courses/students) beside the trend, activity feed from the real audit/notification stream |
| Quick Actions as 4 static buttons                                              | Command palette (⌘K) + contextual quick actions that respect role/permissions                                                                                                                           |
| Bottom "SLAMS" brand card (marketing banner inside an admin tool)              | Replaced by the institution's own logo/branding (uploadable, stored in `site_settings.logo_url`) and a report-preview card                                                                              |
| Table with no sort/filter/pagination                                           | Sticky-header `DataTable` with sort, multi-select, search, page size, column visibility, CSV/Excel/PDF above, totals row                                                                                |
| Static percentages                                                             | Every number traceable: click a KPI → filtered view showing the underlying sessions/records; a `?` tooltip states the exact formula and denominator                                                     |
| Colour-only status semantics                                                   | Status = colour **+ icon + label** (WCAG AA); late/absent never distinguished by hue alone                                                                                                              |
| No dark mode, no mobile story                                                  | Existing dark theme kept; every new view designed mobile-first, table degrades to cards                                                                                                                 |
| No print story                                                                 | Dedicated print stylesheet + preview route (§7)                                                                                                                                                         |

### 6.2 New/updated components (`src/components/`)

```
app-shell/NavRail.tsx        collapsible groups, icon rail, mobile drawer, active-section highlight
app-shell/TopBar.tsx         logo · global search (⌘K) · period selectors · notifications bell · profile menu
PeriodSelector.tsx           academic session + semester, writes to settings (admin) or local view scope
FilterBar.tsx                the 8 filters, URL-synced, chips, saved views, "clear all", result count
DataTable.tsx                sortable/paginated/selectable/sticky-header table with empty+loading+error states
MetricCard.tsx               KPI + sparkline + delta chip + formula tooltip (extends StatCard)
AttendanceDonut.tsx          present/late/excused/absent donut with centre rate (Recharts)
TrendChart.tsx               weekly attendance-rate area/line with target band
DepartmentBreakdown.tsx      faculty/department roll-up bars with weighted rates
TopCoursesList.tsx           ranked list with rate bars, links to course detail
ActivityFeed.tsx             audit/notification stream (icons, actor, relative time)
AttentionPanel.tsx           at-risk courses + students below threshold, with one-click "notify lecturer"
ExportPanel.tsx              format, scope, filters summary, page-orientation, "Preview / Print"
PrintReport.tsx              the printable report document (used by /admin/reports/print)
SessionDrilldownDrawer.tsx   per-date attendance (present/absent/late lists, corrections w/ reason)
AuditLogTable.tsx            filterable, read-only, export-restricted
NotificationBell.tsx         unread badge + dropdown
```

### 6.3 New routes

```
/admin/courses                     All Courses attendance management (the brief's §4 table)
/admin/courses/new                 Add Course            (sidebar child)
/admin/courses/categories          Course Categories     (derived from course.category + CRUD)
/admin/courses/$courseId           Individual course detail (brief §5): tabs Overview · Sessions · Students · Trends · Reports
/admin/faculties                   Faculties CRUD + roll-up stats
/admin/timetable                   weekly grid from `schedules` (existing table!) + conflict detection
/admin/attendance                  institution register: session list, per-session detail, corrections
/admin/examinations                exams CRUD, scheduling, per-offering weightings
/admin/results                     score entry + attendance-vs-performance view
/admin/notifications               inbox
/admin/audit                       audit log (super_admin/admin)
/admin/reports/print               print preview surface (HTML → window.print())
/admin/reports/export              export builder (multi-course selection, workbook options)
/lecturer/courses/$courseId        unchanged + new session drill-down and weighted stats
```

`src/routeTree.gen.ts` regenerates on build (TanStack Router plugin) — no manual edits.

### 6.4 Motion, accessibility, performance

- Reuse the existing motion system (`Reveal`, `RouteTransition`, keyframes, `prefers-reduced-motion` block). New charts animate once, on mount, and are disabled under reduced motion.
- A11y targets: WCAG 2.2 AA — table `<caption>`/`scope`, sortable headers with `aria-sort`, dialogs with focus return, filter bar keyboard-navigable, donut/trend have text summaries and `aria-label`s, per-route `head()` meta, focus-visible rings everywhere.
- Performance: dashboard ≤ 1 API round-trip for KPIs (composed server-side), courses table server-paginated, exports lazy-import `xlsx`/`jspdf` (already done — keep it), charts `React.lazy` per route, 11-course table renders instantly, 500-course institution behind pagination.
- Empty/error/offline states for every new panel (repo already has `EmptyState`, `Loaders` — unify).

---

## 7. Export & reporting engine

**Core principle:** the printed/exported report must be _the same dataset the admin sees_, computed by the server, with the same filters. One builder, three renderers.

```
server: GET /api/reports/courses?<filters> → ReportDataset { meta, totals, courses[], sessions[], students[] }
                                    │
        ┌───────────────────────────┼────────────────────────────┐
        ▼                           ▼                            ▼
   DataTable (screen)        Excel workbook (xlsx)         Report document (HTML)
                                                             ├─ /admin/reports/print  → window.print()  [print preview, PDF via browser]
                                                             └─ jsPDF + autoTable     → .pdf download
```

### 7.1 Excel workbook spec (`.xlsx`)

| Sheet                      | Contents                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Report Info`              | Institution, report title, academic session, semester, faculty/department/course scope, applied filters (human-readable), generated at/by, formula note ("opportunity-weighted") |
| `Summary`                  | One row per scope: registered students, classes held, classes attended, present, absent, late, excused, attendance %, target, variance; **totals row + weighted average**        |
| `Courses`                  | The brief's §4 12 columns, one row per course, totals row                                                                                                                        |
| `Sessions`                 | Per course per date: date, start, end, venue, topic, held?, present, absent, late, excused, rate                                                                                 |
| `Students`                 | Per student per course: name, matric, level, dept, expected sessions, present, late, excused, absent, %, at-risk flag                                                            |
| `Raw Records` _(optional)_ | Sign-in-level rows with device/IP-pointer/distance classes for audit exports (permission-gated)                                                                                  |

Implementation notes: `xlsx` `utils.aoa_to_sheet` for header styling, frozen panes (`!freeze`), column widths, number formats (`0.0%`), autofilter on the header row, worksheet names ≤ 31 chars, workbook generated client-side (no server file storage needed) with a guard for >50k rows that switches to a server-side payload streamed in pages.

### 7.2 PDF & print spec

- **Print preview first** (brief §7 requirement): `/admin/reports/print?<filters>` renders `PrintReport` inside the app chrome with a `Print` button; `@media print` hides nav/filters and emits a clean A4 (landscape for wide tables) document.
- Repeated headings: `thead { display: table-header-group }` + `tr { break-inside: avoid }`; jsPDF's `autoTable` repeats `head` per page automatically, with `didDrawPage` drawing the running header (institution + logo + report title) and footer (page x of y, generated date), and a final totals row (`foot`).
- Contents: institution name + logo, report title, academic session + semester, scope (all courses / selected / one / date-specific), registered students, classes held, classes attended, present, absent, late, excused, attendance %, **summary totals and weighted average**, at-risk count, generation date/time and the generating user.
- Tailwind v4 note: print styles live in `src/styles.css` (`@media print` block) plus a `print:` utility pass; a dedicated `print.css` is avoided to keep one stylesheet pipeline.
- Filenames: `SLAMS_Attendance_<Scope>_<Session>_<Semester>_<YYYY-MM-DD>.{xlsx,pdf}`.
- Every export writes an `audit_log` row (`export.generate`) with filters, scope, row count and format (brief §9: "exported reports must respect the user's access permissions" — the server filters the dataset by `resolveScope(user)` before it ever reaches the renderer).

### 7.3 Export scopes to support (brief §7 checklist)

One course · several selected courses (checkbox selection + "select all matching filter") · all courses · whole-semester report · date-specific report (single day or date range, session-level rows). Each is a preset over the same filter object — no separate code paths.

---

## 8. Attendance mathematics (single source of truth)

New worker module `worker/src/stats.ts`, mirrored by `src/lib/attendance-math.ts` for optimistic display:

```
expected(session, student)   = 1 when the student was enrolled on that date and the session was held
attended(record)             = status ∈ {present, late}
student%                     = Σ attended ÷ Σ expected × 100
course% / dept% / faculty%   = Σ attended ÷ Σ expected × 100      (opportunity-weighted, NOT mean of student %)
classRate(session)           = attended ÷ expected(roster, that session) × 100
```

Guard rules:

- Rounding: compute at full precision, round once at the edge (1 decimal for reports, integer in the table), and **never re-aggregate rounded values**.
- Zero denominators render as `—`, never `0%`.
- Excluded/inactive students (unenrolled mid-semester, withdrawn) do not contribute to the denominator after their enrolment end date.
- `late` counts as attended; policy flag `site_settings.late_counts_as_attended` (default true) exists so an institution can change it without a code change.
- Comparisons (weekly trend, vs previous semester) use the same formula over the same-length window so the delta is meaningful.
- Regression tests with a golden fixture: enrolment 428/386/… does **not** change the course rate when a student is added and immediately attends everything; changing the denominator changes it exactly as the formula says.

---

## 9. Security, roles & audit

### 9.1 Role / permission matrix

| Capability                                | super_admin | admin | exam_officer | dean (faculty) | hod (dept) |    lecturer (own course)     | student (self) |
| ----------------------------------------- | :---------: | :---: | :----------: | :------------: | :--------: | :--------------------------: | :------------: |
| Institution overview & all reports        |     ✅      |  ✅   |  ✅ (read)   |   ✅ scoped    | ✅ scoped  |              ❌              |       ❌       |
| All Courses table (all courses)           |     ✅      |  ✅   |      ✅      |   ✅ scoped    | ✅ scoped  |           own only           |       ❌       |
| Export (Excel/PDF)                        |     ✅      |  ✅   |  ✅ scoped   |   ✅ scoped    | ✅ scoped  |          own course          |       ❌       |
| Create/edit courses, offerings, enrolment |     ✅      |  ✅   |      ❌      |       ❌       |     ❌     |              ❌              |       ❌       |
| Start/end sessions, take attendance       |     ✅      |  ✅   |      ❌      |       ❌       |     ❌     |          own course          |  code sign-in  |
| Correct attendance records                |     ✅      |  ✅   |      ❌      |       ❌       | ✅ scoped  | own course (reason required) |       ❌       |
| Finalize/freeze a semester                |     ✅      |  ✅   |      ❌      |       ❌       |     ❌     |              ❌              |       ❌       |
| View audit log                            |     ✅      |  ✅   |      ❌      |     scoped     |   scoped   |         own actions          |       ❌       |
| Enter results                             |     ✅      |  ✅   |      ✅      |       ❌       | ✅ scoped  |          own course          |       ❌       |
| Manage admin users / permissions          |     ✅      |  ❌   |      ❌      |       ❌       |     ❌     |              ❌              |       ❌       |

Implementation: `role_permissions` seed + `permissions` JSON grants on `users`; `resolveScope(user)` applied inside the repo layer of every report/export query; defence in depth (endpoint check **and** query scoping) so a UI bug can't leak another department's data.

### 9.2 Hardening tasks carried from `GAP-ANALYSIS.md` that this plan absorbs

- Password reset flow (needs an email provider — decision §14 D6).
- Multiple admins + admin management.
- `Cache-Control: no-store` on report endpoints (avoid stale cross-user caches).
- Rate limits on the new export endpoints (heavy + data-exfil surface).
- Backup/restore runbook (D1 Time Travel) documented in `DEPLOY.md`.

---

## 10. Phased execution plan

Each task lists: **what**, **files**, **definition of done**. Estimates are engineering days for one senior full-stack engineer.

### P0 — Foundations & correctness (2 days) ✅ _unblocks everything_

| #    | Task                                                                                                                                                 | Files                                                                                                   | DoD                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P0.1 | `stats.ts` + client mirror; replace the mean-of-percentages bug everywhere                                                                           | `worker/src/stats.ts`, `worker/src/db.ts`, `src/lib/attendance-math.ts`, `src/routes/admin.reports.tsx` | Unit tests (golden fixtures) prove opportunity-weighted math; admin report shows the weighted figure; `worker/tests/stats.test.ts` green |
| P0.2 | Materialise absences on session close (fixes B)                                                                                                      | `worker/src/db.ts`, `migrations/0007_academics.sql`, cron tick                                          | After a session closes, `present+late+absent+excused == roster`; idempotent under re-run; tests in `worker/tests/lifecycle.test.ts`      |
| P0.3 | `audit_log` table + `audit()` helper + wire corrections & deletions                                                                                  | `migrations/0008_audit.sql`, `worker/src/index.ts`, `worker/src/audit.ts`                               | `PATCH`/`DELETE /api/attendance/:id` require a reason and append audit rows; test asserts before/after JSON                              |
| P0.4 | Institution timezone + day boundaries in `site_settings`; "Present Today" semantics                                                                  | `migrations`, `worker/src/db.ts`, settings UI                                                           | Card counts match a hand-computed fixture regardless of server TZ                                                                        |
| P0.5 | Seed v2: faculties, academic session + 2 semesters, 11 courses matching the brief's table, rosters to match, 16 weeks × sessions, realistic statuses | `worker/src/seed.ts`                                                                                    | Fresh local D1 + `npm run db:migrate:local` reproduces a dashboard that looks like the mock with **honest** numbers                      |

### P1 — Period model & the All-Courses core (4 days)

| #    | Task                                                                                                                                                                         | DoD                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| P1.1 | `faculties`, `academic_sessions`, `semesters`, `course_offerings` tables + backfill migration + compatibility resolution helper                                              | Migration applies to fresh **and** existing D1; all existing tests pass unchanged   |
| P1.2 | Offerings API (CRUD, lecturer assign, enrolments, semester windows)                                                                                                          | CRUD round-trip tests; lecturer scoping preserved                                   |
| P1.3 | `GET /api/reports/courses` (12 columns, filters, sort, page, search)                                                                                                         | Query plan reviewed (no N+1); 500-course synthetic dataset responds <200 ms locally |
| P1.4 | Sidebar rework: collapsible Courses group + all brief §2 items (Faculties, Timetable, Attendance, Examinations, Results, Notifications, Logout) with placeholder-safe routes | Courses group auto-expands and highlights; keyboard + mobile behaviour verified     |
| P1.5 | Top bar: institution name, global search → palette, period selectors                                                                                                         | Changing semester re-scopes every page; selection persists per user                 |
| P1.6 | `/admin/courses` rebuilt as the attendance table (sticky header, sort, select, pagination, totals row, mobile cards)                                                         | Matches brief §4 columns exactly; acceptance criterion §11.2 passes                 |

### P2 — Dashboard & course detail (4 days)

| #    | Task                                                                                                               | DoD                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| P2.1 | `GET /api/admin/overview` v2 (5 cards, deltas, trend, department breakdown, top courses, attention list)           | Every number traceable; deltas absent when no comparison period (no fake trends) |
| P2.2 | Dashboard UI: MetricCards, donut, trend, dept breakdown, top courses, attention panel, activity feed, export panel | Layout matches the reference mock's information architecture; responsive + AA    |
| P2.3 | `/admin/courses/$courseId` detail page with tabs Overview · Sessions · Students · Trends                           | Brief §5 list fully covered, including lecturer/department/roster/session counts |
| P2.4 | Session drill-down: pick a date → present/absent/late list, corrections with reason + audit                        | Brief §5 "select a particular lecture date"                                      |
| P2.5 | `FilterBar` (8 filters, URL-synced, saved views, chips) shared by table/detail/reports                             | Deep links reproduce state; filters feed exports unchanged                       |

### P3 — Exports, print & reporting (4 days) — _the brief's major requirement_

| #    | Task                                                                                                                          | DoD                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P3.1 | `ReportDataset` builder + `GET /api/reports/export` (server-filtered, permission-scoped)                                      | Same filters ⇒ identical numbers on screen, in Excel and in PDF (asserted by test)                       |
| P3.2 | Excel workbook writer (6 sheets, totals/averages, frozen panes, autofilter, formats)                                          | `xlsx` opens in Excel/LibreOffice/Sheets without repair warnings; tests parse the produced blob          |
| P3.3 | `/admin/reports/print` preview + `@media print` stylesheet (logo, title, period, totals, page numbers, repeated headings, A4) | Browser print preview shows repeated table headings across pages and no clipped columns                  |
| P3.4 | jsPDF `.pdf` export (running header/footer, repeated head rows, totals row, page x/y)                                         | Multi-page fixture renders correctly for 11 courses × 16 sessions × 428 students (paginated export path) |
| P3.5 | Export scopes: one / several / all / whole-semester / date-specific; export audit logging                                     | Brief §7 checklist verified item by item                                                                 |
| P3.6 | ExportPanel UI above the table (brief: "two clearly visible buttons"), selection-aware labels                                 | Acceptance criterion §11.6                                                                               |

### P4 — Sidebar depth: timetable, exams, results, notifications (5 days)

| #    | Task                                                                                             | DoD                                                  |
| ---- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| P4.1 | `/admin/timetable` — weekly grid from existing `schedules`, clash detection, publish to students | Clash detection test (same offering/venue/time)      |
| P4.2 | `/admin/attendance` — institution register with per-session detail and corrections               | Permission-scoped; audit rows written                |
| P4.3 | `exams` + `results` schema, CRUD, score entry, bulk import                                       | Entering results is lecturer-scoped; HOD scoped read |
| P4.4 | Results × attendance analytics (barred-from-exam policy, scatter/quadrant view)                  | Policy evaluation documented and testable            |
| P4.5 | Notifications: `notify()` helper, bell + inbox + read state, event wiring                        | No N+1 notification reads; unread badge accurate     |

### P5 — Enterprise hardening (4–6 days, optional but recommended)

| #    | Task                                                                                        | DoD                                                                                           |
| ---- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| P5.1 | Password reset flow (needs email provider)                                                  | Reset code expiry + single-use + audit                                                        |
| P5.2 | Multiple admins + permission editor UI (`/admin/access`)                                    | Audit-logged permission changes                                                               |
| P5.3 | Semester finalization + `report_snapshots` (published figures frozen)                       | Finalized semester rejects new sessions/corrections; snapshot reproduces the published report |
| P5.4 | CSV/Excel **import** (students, lecturers, enrolments, results) with preview→validate→apply | Duplicate/invalid rows reported, nothing partially applied                                    |
| P5.5 | Playwright E2E: the three role journeys + the export journey                                | Runs headless in CI                                                                           |
| P5.6 | Observability (Sentry sink), backup runbook, `DEPLOY.md` v2, `docs/ADMIN-GUIDE.md`          | Documented restore drill                                                                      |

### MVP cut (satisfies every acceptance criterion in brief §11)

**P0 + P1 + P2 + P3 = ~14 engineering days.** P4/P5 are additive value (the brief's remaining sidebar items, enterprise ops) and can follow.

---

## 11. Acceptance-criteria traceability (brief §11)

| Brief §11 criterion                                             | Satisfied by     | Test / evidence                                                                |
| --------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------ |
| Admin clicks Courses → All Courses opens, menu highlighted      | P1.4, P1.6       | E2E: nav click → URL `/admin/courses`, parent+child highlighted                |
| All 11 courses appear with relevant attendance statistics       | P1.3, P1.6       | Fixture dataset with the brief's 11 courses; API test asserts 12 columns       |
| Selecting a course opens its detailed attendance records        | P2.3, P2.4       | E2E: row → detail → date drill-down                                            |
| Changing the semester/other filters updates displayed data      | P1.5, P2.5       | API test: semester A vs B produce different, correct aggregates                |
| Excel downloads as a valid, usable spreadsheet                  | P3.1, P3.2       | Test parses the generated workbook; manual open in Excel/LibreOffice           |
| PDF exports and print previews produce readable reports         | P3.3, P3.4       | Print-CSS snapshot + multi-page PDF fixture with repeated headings             |
| Dashboard figures match underlying attendance records           | P0.1, P0.2, P2.1 | Golden-fixture reconciliation test (cards ↔ SQL ↔ exported totals)             |
| Unauthorized users cannot access restricted course/student info | P1.2, P5.2, §9   | Handler tests for lecturer/student/HOD scoping on every report/export endpoint |

---

## 12. Deliverables checklist (brief §10)

| Brief §10 deliverable                               | Task(s)                                                              | Status after MVP           |
| --------------------------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| 1. Responsive administrative dashboard              | P2.2                                                                 | ✅                         |
| 2. Expandable Courses sidebar                       | P1.4                                                                 | ✅                         |
| 3. All Courses page                                 | P1.6                                                                 | ✅                         |
| 4. Individual course attendance details page        | P2.3, P2.4                                                           | ✅                         |
| 5. Attendance filters and search                    | P2.5                                                                 | ✅                         |
| 6. Working Excel export                             | P3.2                                                                 | ✅                         |
| 7. Working PDF export and print preview             | P3.3, P3.4                                                           | ✅                         |
| 8. Database integration + automatic statistics      | P0.1, P0.2, P1.1–P1.3                                                | ✅                         |
| 9. Authentication + role-based access control       | §9, P1.2, P5.2                                                       | ✅ (granular roles: P4/P5) |
| 10. Testing documentation + deployment instructions | P5.5, P5.6, updates to `README.md`/`DEPLOY.md`/`docs/ADMIN-GUIDE.md` | ✅                         |

---

## 13. Effort, sequencing & dependencies

```
P0 (2d)  ──► P1 (4d) ──► P2 (4d) ──► P3 (4d) ──► P4 (5d) ──► P5 (4–6d)
   │            │            │            │
   │            │            │            └── export dataset depends on weighted stats (P0.1) + filters (P2.5)
   │            │            └── course detail depends on offerings (P1.1/P1.2) + table query (P1.3)
   │            └── All-Courses table depends on stats (P0.1) + absences materialised (P0.2) + periods (P1.1)
   └── correctness first: every later number inherits it
```

- **Critical path:** `stats.ts` → `semesters/offerings` → `GET /api/reports/courses` → `FilterBar` → `ReportDataset` → exports. Nothing visual should start before P0.1/P0.2 (otherwise we polish wrong numbers).
- **Parallelisable:** sidebar/top-bar rework (P1.4/P1.5) and the design-system components (P2.2 pieces) can run beside the API work.
- **Full v2.0 (P0–P5):** ~8–10 engineering weeks single-track, ~4–5 weeks with a two-developer split (frontend/UI vs. data/API).
- Keep `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` green at every phase boundary (repo CI already enforces this in `.github/workflows/ci.yml`).

---

## 14. Decisions needed from the client (blocking P1)

| #   | Decision                                                                                                                    | Why it blocks                                                     | Default if unanswered                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| D1  | **Terminology & period structure** — semesters (2/term) vs trimesters, and whether an academic session is "2024/2025"       | Drives `semesters.sequence`, selectors, and frozen-report windows | 2 semesters per session, "2024/2025" naming                                 |
| D2  | **Course re-offering model** — split offerings (recommended) vs. semester-scoped course rows                                | Structural; everything reportable depends on it                   | Split offerings (`course_offerings`)                                        |
| D3  | **Excused policy** — does an approved excuse remove the student from the denominator, or count as "expected, not attended"? | Changes every percentage                                          | Excused = _expected, not attended_ (conservative), switchable via setting   |
| D4  | **Late policy** — does `late` count as attended?                                                                            | Changes every percentage                                          | Yes (`late_counts_as_attended = true`)                                      |
| D5  | **Attendance threshold** for at-risk / exam barring (the mock uses 75%; `site_settings` currently defaults 70)              | Drives at-risk badges and the barred list                         | 75% (configurable in Branding → Settings)                                   |
| D6  | **Email provider** for password reset / notifications                                                                       | Blocks P5.1                                                       | Skip email; in-app notifications only                                       |
| D7  | **Logo & institution branding** — is there an official logo asset and institution name for report headers?                  | Blocks the PDF/print header                                       | Use `site_settings.institution_name` + text mark until an asset is supplied |
| D8  | **Bulk import file format** (what the registrar's office actually exports)                                                  | Shapes P5.4                                                       | CSV with documented columns + a downloadable template                       |

---

## 15. Risks & mitigations

| Risk                                                            | Impact                     | Mitigation                                                                                                                               |
| --------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Attendance math is subtly wrong and gets published              | High (institutional trust) | P0 first, golden fixtures, weighted formula documented in-product, reconciliation tests, freeze-after-finalization                       |
| Schema split (offerings) breaks existing endpoints              | High                       | Additive migrations + explicit compatibility rule + all existing tests must pass unmodified                                              |
| Large exports (thousands of students) freeze the browser        | Medium                     | Server-side paginated payload, row caps with a friendly message, `xlsx`/`jspdf` already lazy-loaded                                      |
| Print output clipped / headings missing                         | Medium                     | Print route + `table-header-group`, A4 landscape for wide tables, fixed-layout columns, verified in Chrome/Firefox/Safari print previews |
| Scope creep from Examinations/Results                           | Medium                     | Phase-gated (P4), schema-only first, UI behind a route that states "coming in P4" until then                                             |
| Migration on production D1 with live data                       | High                       | Every migration idempotent + backfilled + dry-run against a D1 export; Time Travel snapshot taken first (documented in `DEPLOY.md`)      |
| No real institutional data yet ⇒ demo numbers mistaken for real | Medium                     | Seed is explicitly labelled demo; `show_fake_stats` setting already exists; "demo data" banner in dev                                    |

---

## 16. Immediate next 5 actions (once the decisions in §14 are confirmed)

1. Land **P0.1 + P0.2** (`stats.ts`, absence materialisation) with tests — this fixes the only real _correctness_ defect in the product today.
2. Land **P0.3** (`audit_log` + reason-required corrections) — closes the brief's §9 requirement that already has UI but no trail.
3. Land **P0.5** (seed v2 with the brief's 11 courses and 16 weeks of sessions) so every later screen has honest, demo-able data.
4. Land **P1.1/P1.2** (faculties, academic sessions, semesters, offerings + compatibility layer).
5. Land **P1.3/P1.6** (`GET /api/reports/courses` + the All Courses table) — the brief's centrepiece screen, then iterate P2/P3.

---

### Appendix A — file touch list (high level)

**New:** `worker/src/stats.ts`, `worker/src/audit-log.ts`, `worker/src/scopes.ts`, `worker/src/notify.ts`, `migrations/0007`–`0012`, `src/lib/attendance-math.ts`, `src/lib/report-dataset.ts`, `src/lib/exporters/{excel.ts,pdf.ts,print.ts}`, `src/components/data-table/*`, `src/components/reports/*`, `src/components/app-shell/*`, new routes listed in §6.3, `docs/ADMIN-GUIDE.md`, `docs/DATA-MODEL.md`, `worker/tests/{stats,reports,exports,audit,scopes}.test.ts`.

**Modified:** `worker/src/index.ts` (routes, query validation, scope enforcement), `worker/src/db.ts` (offering-aware queries + report queries), `worker/src/types.ts` + `src/lib/types.ts` (contracts), `src/lib/api.ts` + `src/lib/queries.ts` (new clients/query options), `src/components/AppShell.tsx` (nav groups, top bar), `src/routes/admin.*` (all), `src/styles.css` (print + table utilities), `README.md`, `DEPLOY.md`, `docs/GAP-ANALYSIS.md` (link to this plan).

**Untouched by design:** attendance capture paths (QR, rotating codes, geofence, evidence), auth/JWT internals, rate limiting, CORS/security headers, Vercel/wrangler deployment config — these are already production-grade and this plan builds on them rather than replacing them.

### Appendix B — what already beats the reference mock (keep and reuse)

- Live lecture sessions with rotating codes, grace windows, seat caps and auto-close.
- GPS geofencing with per-course venue defaults and HMAC-signed sign-in attestation.
- Device/IP/colo forensics surfaced to lecturers (`verified`/`attested`/`unlocated` classes).
- Recurring schedules materialised by cron, so the Timetable page (P4.1) has real data day one.
- Server-side revocation (logout-everywhere / password change) and PBKDF2 hashing.
- A tested repo layer — **81 worker tests across 6 suites** (`auth`, `handler`, `helpers`, `lifecycle`, `repo`, `tamper`) plus 2 frontend suites, all run by CI (`lint` → `typecheck` → `test` → `build`). New reports/exports/audit tests join that harness rather than sitting beside it.
