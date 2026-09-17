# SLAMS — Gap Analysis & Implementation Roadmap

_What the app is missing, across every aspect, so it works completely for every
role, user story, business rule, and use case — and in what order to build it._

Status legend:

- ✅ **Shipped** — present and verified working end-to-end.
- 🔶 **Partial** — present but with a gap that must close.
- 🧩 **Missing** — to be implemented (phased).

---

## 0. What is already true (verified, not guessed)

- **Backend (Cloudflare Worker + D1)** is complete for the core loop **plus Phase 1**:
  auth (PBKDF2 + JWT + refresh), users, departments, courses, enrollments, live sessions
  (QR, rotating codes + grace window, geo-fence, device forensics, duplicate guard,
  seats/capacity, auto-close), recurring schedules (cron materialization),
  absence/status states, lecturer claim-unassigned, reports (course/faculty/admin-overview),
  branding settings, rate limits, CORS, security headers, audit logs, seeding, migrations —
  **81 tests across 7 files pass**, `typecheck`, `lint` (0 errors), and `vite build` all pass.
- **Frontend (Vite SPA)** is connected to that backend correctly: same-origin `/api`
  proxy in dev, `VITE_API_URL` in prod, TanStack Router + Query with `beforeLoad`
  pre-fetching, role guards, pristine design system (Space Grotesk / Inter / JetBrains
  Mono, oklch palette, custom keyframes, reduced-motion support).
- **Deployment** is fully wired: `wrangler.toml` (D1 id committed), `vercel.json`
  (SPA rewrite + CSP + immutable assets), `DEPLOY.md`, CI, sitemap script.

So the honest headline: **the skeleton and the core loop are gold. The plan below is
about the edges a real institution trips over on week two.**

---

## 1. BUSINESS LOGIC / USE-CASE gaps (highest impact)

| # | Gap | Why it matters | Severity |
|---|-----|----------------|----------|
| 1.1 | **Recurring lectures (semester calendar)** ✅ | A real course meets 2–3×/week for 14 weeks. Shipped: `schedules` table + CRUD, lecturer "Recurring lectures" panel, cron + lazy materialization. | Shipped |
| 1.2 | **Session pre-scheduling + auto-start/auto-close** ✅ | Timetables are known up-front. Shipped: `scheduled()` cron materializes each leg on time; `auto_end_enabled` + `closeExpiredSessions()` auto-close abandoned QR windows. | Shipped |
| 1.3 | **Per-session seat/venue capacity + "booked/full"** ✅ | Venues have capacity. Shipped: `sessions.seats`, `full` rejection surfaced to students, capacity shown on the start form. | Shipped |
| 1.4 | **Absence / excused / late states** ✅ | Today a student is either `attended` or not. Shipped: `attendance_records.status` (`present`/`late`/`excused`/`absent`) + per-record dropdown; `present`+`late` count as attended in percentage math, `excused`/`absent` do not. | Shipped |
| 1.4b | **Tamper-evident location attestation** ✅ | Shipped (Phase 2): every accepted sign-in is bound into an HMAC-SHA256 digest (student·code·lat·lng·client-time·device) stored on the record; the lecturer sees a `verified / attested / unlocated` classification with distance, network (Cloudflare `request.cf`) fallback, and IP/User-Agent/colo forensics. | Shipped |
| 1.5 | **Snapshot integrity** 🔶 | Percentages are correct but *live*; a lecturer who extends a semester changes every historical average. Need semester windows + a recompute/freeze command (see 1.10). | High |
| 1.6 | **Gradebook handoff** 🧩 | The whole point of taking attendance is feeding it into results. No CSV per-course for the exams office, no LMS/SIS integration points. | Med |
| 1.7 | **Semester/term & academic-year concept** 🧩 | There is no notion of *which semester* a course belongs to; departments stretch across terms and everything is one flat list. | Med |
| 1.8 | **Audit log / change history (who changed what, when)** 🧩 | No append-only audit trail for admin edits; integrity complaints are unanswerable today. | Med |
| 1.9 | **Bulk import (CSV of students/lecturers)** 🧩 | Institutions onboard 5,000 students a term; clicking "Add student" per row is unviable. | Med |
| 1.10 | **Endpoint to recompute/finalize a course's attendance** 🧩 | Needed once semester windows exist; today recompute is implicit. | Med |
| 1.11 | **Lecturer: "no course assigned" dead-ends** 🔶 | A freshly-added lecturer with zero courses lands on empty dashboards with no path forward; `startSession` currently rejects their one-shot session if the UI can't register them. | Med |
| 1.12 | **Conflict rules** 🧩 | Starting two sessions on the same course in the same window is currently allowed (codes would both be open; percentages double-count). | Med |

