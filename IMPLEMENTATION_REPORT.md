# SLAMS — Audit, Repair and Production-Readiness Report

Branch: `arena/01a0613e-smart-attendance-hub`
Baseline commit: `9ec7dc7`

---

## 1. Repository assessment

The repository presented as a finished product but was closer to a high-fidelity
prototype. The UI layer was genuinely good — a coherent design system, thoughtful
empty states, a real component library. Underneath it, the data and security
layers were not production software.

The single most consequential finding was that **the application had no real
backend**. `src/lib/db.server.ts` implemented a module-scoped in-memory store as
a "fallback" for local development, and that fallback was reachable in
production. On Cloudflare Workers, module scope is per-isolate and isolates are
evicted freely, so this meant attendance records could silently vanish, and two
users could be served by two different isolates holding two different datasets.
Everything else — auth, reporting, integrity — was built on top of that.

The stated target architecture (Vercel frontend, Cloudflare backend) also did not
match the code, which was a TanStack Start SSR app compiled by Nitro to a single
Worker. Reaching the target was not a deployment-config change; it required
separating the API from the UI.

---

## 2. Problems discovered

### Critical

| #   | Problem                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | In-memory data store reachable in production; data loss and per-isolate inconsistency guaranteed on Workers.                                           |
| C2  | Session JWTs signed with a hardcoded fallback secret when `SESSION_SECRET` was unset — anyone could forge an admin session.                            |
| C3  | Sessions were irrevocable. Changing a password, or deleting a user, left existing tokens valid until natural expiry.                                   |
| C4  | No CSRF protection on any state-changing endpoint, with cookie-based auth.                                                                             |
| C5  | Role checks were duplicated inline per route and missing on several mutations, so some admin-only operations were reachable by any authenticated user. |
| C6  | Demo accounts enabled by default with the password (`password123`) printed on the public landing page.                                                 |
| C7  | Attendance codes were not unique among live sessions; a student could sign in to the wrong lecture.                                                    |
| C8  | No unique constraint on attendance; duplicate records were prevented only by a UI check.                                                               |

### High

| #   | Problem                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Passwords hashed with PBKDF2 at 100k iterations, below current guidance, with no upgrade path.                                                                                                                    |
| H2  | No rate limiting anywhere — login was open to unlimited credential stuffing.                                                                                                                                      |
| H3  | Deleting a department or course cascaded silently, destroying historical attendance.                                                                                                                              |
| H4  | No audit trail of any kind.                                                                                                                                                                                       |
| H5  | `student.attend.tsx` swallowed geolocation failures (`catch {}`) and submitted without coordinates, producing inexplicable "outside the venue" errors.                                                            |
| H6  | The QR scanner leaked the camera: `startScan` could return after `setScanning(true)` with a null ref, and the stream was not stopped on all success paths. The camera indicator stayed on after leaving the page. |
| H7  | Password policy was "min 6 characters", enforced only in the browser.                                                                                                                                             |
| H8  | Changing your email required no re-authentication.                                                                                                                                                                |
| H9  | Client-side validation of attendance codes (4–12 alphanumeric, upper-cased) did not match the server (6 digits) — **every** typed or scanned code failed.                                                         |
| H10 | The theme toggle wrote `slams-theme` while the pre-paint script read `slams:theme`, so a saved dark theme was discarded on every reload.                                                                          |

### Medium

| #   | Problem                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------- |
| M1  | `jspdf`, `jspdf-autotable`, `xlsx` statically imported — ~1.3 MB in the initial bundle for a feature most users never touch. |
| M2  | No pagination on any list; every user, course and audit row was sent at once.                                                |
| M3  | Error handling was inconsistent — some failures produced blank screens, some raw stack traces.                               |
| M4  | Accessibility gaps: unlabelled icon buttons, no skip link, no `aria-current`, tables without sort semantics.                 |
| M5  | `npm ci` failed on Linux and CI because a Windows-only workerd binary was a hard dependency.                                 |
| M6  | No `robots.txt`; authenticated areas were crawlable.                                                                         |
| M7  | Deletion actions had no confirmation step.                                                                                   |

