# Deploying SLAMS to Cloudflare (Workers + D1)

SLAMS is built with TanStack Start and compiled by Nitro to a **Cloudflare
Workers** module. State lives in **D1** (serverless SQLite). Everything is
configured in `wrangler.toml` and `vite.config.ts` — you do not need to touch
the build internals.

## Prerequisites

- A [Cloudflare](https://cloudflare.com) account (free tier is enough).
- [Node.js 20+](https://nodejs.org) and npm.
- Wrangler (installed as a dev dependency; run via `npm run`).

```bash
npm install
npx wrangler login        # authenticate the CLI once
```

## 1. Create the D1 database

```bash
npm run db:create         # -> wrangler d1 create slams
```

Wrangler prints a `database_id`. Open `wrangler.toml` and replace:

```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

with that value.

## 2. Apply the schema

Create the tables in **production** D1:

```bash
npm run db:migrate:remote
```

> For a fully local test instead, use `npm run db:migrate:local` (needs
> `wrangler dev` / Miniflare). The app will also auto-seed demo data on first
> request.

## 3. Build & deploy

```bash
npm run deploy           # vite build  ->  wrangler deploy
```

Nitro writes the Worker to `.output` and generates `.output/server/wrangler.json`
(merging your D1 binding). Wrangler then publishes it. After a moment your app
is live at `https://slams.<your-subdomain>.workers.dev`.

### Local preview against real D1

```bash
npm run db:migrate:local
npm run cf:dev           # wrangler dev (serves the built worker + D1 locally)
```

## 4. Seed data

On the first request after deploy, the repository auto-seeds departments,
demo users, courses, and a few historical sessions. Sign in with the demo
accounts from the README. To start fresh later, clear the tables with:

```bash
npx wrangler d1 execute slams --remote --command "DELETE FROM attendance_records; DELETE FROM sessions; DELETE FROM course_enrollments; DELETE FROM courses; DELETE FROM users; DELETE FROM departments;"
```

(Or run `npx wrangler d1 execute slams --remote --command "DROP TABLE ..."` per
table and re-apply migrations.)

## Environment & secrets

- There are **no required secrets** for a basic deploy — the JWT signing secret
  defaults to a dev value inside `src/lib/auth.server.ts`. For production,
  override it with a Workers secret:

  ```bash
  npx wrangler secret put SLAMS_JWT_SECRET   # paste a long random string
  ```

  Then update `getSecret()` in `src/lib/auth.server.ts` to prefer
  `process.env.SLAMS_JWT_SECRET`.

- Sessions use an `HttpOnly`, `SameSite=Lax` cookie — no extra config needed.

## How the data layer works

`src/lib/db.server.ts` exports `getRepo()`, which returns a **D1-backed**
repository when the `DB` binding is present (production / `wrangler dev`), and
falls back to an **in-memory** store when it isn't (plain `vite dev`). All server
functions in `src/lib/api.functions.ts` go through this repository, so the rest
of the app is storage-agnostic. D1 is reached via the canonical
`import { env } from "cloudflare:workers"` Worker env.

## Troubleshooting

- **`database_id` errors** — make sure you replaced the placeholder in
  `wrangler.toml` and re-ran `npm run db:migrate:remote`.
- **Migrations out of sync** — re-run `npm run db:migrate:remote`; Nitro tracks
  applied migrations in a `_migrations` table on the D1 instance.
- **404 on a route** — ensure you deployed the full build (`npm run deploy`)
  rather than only `vite build`; the Worker entry is `.output/server/index.mjs`.
