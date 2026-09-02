# SLAMS — Smart Lecture Attendance Management System

A modern, full-stack attendance platform for universities. Lecturers run live,
QR-code attendance sessions; students sign in from any phone; administrators
manage people, courses, and reports. Attendance percentages are computed
automatically and exportable to **PDF** and **Excel**.

Built with **TanStack Start** (React, SSR, server functions) and designed to run
on **Cloudflare Workers + D1** (zero-config, globally distributed, cheap).

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
- **Secure auth** — PBKDF2 password hashing + signed JWT session cookies.

## Tech stack

| Layer     | Choice                                                             |
| --------- | ------------------------------------------------------------------ |
| Framework | [TanStack Start](https://tanstack.com/start) (React 19, SSR)       |
| Routing   | TanStack Router (file-based)                                       |
| UI        | Tailwind CSS v4 + shadcn/ui primitives + Radix                     |
| Charts    | Recharts                                                           |
| QR        | `qrcode` (generate) + `html5-qrcode` (scan)                        |
| Auth      | `jose` (JWT) + Web Crypto PBKDF2                                   |
| Reports   | `jspdf` + `jspdf-autotable` + `xlsx`                               |
| Database  | **Cloudflare D1** (SQLite) — with in-memory fallback for local dev |
| Hosting   | Cloudflare Workers (Nitro `cloudflare_module` preset) + Pages      |

## Demo accounts

The database auto-seeds on first run (locally or after migrations). Sign in with:

| Role     | Email                | Password      |
| -------- | -------------------- | ------------- |
| Admin    | `admin@slams.edu`    | `password123` |
| Lecturer | `lecturer@slams.edu` | `password123` |
| Student  | `student@slams.edu`  | `password123` |

> The admin can register additional students/lecturers, create departments &
> courses, assign lecturers, and enroll students.

## Local development (no Cloudflare account needed)

```bash
npm install
npm run dev          # http://localhost:5173 (or next available port)
```

In local dev the app uses an **in-memory store** (auto-seeded), so you can explore
every screen immediately without a D1 database. Data resets when the dev server
restarts.

## Deploying to Cloudflare (Workers + D1)

See **[DEPLOY.md](./DEPLOY.md)** for the full step-by-step guide. In short:

```bash
npm install
wrangler d1 create slams            # copy the database_id into wrangler.toml
npm run db:migrate:remote           # create tables
npm run deploy                      # build + wrangler deploy
```

## Project structure

```
src/
  components/        UI primitives, AppShell, ThemeToggle, Avatar, AnimatedNumber, …
  lib/
    api.functions.ts Server functions (auth, CRUD, sessions, reports)
    db.server.ts     D1-backed repository (+ in-memory fallback), schema lives in migrations/
    auth.server.ts   Password hashing + JWT session helpers
    exporters.ts     PDF / Excel report generation
  routes/            File-based routes: /, /login, /admin/*, /lecturer/*, /student/*
  styles.css         Design system (Tailwind v4 + custom tokens & animations)
migrations/0001_init.sql   D1 schema
wrangler.toml              Cloudflare Worker + D1 binding config
```

## License

MIT — free for universities and institutions.