---

## 2. AUTH / IAM / SECURITY gaps

| # | Gap | Status | Severity |
|---|-----|--------|----------|
| 2.1 | **Password reset / forgot-password flow** | 🧩 | High — the #1 support ticket on real campuses. Needs a secure flow (reset code → change) and an email/console deliverable. |
| 2.2 | **Session refresh (pro-active re-auth before the 7-day JWT dies)** | ✅ | Shipped — `POST /api/auth/refresh` (rolling token), `expiresInSeconds` on login, and the client auto-slides the session in its last 25% of life. |
| 2.3 | **Multiple admins + admin self-management** | 🔶 | Med — there is exactly one seeded admin and no API to create/rotate admins. |
| 2.4 | **Token revocation / logout-on-server** | ✅ | Shipped — `users.auth_version` is embedded in every JWT at sign-in; logout and password-change bump it, so every outstanding token for the account goes stale (`401 session_revoked`). |
| 2.5 | **2FA / SSO** | 🧩 | Med — universities have IdPs; SAML/OIDC is the enterprise answer. |
| 2.6 | **Brute-force on attendance codes** | ✅ | Done (per-user rate limit + 6-digit space + rotation). |
| 2.7 | **Cache-Control on `/_app` immutable assets + auth endpoints** | ✅ | Done (`vercel.json` + `no-store`). |

---

## 3. DATA-BACKEND / CLOUDFLARE gaps ("everything it needs for Cloudflare")

| # | Gap | Status | Notes |
|---|-----|--------|-------|
| 3.1 | **D1 schema** | ✅ | 5 migrations, additive, indexed, unique guards. |
| 3.2 | **Cron / scheduled execution for recurring sessions** | ✅ | Shipped — `wrangler.toml` `["* * * * *"]` trigger calls `scheduled()`, which materializes due schedule legs and runs `housekeeping()`; the same tick also runs lazily on request so local dev / zero-cron works. |
| 3.3 | **Object storage for exports/attachments** | 🧩 | R2/worker-signed URLs for bulk exports, absence evidence, roster uploads. |
| 3.4 | **Email/notifications** | 🧩 | Cloudflare doesn't send mail natively; wire Resend/SendGrid via a bound worker, or institutional SMTP. Needed for 2.1 + reminders. |
| 3.5 | **Observability: error tracking destination** | 🔶 | `[observability]` is on; add an error sink (Sentry) + alerting, and the existing Lovable error reporter. |
| 3.6 | **Per-user counters as abuse signals** | 🔶 | In-memory rate limiting is documented as approximate; move hot counters to D1/KV for multi-isolate accuracy. |
| 3.7 | **Backups + point-in-time restore** | 🧩 | D1 has Time Travel; document the restore runbook. |
| 3.8 | **Secrets** | ✅ | `SLAMS_JWT_SECRET` via `wrangler secret`. |

---

## 4. FRONTEND / UX / product gaps

| # | Gap | Status | Severity |
|---|-----|--------|----------|
| 4.1 | **Recurring session calendar UI** | ✅ | Shipped — `SchedulePanel` on the lecturer course page: create (daily/weekdays/specific days, time, duration), list, enable/disable, delete. |
| 4.2 | **Non-camera (manual-code) path is the primary happy path** | 🔶 | High — only works in an HTTPS browsing context and in WebKit; today it's behind an opt-in flag, and the landing sign-in path doesn't teach it. Make the big "Enter code" flow the default and treat camera as an accelerator. |
| 4.3 | **"Session is full" surfaced to students** | ✅ | Shipped — the API returns a `session_full` error with a human message; the attend flow surfaces `err.message` as a toast. |
| 4.4 | **Session-end confirmation dialog + "sure you want to close early?"** | 🧩 | Med — one tap permanently freezes data; deserves a confirm. |
| 4.5 | **Progressive Web App (install + offline shell)** | 🧩 | Med — "type the code" works offline and matches marketing copy "Works offline-first". |
| 4.6 | **Empty/no-permission states for every role** | 🔶 | Med — mostly present; unify into `EmptyState` with a "what to do next" CTA. |
| 4.7 | **Onboarding wizards (admin setup, first lecturer run)** | 🧩 | Med. |
| 4.8 | **In-product help / keyboard command palette** | 🔶 | Med — palette exists; add context help. |
| 4.9 | **i18n / locale** | 🧩 | Low (unless the institution is multi-campus). |
| 4.10 | **Accessibility pass (screen reader on the QR table, dialogs)** | 🔶 | Med — Radix primitives give a lot; audit focus traps + labels. |
| 4.11 | **E2E/browser tests** | 🧩 | Med — API is covered; Playwright for the three role journeys. |
| 4.12 | **Sitemap/SEO polish** | 🔶 | Done on Vercel via env; local build skips it (fine). |