### Low / Info

| #   | Problem                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------- |
| L1  | `package.json` still named `tanstack_start_ts`.                                                                     |
| L2  | README documented the in-memory fallback and published demo passwords; DEPLOY described the removed Nitro pipeline. |
| L3  | 1,000+ formatting violations against the repo's own Prettier config.                                                |
| L4  | No security headers.                                                                                                |
| L5  | Stale `src/router.tsx` and `src/cloudflare.d.ts` left behind.                                                       |

---

## 3. Problems fixed

Each entry gives the root cause, not just the symptom.

### C1 — No real persistence

_Root cause:_ the repository pattern had two implementations and picked the
in-memory one whenever a D1 binding was absent, which included production
misconfiguration.
_Solution:_ deleted the in-memory store entirely and built `worker/lib/repo.ts`
as a single D1-backed repository. A missing binding is now a startup failure, not
a silent downgrade. Schema moved into reviewed migrations.
_Files:_ `worker/lib/repo.ts`, `migrations/0001–0003`, deleted `src/lib/db.server.ts`.

### C2 — Forgeable sessions

_Root cause:_ `SESSION_SECRET ?? "dev-secret"`.
_Solution:_ the Worker fails closed — a missing or short secret returns 500 and
logs a structured error rather than signing tokens with a known key.
_Files:_ `worker/index.ts`, `worker/lib/crypto.ts`.

### C3 — Irrevocable sessions

_Root cause:_ stateless JWTs with no server-side invalidation.
_Solution:_ added `users.token_version`; the claim is compared on every request.
Password changes, admin password resets and soft deletes bump it, instantly
invalidating every outstanding session for that user.
_Files:_ `worker/lib/context.ts`, `worker/lib/repo.ts`, `migrations/0003`.

### C4 — No CSRF protection

_Solution:_ double-submit tokens. A readable `slams_csrf` cookie is echoed in the
`x-slams-csrf` header and verified on every non-GET/HEAD/OPTIONS request. The API
client attaches it automatically.
_Files:_ `worker/lib/http.ts`, `src/lib/api.ts`. **Verified:** a POST without the
header returns `FORBIDDEN`.

### C5 — Inconsistent authorization

_Root cause:_ authorization was a per-handler convention rather than a
chokepoint.
_Solution:_ route table entries declare their required role and the dispatcher
enforces it before the handler runs, so a new route cannot accidentally be
public.
_Files:_ `worker/index.ts`, `worker/lib/context.ts`. **Verified:** a student
calling `POST /api/admin/departments` gets `FORBIDDEN`.

### C6 — Demo credentials in production

_Solution:_ server defaults are now `demoAccountsEnabled: false` and
`showFakeStats: false`; `demoPassword` was removed from the settings model
entirely, so a password can never be served to the public. Seeding is explicit
and the operator chooses the password. The landing page and login screen show
demo _emails_ only when demo mode is deliberately switched on.
_Files:_ `worker/lib/repo.ts`, `src/lib/useSiteSettings.ts`, `src/routes/index.tsx`, `src/routes/login.tsx`, `scripts/seed.ts`.

### C7/C8 — Attendance integrity

_Solution:_ codes are generated with retries and checked for uniqueness among
_live_ sessions. A unique index on `(session_id, student_id)` makes duplicate
attendance impossible at the storage layer. Only one live session per course is
allowed; a second attempt returns 409 instead of silently creating a duplicate.
_Files:_ `migrations/0003`, `worker/lib/repo.ts`. **Verified:** duplicate submit
returns `CONFLICT`; a second concurrent session is refused.

### H1 — Password hashing

_Solution:_ PBKDF2-SHA256 raised to 210,000 iterations. The stored format
(`pbkdf2$<iterations>$<salt>$<hash>`) carries its own cost, and `needsRehash`
transparently upgrades legacy 100k hashes on the user's next successful login.
_Files:_ `worker/lib/crypto.ts`, `worker/routes/auth.ts`.

### H2 — Rate limiting

