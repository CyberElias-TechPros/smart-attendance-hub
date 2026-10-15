# SLAMS — Smart Lecture Attendance Management System

A modern, full-stack attendance platform for universities. Lecturers run live,
QR-code attendance sessions; students sign in from any phone; administrators
manage people, courses, and reports. Attendance percentages are computed
automatically and exportable to **PDF** and **Excel**.

**Architecture:** a static React SPA hosted on **Vercel**, talking to a
**Cloudflare Worker** API (JWT auth, server-side authorization) backed by
**Cloudflare D1** (SQLite). No server-rendered frontend, no other cloud
provider.

---

## Features

- **Role-based dashboards** — Admin, Lecturer, and Student experiences.
- **Live QR / one-time code sessions** — a unique, expiring 6-digit code per lecture.
- **QR scanning** — students scan with their camera (or type the code) on any device.
- **GPS verification** — optional geo-fence so sign-ins only count inside the venue.
- **Duplicate prevention** — enforced at the data layer (one record per student per session).
- **Automatic percentages** — `attended ÷ sessions held × 100`, recomputed on demand.
- **Analytics** — weekly attendance chart, per-student breakdowns, at-risk flags.
- **PDF & Excel reports** — generated entirely client-side, ready to email/print.
- **Institution reporting layer** — faculties → departments → courses, an academic
  session/semester model, and an **All-Courses table** whose 12 columns (roster,
  lectures held, average lectures attended, attendance %, present/absent/late)
  are computed server-side from real attendance records.
- **Attendance register** — `/admin/attendance`: every lecture that ran,
  institution-wide, filterable by session, semester, faculty, department, course,
  lecturer, date range and attendance status.
- **Exports that match the screen** — one server-built dataset feeds the table,
  the Excel workbook, the print preview and the PDF, so a filtered view and its
  export can never disagree. Export one course, several (row selection), or all.
- **Attendance integrity** — closing a lecture materialises the absences, so the
  counts always reconcile with the roster; corrections require a reason, are
  attributed in an **audit trail**, and notify the affected student.
- **Notifications** — a bell with an unread badge and a full inbox for
  corrections, withdrawals and finished exports.
- **Examinations & results** — assessments per course with their own maximum
  score, a mark-entry grid over the roster, publishing to students, and a
  Results view that puts attendance and performance side by side: correlation,
  the students under the attendance threshold, and the scripts still unmarked.
- **Bulk CSV import** — students, staff, enrolments and marks, validated line by
  line before anything is written; duplicates are skipped (so a re-run is safe),
  a bad row aborts the file, and the whole import lands as one transaction.
- **Capability grants** — lecturers are limited to their own courses; an
  administrator can grant department, faculty or institution reporting, mark
  publishing, people imports and audit-trail access, and promote other
  administrators. Reading scope is applied server-side after the filters, so a
  hand-written request cannot widen it.
- **Secure auth** — PBKDF2 password hashing + signed JWT session tokens
  (server-side role, ownership and capability checks on every route).

## Tech stack

| Layer    | Choice                                                                |
| -------- | --------------------------------------------------------------------- |
| Frontend | Vite + React 19 SPA, TanStack Router (file-based) + TanStack Query    |
| UI       | Tailwind CSS v4 + shadcn/ui primitives + Radix                        |
| Charts   | Recharts                                                              |
| QR       | `qrcode` (generate) + `html5-qrcode` (scan)                           |
| Auth     | `jose` (JWT) + Web Crypto PBKDF2                                      |
| Reports  | `jspdf` + `jspdf-autotable` + `xlsx`                                  |
| API      | **Cloudflare Worker** (TypeScript, zod validation, rate limits, CORS) |
| Database | **Cloudflare D1** (SQLite) — migrations in `migrations/`              |
| Hosting  | Frontend on **Vercel**, API on **Cloudflare Workers**                 |

## Project structure

```
src/                 React SPA (deployed to Vercel)
  routes/            File-based routes: /, /login, /admin/*, /lecturer/*, /student/*, /settings
  lib/api.ts         Typed fetch client for the Worker API (token from localStorage)
  lib/queries.ts     TanStack Query options
  lib/exporters.ts   PDF / Excel report generation (client-side)
  components/        UI primitives, AppShell, loaders, toasts, …
worker/              Cloudflare Worker API (deployed via wrangler)
  src/index.ts       Fetch router: CORS, security headers, rate limits, auth, routes
  src/db.ts          D1 repository (all SQL lives here)
  src/auth.ts        PBKDF2 hashing + JWT sign/verify
  tests/             Vitest suites (auth, repo against real SQLite, full handler)
migrations/          D1 migrations (schema evolution — never destructive)
vercel.json          Vercel SPA config (rewrites + security headers)
wrangler.toml        Worker + D1 binding config
```

## Demo accounts

The database auto-seeds demo data on first use (locally or after migrations).
Sign in with:

| Role     | Email                | Password      |
| -------- | -------------------- | ------------- |
| Admin    | `admin@slams.edu`    | `password123` |
| Lecturer | `lecturer@slams.edu` | `password123` |
| Student  | `student@slams.edu`  | `password123` |

> The admin can register additional students/lecturers, create departments &
> courses, assign lecturers, and enroll students. Demo accounts can be disabled
> under **Admin → Settings**.

## Local development

No Cloudflare account needed — `wrangler dev` emulates D1 locally
(SQLite file under `.wrangler/`).

```bash
npm install

# apply the schema to the local D1 database
npm run db:migrate:local

# run both dev servers (Vite SPA :5173 + Worker API :8787)
npm run dev:all
```

- SPA: <http://localhost:5173>
- API: <http://localhost:8787/api/health>

In local dev the SPA calls same-origin `/api` and Vite proxies it to the
Worker automatically — no `VITE_API_URL` needed (see `.env.example` for
production, where it must point at the Worker's public URL). For a
locally-signed dev JWT, copy `.dev.vars.example` to `.dev.vars` (see its
comments).

### Tests

```bash
npm test             # 233 tests: API client, worker auth, repo against real SQLite,
                     # and full HTTP-handler suites (imports, exams, access, reports)
npm run typecheck    # tsc --noEmit (frontend + worker)
npm run lint         # eslint + prettier
```

The API suites are the specification of record for the rules that matter: the
weighted attendance maths, all-or-nothing imports, the barred-from-exam policy,
scope enforcement (a grant can only widen reading, never writing) and the
last-administrator invariant. CI runs lint + typecheck + tests + build on every
push and pull request.

## Documentation

- **[docs/ADMIN-GUIDE.md](./docs/ADMIN-GUIDE.md)** — how an institution actually
  runs SLAMS: setup, CSV imports, running lectures, marks and publishing,
  capability grants, exports, semester snapshots, backups.
- **[DEPLOY.md](./DEPLOY.md)** — deployment, secrets, D1 migrations, the
  backup/restore runbook (Time Travel) and the restore drill.
- **[docs/UPGRADE-PLAN.md](./docs/UPGRADE-PLAN.md)** — the build plan this
  version was delivered against, with a delivery-status table and traceability to
  the requirements document.
- **[docs/GAP-ANALYSIS.md](./docs/GAP-ANALYSIS.md)** — the original audit of the
  codebase against the requirements.

## Deploying

See **[DEPLOY.md](./DEPLOY.md)** for the full step-by-step guide:
D1 migrations, Worker secrets, `wrangler deploy`, and the Vercel project
setup (including the `VITE_API_URL` and CORS origin settings).

## License

MIT — free for universities and institutions.
