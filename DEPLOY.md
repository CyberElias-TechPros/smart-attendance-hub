# Deploying SLAMS (Vercel frontend + Cloudflare Worker/D1 backend)

The app is split into two deployables:

1. **Frontend** — a static Vite SPA, deployed to **Vercel** (`/` → `dist/`).
2. **Backend** — a Cloudflare **Worker** API backed by **D1** (SQLite),
   deployed with `wrangler` from this repo.

The frontend calls the backend over HTTPS using `VITE_API_URL` (baked in at
build time) and a `Bearer` JWT. The Worker's `ALLOWED_ORIGINS` variable must
list the frontend origin(s) for CORS.

## Prerequisites

- A [Cloudflare](https://cloudflare.com) account (free tier is enough).
- A [Vercel](https://vercel.com) account (free/hobby tier is enough).
- [Node.js 22+](https://nodejs.org) and npm, locally (for the wrangler CLI).

```bash
npm install
npx wrangler login        # authenticate the wrangler CLI once
```

---

## Backend — Cloudflare Worker + D1

The Worker and D1 binding are already configured in `wrangler.toml`
(`name = "slams-api"`, binding `DB` → database `slams`, `database_id`
committed). If you are starting a **fresh Cloudflare account** and the
committed `database_id` isn't yours, create a database and paste its id into
`wrangler.toml`:

```bash
npm run db:create                    # wrangler d1 create slams
# copy the printed database_id into wrangler.toml → [[d1_databases]]
```

### 1. Apply migrations

Migrations in `migrations/` are additive and non-destructive; they run in
order and are tracked by D1:

```bash
npm run db:migrate:remote            # wrangler d1 migrations apply slams --remote
```

The set as shipped (`0001`–`0013`) covers: core people/courses/attendance,
tamper-evident evidence, the audit log, the academic period model, notifications,
the timetable room series, examinations & results (`exams`, `results`,
`report_snapshots`, the barred-from-exam policy flag) and per-person capability
grants (`access_grants`). Run the command after every deploy that adds one — the
application will not start against a schema it does not expect.

### 2. Set the JWT secret

The Worker signs session JWTs with `SLAMS_JWT_SECRET`. Set it **as a secret**
(never in `wrangler.toml`, never committed):

```bash
npx wrangler secret put SLAMS_JWT_SECRET
# paste a long random string (>= 32 chars), e.g.:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> If the secret is missing in production the Worker falls back to a
> development secret and prints a warning — set it for real deployments.

### 3. Allow the frontend origin (CORS)

Set the comma-separated list of browser origins that may call the API.
Include your production Vercel URL **and** (optionally) the preview URL
pattern if you need CORS for preview deploys:

```bash
npx wrangler secret put ALLOWED_ORIGINS   # or a var, since it is not sensitive
# e.g. https://your-app.vercel.app
```

`ALLOWED_ORIGINS` is declared in `wrangler.toml` `[vars]` (empty by default
= allow all, with a startup warning — dev-friendly). For production set it as
a **var** to your origin(s); it is not a secret. You can set it in the
Cloudflare dashboard (Workers → slams-api → Settings → Variables) or by
changing the `[vars]` value in `wrangler.toml` and re-deploying.

### 4. Deploy

```bash
npm run deploy        # builds the frontend (typecheck + vite) and runs wrangler deploy
# or just the Worker:
npx wrangler deploy
```

Wrangler prints the Worker URL, e.g.
`https://slams-api.<subdomain>.workers.dev`. Verify:

```bash
curl https://slams-api.<subdomain>.workers.dev/api/health
# → {"ok":true,"data":{"status":"ok",...}}
```

Demo data is auto-seeded on first use (admin/lecturer/student accounts plus a
sample department/course/enrollment).

---

## Frontend — Vercel

1. Push this repository to GitHub (or connect the Git repo to Vercel).
2. In Vercel: **Add New → Project** → import the repo.
   - Vercel auto-detects **Vite**. `vercel.json` already pins
     `buildCommand: npm run build` (typecheck + vite build) and
     `outputDirectory: dist`, with SPA rewrites and security headers.
3. **Environment variables** (Project → Settings → Environment Variables):

   | Variable       | Value (production)                          |
   | -------------- | ------------------------------------------- |
   | `VITE_API_URL` | `https://slams-api.<subdomain>.workers.dev` |

   Set it for **Production** (and Preview/Development if you want those to
   point at the same API). `VITE_`-prefixed variables are inlined into the
   client bundle at build time, so the build must run _after_ the variable
   exists — re-deploy if you change it.

4. **Deploy.** Copy the production URL, e.g. `https://your-app.vercel.app`.
5. Go back to Cloudflare and add that URL to `ALLOWED_ORIGINS` (step
   Backend/3) if you didn't already, then re-deploy the Worker if you changed
   `wrangler.toml`.

### Local frontend preview against the real API

```bash
echo "VITE_API_URL=https://slams-api.<subdomain>.workers.dev" > .env
npm run dev        # SPA on :5173 calling the production Worker
```

---

## Backups and restore

D1 keeps **30 days of point-in-time history** (Time Travel), so the recovery
story is "restore to a moment", not "restore last night's dump".

```bash
# What bookmarks exist for this database?
npx wrangler d1 time-travel info slams

# Restore to a timestamp (either form works)
npx wrangler d1 time-travel restore slams --timestamp=2026-10-15T09:30:00Z
# or to a bookmark from `info` / a previous restore
npx wrangler d1 time-travel restore slams --bookmark=<bookmark>
```

**Before anything destructive** (a bulk import touching hundreds of rows, a
schema experiment, a script that rewrites records), note the current time. That
one line turns an incident into a rollback.

### Off-platform backups

Time Travel lives inside Cloudflare, so it does not cover "we deleted the
database". For that, export the data you could not reconstruct:

```bash
# A full logical dump of the database
npx wrangler d1 export slams --remote --output=slams-backup-$(date +%F).sql

# Just the tables an institution cannot rebuild by hand
npx wrangler d1 execute slams --remote --command \
  "SELECT COUNT(*) FROM attendance_records; SELECT COUNT(*) FROM results;"
```

Archive the semester report and workbook exports as well
(_Reports → Excel / Print to PDF_): a snapshot plus a PDF is a complete,
human-readable record that does not depend on this platform at all.

### Restore drill (do this once per term)

1. Pick a timestamp in the last 24 hours and note the current row counts
   (`wrangler d1 execute slams --remote --command "SELECT COUNT(*) FROM users"`).
2. Restore to a **preview** database (or the local one:
   `npx wrangler d1 time-travel restore slams --local --timestamp=…`) rather than
   production, and confirm the counts and a couple of reports.
3. Restore production only when you have to, and immediately:
   - sign in and check the dashboard cards (_Total Courses_, _Overall
     Attendance %_);
   - open **Audit trail** and confirm the gap is visible as a gap;
   - re-run `npm run db:migrate:remote` (a restore can predate a migration);
   - tell the affected staff what window was rolled back.

### What to monitor

- Worker logs (`npx wrangler tail`) — every request line carries `reqId`, status
  and duration; errors include a code an administrator can quote.
- `/api/health` for uptime checks.
- D1 metrics in the Cloudflare dashboard (reads/writes/rows) — a sudden jump is
  usually a report or an import being run in a loop.

---

## CI

`.github/workflows/ci.yml` runs lint + typecheck + tests + build on every
push to `main` and every pull request, so broken changes are caught before
they reach production.

## Operations cheat-sheet

| Task                        | Command / place                                                                 |
| --------------------------- | ------------------------------------------------------------------------------- |
| Run tests locally           | `npm test`                                                                      |
| Apply local D1 migrations   | `npm run db:migrate:local`                                                      |
| Inspect local D1            | `npx wrangler d1 execute slams --local --command "SELECT COUNT(*) FROM users;"` |
| Inspect remote D1           | `npx wrangler d1 execute slams --remote --command "…"`                          |
| Rotate JWT secret           | `npx wrangler secret put SLAMS_JWT_SECRET`                                      |
| Change allowed CORS origins | `wrangler.toml` `[vars] ALLOWED_ORIGINS` + `npx wrangler deploy` (or dashboard) |
| Run a one-off SQL migration | add a new numbered file in `migrations/`, then `npm run db:migrate:remote`      |
| Back up / restore D1        | `npx wrangler d1 time-travel info slams` → `… restore slams --timestamp=…`      |
| Export a logical dump       | `npx wrangler d1 export slams --remote --output=backup.sql`                     |
| Tail Worker logs            | `npx wrangler tail`                                                             |
| Grant a capability          | **Admin → Access & roles** (audited), or `POST /api/access/:userId/grants`      |

## Troubleshooting

- **CORS errors in the browser** — the SPA origin is missing from the Worker's
  `ALLOWED_ORIGINS`. Add it and re-deploy.
- **`Cannot reach the server`** on the SPA — `VITE_API_URL` is wrong or the
  Worker isn't deployed; check the Worker URL and that the build happened
  after the env var was set.
- **`invalid_credentials` on a fresh DB** — demo seeding is automatic; if you
  disabled demo accounts in **Admin → Settings**, use a real account.
- **401 loops after password change** — the SPA clears the stored token on
  401 and redirects to `/login`; sign in again. The same applies after a role
  change: promotion and demotion revoke outstanding sessions on purpose.
- **`no such table: access_grants` / `report_snapshots`** — the deployed database
  is behind the code. Run `npm run db:migrate:remote`.
- **A lecturer cannot see a course** — lecturers are scoped to their assigned
  courses; widen it with a capability grant (**Access & roles**) or assign the
  course to them.