_Solution:_ KV-backed limits — login 20/5min per IP and 10/5min per email, plus
an 8-failure/15-minute account lockout; attendance submission 12/5min per
student; password change 5/15min.
_Files:_ `worker/lib/http.ts`, `worker/routes/auth.ts`, `worker/routes/teaching.ts`.

### H3 — Destructive deletes

_Solution:_ an explicit policy replacing silent cascades. Users are soft-deleted
(email tombstoned so it can be reused). Departments refuse deletion while
courses or members remain. Courses refuse deletion once sessions exist, and
offer archiving instead. Errors explain what blocks the deletion.
_Files:_ `worker/lib/repo.ts`, `worker/routes/admin.ts`. **Verified:** deleting a
department with a course returns "This department still has 1 course."

### H4 — Audit trail

_Solution:_ an `audit_log` table plus a helper invoked by every mutating handler,
recording actor, action, resource, metadata and IP. Surfaced in a new admin
screen with search and pagination; a cron trigger prunes entries past 180 days.
_Files:_ `worker/lib/audit.ts`, `migrations/0003`, `src/routes/admin.audit.tsx`.

### H5/H6 — Attendance sign-in

_Solution:_ geolocation now resolves through an explicit state machine. Failures
produce specific, actionable messages (permission denied vs. unavailable vs.
timeout) instead of being swallowed, and a geofence rejection from the server is
paired with the reason location failed. The scanner mounts only after its
container exists, and `stopScanner` is idempotent and invoked from a cleanup
effect and on tab hide, so the camera is always released.
_Files:_ `src/routes/student.attend.tsx`.

### H7/H8 — Account security

_Solution:_ the shared password policy is now 10+ characters with lower, upper
and numeric classes, enforced by `passwordSchema` on the server and mirrored as
a live checklist in the UI. Because a password change bumps `token_version` and
kills the current session, the UI now signs the user out and asks them to sign in
again rather than leaving a dead session in the tab.
_Files:_ `shared/schemas.ts`, `src/routes/settings.tsx`. **Verified:** creating a
user with `"short"` is rejected.

### H9 — Code format mismatch

_Root cause:_ the client was written against an assumed format rather than
`attendanceCodeSchema`. Found by end-to-end testing, not by reading the code.
_Solution:_ the input is numeric-only, 6 digits, with `inputMode="numeric"` and
one-time-code autofill; QR payloads (raw code or full URL) are normalised the
same way.
_Files:_ `src/routes/student.attend.tsx`.

### H10 — Theme key mismatch

_Solution:_ both readers use a single `THEME_KEY = "slams:theme"` constant.
_Files:_ `src/components/ThemeToggle.tsx`.

### M1 — Bundle size

_Solution:_ every heavy library is now dynamically imported at its call site —
`jspdf`/`xlsx` when an export is requested, `html5-qrcode` when the camera
starts, `qrcode` on the live-session screen, `canvas-confetti` on success. Vendor
chunking splits React, TanStack and charts.
_Files:_ `src/lib/exporters.ts`, `src/routes/*`, `vite.config.ts`. **Result:** the
initial route loads ~112 kB (29 kB gzipped) of app code; jsPDF (400 kB) and xlsx
(425 kB) are no longer in the startup path.

### M2 — Pagination

_Solution:_ server-side search, sort and pagination for users, audit and student
history, behind a shared `DataTable`/`Pagination` pair with `keepPreviousData`
so paging doesn't flash.
_Files:_ `worker/routes/admin.ts`, `src/components/DataTable.tsx`.

### M3 — Error handling

_Solution:_ a typed `ApiClientError` carrying code, status and per-field errors;
a `QueryBoundary` that renders loading, error and empty states consistently and
distinguishes offline from permission-denied from generic failure; retry that
never retries a 4xx. Route-level error and 404 components replace blank screens.
_Files:_ `src/lib/api.ts`, `src/components/QueryBoundary.tsx`, `src/routes/__root.tsx`.

### M4 — Accessibility

