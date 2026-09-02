# SLAMS — Smart Lecture Attendance Management System

An attendance platform for universities. Lecturers run live, QR-code attendance
sessions; students sign in from any phone; administrators manage people,
courses and reports. Attendance percentages are computed automatically and
exportable to **PDF** and **Excel**.

The frontend is a static single-page app on **Vercel**. Everything else runs on
**Cloudflare**: a Worker for the API, D1 for relational data, KV for caching and
rate limiting, and R2 for generated files.

---

## Features

- **Role-based dashboards** — Admin, Lecturer and Student experiences.
- **Live sessions** — a unique, expiring 6-digit code per lecture, unique among
  all live sessions, with a QR code and a live countdown.
- **QR scanning** — students scan with their camera or type the code.
- **Optional geo-fence** — sign-ins only count inside the venue.
- **Duplicate prevention** — enforced by a unique index, not just UI checks.
- **Manual override** — lecturers can mark a student present when their device
  fails; every override is recorded in the audit log.
- **Automatic percentages** — `attended ÷ sessions held × 100`, with a
  configurable at-risk threshold surfaced across the app.
- **Reports** — per-course and faculty-wide, exportable to PDF and Excel.
- **Audit log** — every sign-in, record change and administrative action.
- **Secure auth** — PBKDF2-SHA256 (210k iterations), revocable signed session
  cookies, CSRF double-submit tokens, and login rate limiting with lockout.

## Architecture

```
Browser ──► Vercel (static SPA, dist/)
              │  /api/* rewrite (same-origin, first-party cookie)
              ▼
         Cloudflare Worker (worker/)
              ├── D1     relational data (migrations/)
              ├── KV     cache + rate limiting
              └── R2     generated exports
```

Because Vercel rewrites `/api/*` to the Worker, the browser never makes a
cross-origin request: no CORS preflight, and the session cookie is first-party
so it survives third-party-cookie blocking.

## Tech stack

| Layer      | Choice                                                   |
| ---------- | -------------------------------------------------------- |
| UI         | React 19, TanStack Router (file-based), TanStack Query   |
| Styling    | Tailwind CSS v4 + shadcn/ui primitives on Radix          |
| Build      | Vite (static SPA)                                        |
| API        | Cloudflare Workers, hand-rolled router in `worker/`      |
| Data       | Cloudflare D1 (SQLite), KV, R2                           |
| Auth       | `jose` (JWT) + Web Crypto PBKDF2                         |
| Charts     | Recharts (lazy-loaded)                                   |
| QR         | `qrcode` to generate, `html5-qrcode` to scan (both lazy) |
| Reports    | `jspdf` + `jspdf-autotable` + `xlsx` (all lazy-loaded)   |
| Validation | Zod schemas in `shared/`, used by client and server      |

## Local development

The API and the frontend run as two processes, matching production.

```bash
npm install

# terminal 1 — API on http://127.0.0.1:8787
npx wrangler d1 migrations apply slams --local
node --experimental-strip-types scripts/seed.ts --demo --demo-password 'DemoPass123!' > /tmp/seed.sql
npx wrangler d1 execute slams --local --file /tmp/seed.sql
npm run dev:api

# terminal 2 — frontend on http://localhost:3000
npm run dev
```

The Vite dev server proxies `/api` to the Worker, so the app behaves exactly as
it does on Vercel.

Seeding is explicit and opt-in — there is no auto-seed and no in-memory
fallback, so local behaviour matches production. Demo accounts exist only if
you pass `--demo`, and you choose the password. Demo mode is off by default on
the server and can be toggled under **Branding**.

## Deployment

See **[DEPLOY.md](./DEPLOY.md)** for the full Vercel + Cloudflare walkthrough.

## Project structure

```
index.html            SPA entry (pre-paint theme, SEO/OG meta)
src/
  main.tsx            Client bootstrap: QueryClient, router, AuthProvider
  lib/
    api.ts            Typed API client, ApiClientError, CSRF handling
    auth.tsx          Auth context; resolves the session before first render
    exporters.ts      PDF/Excel generation (dynamically imported)
  components/         AppShell, DataTable, QueryBoundary, ConfirmDialog, ui/*
  routes/             File-based: /, /login, /admin/*, /lecturer/*, /student/*
worker/
  index.ts            Router, error handling, structured logging, cron
  lib/                errors, crypto, context, http, audit, repo
  routes/             auth, admin, teaching, public
shared/schemas.ts     Zod schemas and types shared by client and server
migrations/           D1 schema
scripts/seed.ts       Emits seed SQL for review before it runs
wrangler.toml         Worker, D1, KV and R2 bindings
vercel.json           /api rewrite, SPA fallback, security headers
```

## Checks

```bash
npm run typecheck   # frontend + worker
npm run lint
npm run build
```

## License

MIT — free for universities and institutions.
