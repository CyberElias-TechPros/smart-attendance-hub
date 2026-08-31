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

   | Variable        | Value (production)                                  |
   | --------------- | --------------------------------------------------- |
   | `VITE_API_URL`  | `https://slams-api.<subdomain>.workers.dev`         |

   Set it for **Production** (and Preview/Development if you want those to
   point at the same API). `VITE_`-prefixed variables are inlined into the
   client bundle at build time, so the build must run *after* the variable
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

## CI (optional)

A ready-made GitHub Actions workflow runs lint + typecheck + tests + build on
every push/PR:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Lint
        run: npm run lint
      - name: Typecheck
        run: npm run typecheck
      - name: Test (worker API + repo integration)
        run: npm test
      - name: Build (frontend)
        run: npm run build
```

> Note: this file is not committed in the current branch because the GitHub
> App used to push it lacks the `workflows` permission. Create
> `.github/workflows/ci.yml` with the content above once that permission is
> available (or simply add the file in the GitHub web UI).

## Operations cheat-sheet

| Task                         | Command / place                                        |
| ---------------------------- | ------------------------------------------------------ |
| Run tests locally            | `npm test`                                             |
| Apply local D1 migrations    | `npm run db:migrate:local`                             |
| Inspect local D1             | `npx wrangler d1 execute slams --local --command "SELECT COUNT(*) FROM users;"` |
| Inspect remote D1            | `npx wrangler d1 execute slams --remote --command "…"` |
| Rotate JWT secret            | `npx wrangler secret put SLAMS_JWT_SECRET`             |
| Change allowed CORS origins  | `wrangler.toml` `[vars] ALLOWED_ORIGINS` + `npx wrangler deploy` (or dashboard) |
| Run a one-off SQL migration  | add a new numbered file in `migrations/`, then `npm run db:migrate:remote` |

## Troubleshooting

- **CORS errors in the browser** — the SPA origin is missing from the Worker's
  `ALLOWED_ORIGINS`. Add it and re-deploy.
- **`Cannot reach the server`** on the SPA — `VITE_API_URL` is wrong or the
  Worker isn't deployed; check the Worker URL and that the build happened
  after the env var was set.
- **`invalid_credentials` on a fresh DB** — demo seeding is automatic; if you
  disabled demo accounts in **Admin → Settings**, use a real account.
- **401 loops after password change** — the SPA clears the stored token on
  401 and redirects to `/login`; sign in again.