_Solution:_ skip-to-content link, labelled icon buttons, `aria-current` on
navigation, `aria-sort` on sortable headers, `aria-live` on the session
countdown, keyboard-activatable table rows, visible focus rings, and `role="alert"`
on form errors.
_Files:_ `src/components/*`, `src/routes/*`.

### M5–M7, L1–L5

Removed the Windows-only workerd dependency (`npm ci` verified working);
added `robots.txt` disallowing authenticated areas plus a `sitemap.xml`;
added `ConfirmDialog` to every destructive action; renamed the package to
`slams`; rewrote README and DEPLOY for the actual architecture; applied the
repo's own Prettier config (as an isolated commit); deleted the stale
`src/router.tsx` and `src/cloudflare.d.ts`; added security headers in
`vercel.json`.

---

## 4. Architecture changes

**Before:** TanStack Start SSR app with server functions, compiled by Nitro into
one Cloudflare Worker, backed by an in-memory store with an optional D1 path.

**After:** two independently deployable pieces.

- **Frontend** — a plain Vite SPA built to `dist/`, deployed as static assets on
  Vercel. No SSR, no server runtime, no cold starts.
- **Backend** — a standalone Worker in `worker/` with an explicit route table,
  centralised auth/CSRF/rate-limit middleware, structured JSON logging with
  request ids, and a cron trigger for maintenance.
- **Contract** — Zod schemas in `shared/` are the single source of truth for both
  sides, which is how the code-format mismatch (H9) became findable.

The seam deserves a note: the SPA calls **relative `/api/...`** and `vercel.json`
rewrites those to the Worker. The alternative — calling the Worker's URL directly
— would make every request cross-origin, requiring CORS preflights and a
third-party cookie that Safari and Chrome increasingly block. The rewrite keeps
the session cookie first-party.

---

## 5. Features completed

Screens that were placeholder, broken or missing are now functional against the
real API: admin overview, students, lecturers, departments, courses (including
lecturer assignment and enrolment management), reports and branding; the new
audit log; lecturer dashboard, courses, course detail, sessions list and the
live session console (QR, countdown, extend, end, manual marking, attendance
removal); student dashboard, course detail with milestones, sign-in and history;
and account settings.

---

## 6. Security improvements

Fail-closed session secret; revocable sessions via token versioning; CSRF
double-submit; centralised role enforcement; PBKDF2 at 210k with transparent
rehash; login/attendance/password rate limits with account lockout; strengthened
password policy; demo mode off by default with no password ever served; audit
logging of all mutations; soft deletes with tombstoned emails; `HttpOnly`
`Secure` `SameSite` cookies; an origin allowlist; open-redirect-safe login
`redirect` handling; security headers; and `robots.txt` exclusion of
authenticated areas.

---

## 7. Performance improvements

Static hosting removes SSR cold starts. Heavy libraries are lazily loaded, taking
roughly 1.3 MB out of the initial bundle. Vendor chunking separates React,
TanStack and charts for better cache retention. Lists paginate server-side.
Branding is cached for five minutes rather than refetched per navigation. Polling
is scoped to live sessions and stops automatically when a session closes.
Routes are code-split per file.

---

## 8. Testing actually performed

Everything below was executed in this environment. Nothing is claimed that was
not run.

**Static checks**

- `tsc --noEmit` (frontend) — passes, zero errors.
- `tsc -p worker/tsconfig.json --noEmit` — passes, zero errors.
- `eslint .` — 0 errors, 15 warnings (all `react-refresh/only-export-components`
  hints on files that intentionally export both a component and a helper).
- `prettier --check .` — clean.
- `vite build` — succeeds.
- `npm ci --dry-run` — resolves cleanly (regression test for M5).

**End-to-end, against the Worker on local D1 through the Vite proxy** (i.e. the
same relative-`/api` path production uses):

