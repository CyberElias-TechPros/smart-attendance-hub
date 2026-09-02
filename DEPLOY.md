# Deploying SLAMS

SLAMS is split across two providers:

| Piece        | Runs on                | Source        | Output                |
| ------------ | ---------------------- | ------------- | --------------------- |
| Web frontend | **Vercel** (static)    | `src/`        | `dist/`               |
| API          | **Cloudflare Workers** | `worker/`     | Worker script         |
| Database     | **Cloudflare D1**      | `migrations/` | SQLite at the edge    |
| Cache        | **Cloudflare KV**      | —             | `CACHE`, `RATE_LIMIT` |
| File exports | **Cloudflare R2**      | —             | `EXPORTS` bucket      |

The browser only ever talks to its own origin. `vercel.json` rewrites
`/api/*` to the Worker, so the session cookie is first-party and no
third-party-cookie blocking or CORS preflight is involved.

## Prerequisites

- A [Cloudflare](https://cloudflare.com) account (free tier is enough).
- A [Vercel](https://vercel.com) account.
- Node.js 20+ and npm.

```bash
npm install
npx wrangler login
```

---

## 1. Provision Cloudflare resources

Run each command and copy the id it prints into `wrangler.toml`.

```bash
# D1 database
npx wrangler d1 create slams                    # → database_id

# KV namespaces
npx wrangler kv namespace create CACHE          # → id
npx wrangler kv namespace create RATE_LIMIT     # → id

# R2 bucket for generated exports
npx wrangler r2 bucket create slams-exports
```

`wrangler.toml` ships with placeholder ids for the `staging` and `production`
environments. Replace every `REPLACE_WITH_*` value before deploying.

## 2. Apply database migrations

```bash
npx wrangler d1 migrations apply slams --remote
```

## 3. Set the session secret

The Worker refuses to start without a strong `SESSION_SECRET` — it signs
session JWTs, so a weak value means forgeable logins.

```bash
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
```

Repeat with `--env production` for each environment you deploy.

## 4. Configure allowed origins

In `wrangler.toml`, set `ALLOWED_ORIGINS` for each environment to the exact
origins that may call the API — your Vercel production domain and any preview
domains you want to work:

```toml
[env.production.vars]
ENVIRONMENT = "production"
ALLOWED_ORIGINS = "https://slams.example.edu"
```

## 5. Deploy the Worker

```bash
npx wrangler deploy --env production
```

Note the URL it prints, e.g. `https://slams-api.your-team.workers.dev`.
Verify it:

```bash
curl https://slams-api.your-team.workers.dev/api/health
# {"status":"ok","environment":"production","database":"ok",...}
```

## 6. Point the frontend at the Worker

Edit `vercel.json` and replace the placeholder destination with the URL from
the previous step:

```json
{ "source": "/api/:path*", "destination": "https://slams-api.your-team.workers.dev/api/:path*" }
```

## 7. Deploy the frontend to Vercel

Import the repository at [vercel.com/new](https://vercel.com/new). Vercel reads
`vercel.json`, so the defaults are already correct:

- **Framework preset:** Other
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Install command:** `npm ci`

No environment variables are required. `VITE_API_BASE_URL` exists only as an
escape hatch for pointing a local build at a deployed Worker; in normal
operation leave it unset so the relative `/api` rewrite is used.

Deploy, then open the site and confirm the landing page renders and
`/api/health` responds through your own domain.

## 8. Create the first administrator

`scripts/seed.ts` emits SQL rather than writing to the database directly, so
you can review it before it runs.

```bash
node --experimental-strip-types scripts/seed.ts > /tmp/seed.sql
npx wrangler d1 execute slams --remote --file /tmp/seed.sql
```

Without `--demo` this creates only the site settings row and a single
administrator, and prints the generated password once. Sign in and change it
immediately.

To load the full demo dataset instead (never do this in production):

```bash
node --experimental-strip-types scripts/seed.ts --demo --demo-password 'ChooseAStrongOne1' > /tmp/seed.sql
```

## 9. Turn demo mode off

Sign in as an administrator, go to **Branding**, and make sure _Show demo
accounts_ is off. The server default is already off; this only matters if you
seeded with `--demo`.

---

## Local development

Two processes, matching the production split:

```bash
# terminal 1 — the API
npx wrangler d1 migrations apply slams --local
node --experimental-strip-types scripts/seed.ts --demo --demo-password 'DemoPass123!' > /tmp/seed.sql
npx wrangler d1 execute slams --local --file /tmp/seed.sql
npm run dev:api          # http://127.0.0.1:8787

# terminal 2 — the frontend
npm run dev              # http://localhost:3000, proxies /api to :8787
```

If `wrangler dev` reports "Using redirected Wrangler configuration", delete a
stale build first: `rm -rf .output .wrangler/deploy`.

## Scheduled maintenance

`wrangler.toml` registers a cron trigger that closes expired sessions and
prunes audit entries older than 180 days. It is enabled automatically on
deploy; no extra setup is needed.

## Checks before going live

```bash
npm run typecheck   # frontend + worker
npm run lint
npm run build
```