---

## 5. THE END-TO-END FLOWS (user stories, in the order they must run)

Each line is a happy path the product must complete without dead-ends:

**Admin**
1. First login → seed data present → Overview renders. ✅
2. Create department → create lecturers → create students (or **CSV import** 🧩). 🔶
3. Create course → assign lecturer → enroll students (suggestion filters by dept+level). ✅
4. Configure branding (name, marquee, testimonials, threshold, demo toggles, contact email). ✅
5. Define **semesters** 🧩 and per-course semester windows (1.7).
6. Add a **second admin** 🔶 (2.3).
7. Run faculty report → PDF/Excel. ✅ (add **CSV gradebook** 🧩 1.6)
8. Open the **audit log** to answer "who deleted that record?" 🧩 (1.8).
9. Create a **recurring timetable** for a course ✅ (4.1 / 1.1).

**Lecturer**
10. Login → see courses (or a clear "ask your admin to assign you" if none) 🔶 (1.11).
11. **Schedule** next week's sessions once → they start themselves ✅ (1.2).
12. Or start a one-off session (code + QR, venue lock, rotation, **seats** 🧩) ✅
13. Watch live sign-ins stream in (distance/device forensics) ✅.
14. Close early (with **confirmation** 🧩 4.4) or let it auto-close 🧩 (1.2).
15. Review course report, hand out `%`, export PDF/Excel ✅.
16. Mark a student **excused** ✅ (1.4).

**Student**
17. Login → dashboard with live "sign in now" cards ✅.
18. **Type or scan** the code (manual-first happy path) 🔶 (4.2).
19. Get success + confetti, then see history/percentage update ✅.
20. Try a code that rotates/intends-to-expire → get a *retryable* message, not failure ✅.
21. Too late / wrong venue / full ✅ (1.3) → get a human message with the reason.
22. Request a **password reset** 🧩 (2.1).
23. Install the PWA 🧩 (4.5).

---

## 6. IMPLEMENTATION ORDER (what to build when)

**Phase 1 — Make the core loop un-breakable** — ✅ **COMPLETE (this iteration)**
1. ✅ Auto-close expired sessions + **renewal clock** for rotating sessions. `_schema` 👉 `0005`.
2. ✅ **Recurring sessions**: schedule/cancel/list + auto-start via Worker `scheduled()` (Cloudflare
   Cron Trigger) + lazy same-tick catch-up so local dev works with zero cron. `_schema` 👉 `0005`.
3. ✅ **Seats/capacity** + "session full". `_schema` 👉 `0005`.
4. ✅ **Session refresh** endpoint + `expiresAt` on login; client pro-actively re-auths.
5. ✅ Lecturer fallback `_registration` + **claim unassigned course** (first-come, dept-scoped):
   the "new lecturer" path never dead-ends.
6. ✅ Reject never-ending/live-forever sessions + **absence/status states** (`present`/`late`/`excused`/`absent`).

_Verified: `typecheck`, `lint` (0 errors), `vite build`, and 81 tests across 7 files all pass;
migration `0005` applies cleanly to fresh local D1; every new endpoint exercised against the live Worker._

**Phase 2 — Semester + integrity**
- Semesters table + foreign-key session→semester.
- **Absence states** + at-risk recompute.
- Course-end **finalize/freeze** + **CSV gradebook** export.

**Phase 3 — Scale + operations**
- CSV bulk import (validate → preview → apply).
- Audit log (append-only).
- Admin management (multiple admins), password-reset (email integration).
- Rate-limit counters in D1; Sentry sink; backup runbook.

**Phase 4 — Enterprise surface**
- SSO/OIDC, 2FA, roles permissions matrix; i18n; PWA polish; Playwright e2e.

---

## 7. DECISIONS DELIBERATELY NOT TAKEN (open questions for the user)

- **Terminology** of excused absences and the gradebook output columns (institution-specific).
- **Semester boundaries** (trimesters? terms?) — drives Phase 2 schema.
- **SSO provider** (Google Workspace, Microsoft Entra, custom IdP).
- **Email provider** for resets and reminders.
- Whether **auto-start** should arm immediately at deployment or behind the admin toggle.