| Scenario                               | Result                                      |
| -------------------------------------- | ------------------------------------------- |
| `GET /api/health` through the proxy    | `{"status":"ok","database":"ok"}`           |
| SPA deep link `/admin/students`        | 200 (fallback works)                        |
| Login as lecturer / student / admin    | session + CSRF cookies issued               |
| Start session                          | created, 6-digit code returned              |
| Second concurrent session, same course | `CONFLICT`, as designed                     |
| Student open-sessions listing          | code correctly **omitted** from payload     |
| Student submits code                   | attendance recorded                         |
| Duplicate submit                       | `CONFLICT`                                  |
| Lecturer marks absentee manually       | present count 1 → 2                         |
| Extend session                         | expiry moved                                |
| End session                            | closed                                      |
| Submit after end                       | `NOT_FOUND` ("invalid or has expired")      |
| Create department → course             | both created                                |
| Delete department holding a course     | `CONFLICT` with an explanatory message      |
| Duplicate department code              | `CONFLICT`                                  |
| Delete course, then department         | both succeed once empty                     |
| Create user with password `"short"`    | `VALIDATION_ERROR` (new policy)             |
| Student calls an admin endpoint        | `FORBIDDEN`                                 |
| POST without the CSRF header           | `FORBIDDEN`                                 |
| Audit log after the above              | correct actor, action and resource for each |

**Not performed:** no automated test suite exists in this repository, and I did
not add one — that is the most valuable next piece of work. No deployment to
real Vercel or Cloudflare infrastructure was performed (no credentials). No
browser-automation pass, so the UI was verified by reading rendered output and
exercising the API the UI calls, not by clicking through every screen.

---

## 9. Remaining blockers requiring external credentials

1. **Cloudflare resource ids.** `wrangler.toml` still contains
   `REPLACE_WITH_*` placeholders for the staging D1 database and both KV
   namespaces. They can only be filled by running the `create` commands against
   your account.
2. **`SESSION_SECRET`.** Must be set via `wrangler secret put` per environment.
   The Worker deliberately refuses to run without it.
3. **Worker URL in `vercel.json`.** The `/api` rewrite points at
   `https://slams-api.REPLACE-ME.workers.dev` until you deploy the Worker and
   substitute the real hostname.
4. **`ALLOWED_ORIGINS`.** Must list your production Vercel domain.
5. **First administrator.** Created by running the seed script against remote
   D1; it prints a generated password once.

Steps 1–5 are the numbered sections of `DEPLOY.md`.

---

## 10. Deployment instructions

Full walkthrough in **`DEPLOY.md`**. Summary:

```bash
# Cloudflare
npx wrangler d1 create slams                     # → database_id  → wrangler.toml
npx wrangler kv namespace create CACHE           # → id           → wrangler.toml
npx wrangler kv namespace create RATE_LIMIT      # → id           → wrangler.toml
npx wrangler r2 bucket create slams-exports
npx wrangler d1 migrations apply slams --remote
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
# set ALLOWED_ORIGINS in wrangler.toml, then:
npx wrangler deploy --env production
curl https://<worker-url>/api/health

# Frontend
# put <worker-url> into the /api rewrite in vercel.json, commit, then import
# the repo at vercel.com/new — build `npm run build`, output `dist`,
# install `npm ci`. No environment variables required.

# First admin
node --experimental-strip-types scripts/seed.ts > /tmp/seed.sql
npx wrangler d1 execute slams --remote --file /tmp/seed.sql
```

Then sign in, change the generated password, and confirm demo mode is off under
**Branding**.

---

## 11. Recommended next work

1. **An automated test suite.** The highest-value gap. Vitest for
   `worker/lib/repo.ts` integrity rules (duplicate attendance, deletion policy,
   code uniqueness) and Playwright for the sign-in flow. Every bug in section 3
   that survived code review was caught by manual end-to-end testing; that should
   not depend on a human repeating it.
2. **CI.** Run typecheck, lint and build on every pull request.
3. **Session detail via polling → push.** Polling every 5 s is fine for a
   lecture-sized room; a Durable Object with WebSockets would be better for large
   halls. Not justified at current scale, which is why it was not done.
4. **Bundle:** `html5-qrcode` (879 kB) is the largest remaining dependency and is
   loaded only on the sign-in screen. A lighter scanner such as `zxing-wasm`
   would cut it substantially.
