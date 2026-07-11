# SLAMS — UI Livening, Branding Controllability & Gap-Closure Plan

Companion files (in `.kilo/plans/`):
- `1783626380886-frontend-audit.md` — every static/mock/incomplete part mapped (Part A + Part B).
- `1783626380886-ux-research.md` — retention research, delight features, and product gaps.

This plan is implementation-ready. It covers backend (model + server-fn changes) and frontend
(icons, confetti, milestones, motion system, branding page, gap fixes). Build currently passes
(`npm run build` green) — keep it green.

═══════════════════════════════════════════════════════════════════════════════════
## 1. Key decisions (resolve before coding)
═══════════════════════════════════════════════════════════════════════════════════
- D1 Confetti lib: add `canvas-confetti` (tiny, no React dep). Wrap in `src/lib/confetti.ts` with
  named presets. (Do NOT hand-roll canvas confetti.)
- D2 Icon system: `lucide-react` is already a dep. Create `src/lib/courseIcons.ts` exporting
  `ICON_NAMES` (curated list) + `getIcon(name)` → component, and a `<CourseGlyph icon color/>`
  component rendering a gradient tile. Fallback to `BookOpen`/`Compass`. "Track icons" = department
  `icon` (course `icon` overrides when present).
- D3 Site settings: new `SiteSettings` model + `getSiteSettings`/`updateSiteSettings` server fns
  (admin-only). Landing & login read via a cached `useSiteSettings()` hook (`queryOptions`).
- D4 Threshold: replace literal `70` everywhere with `useSiteSettings().atRiskThreshold` (default 70).
- D5 Milestones: pure util `src/lib/milestones.ts` → `computeMilestones(course, sessions, history)`
  returns ordered list of `{id, tone, title, body, emoji}`. Rendered as toasts on load + inline badges.
- D6 Motion: reuse existing keyframes in `styles.css` (fade-up, float, scale-in, pulse-ring, marquee,
  aurora, blink). Add: `shimmer` (skeletons), `stagger` children delay, `animate-in` page wrapper,
  and a global `@media (prefers-reduced-motion: reduce)` block that disables non-essential animation.
- D7 Honesty: reword QR "screenshots useless" copy to accurate claim; leave code-rotation as a
  later P3 task (noted, not built now).
- D8 Security: stop prefilling `password123` in admin student/lecturer create forms; demo login
  autofill in `login.tsx` reads `siteSettings.demoPassword`/`demoAccountsEnabled`.

═══════════════════════════════════════════════════════════════════════════════════
## 2. Backend tasks (atomic)
═══════════════════════════════════════════════════════════════════════════════════

B1. Model: add `SiteSettings` interface in `src/lib/db.server.ts`
    - Fields: id, institutionName (default "SLAMS"), atRiskThreshold (default 70),
      marqueeItems (string[]), testimonials ({name,role,text}[]), demoAccountsEnabled (bool),
      demoPassword (string), demoEmailDomain (string, default "slams.edu"), showFakeStats (bool),
      primaryColor? (string|null), contactEmail? (string|null).
    - Add to the in-memory store + (if D1 is wired) a `site_settings` table; seed one row with defaults.

B2. Repo methods: `getSiteSettings()`, `saveSiteSettings(partial)` (merge + persist).
    - Ensure `ensureSeeded()` creates the default settings row once.

B3. Server fns in `src/lib/api.functions.ts`:
    - `getSiteSettings = createServerFn({GET})` → `requireUser()` (any authed) then `repo.getSiteSettings()`.
    - `updateSiteSettings = createServerFn({POST}).inputValidator(z.object({...all fields optional}))`
      → `requireUser(["admin"])` then `repo.saveSiteSettings(data)`.

B4. Extend `Course` model: add `icon?: string; color?: string; category?: string; description?: string;`.
    - Extend `Department` model: add `icon?: string; color?: string;`.

B5. Extend schemas/handlers:
    - `createCourse`/`updateCourse`: accept `icon,color,category,description` (optional, validated strings).
    - `createDepartment`/`updateDepartment`: accept `icon,color`.

B6. Wire user editing (gap): confirm `updateStudent`/`updateLecturer` server fns are correct (they were
    just fixed in db.server — verify signatures match admin dialogs built in F-tasks below).

B7. New server fn `listOpenSessionsForStudent` (or extend `studentCourses` return) to power the
    student "Active sessions" tile (F-task). Returns open sessions across the student's enrolled courses
    with courseCode/title/code/expiresAt.

B8. (Optional P3, stub only) `excusedAbsence` flag on `AttendanceRecord` + server fn — leave as TODO
    marker; not implemented this pass unless explicitly requested.

═══════════════════════════════════════════════════════════════════════════════════
## 3. Shared component / lib tasks (frontend foundation)
═══════════════════════════════════════════════════════════════════════════════════

F1. `src/lib/courseIcons.ts`
    - Export `ICON_NAMES: string[]` (curated ~24 lucide names: BookOpen, Calculator, FlaskConical,
      Atom, Code2, Database, LineChart, Globe, Microscope, Music, Palette, Brain, Briefcase, Leaf,
      HeartPulse, Landmark, Languages, Camera, Cpu, Network, Sigma, Ruler, Compass, GraduationCap…).
    - `getIcon(name?: string)` returns the component or `BookOpen` fallback.
    - `CourseGlyph({icon,color,size,track?})`: renders a rounded gradient tile
      (`bg-gradient-to-br from-{color} to-{color}/60` with safe fallback) containing the icon.
      Color is a CSS color string; if absent, derive from a hash of the name (reuse Avatar palette idea).
    - Export `TrackGlyph` alias = same component using department icon/color.

F2. `src/lib/confetti.ts`
    - `import confetti from "canvas-confetti"`.
    - `burstSuccess()` — student sign-in: teal/green, modest particle count, origin bottom-center.
    - `burstCelebrate()` — lecturer/session/milestone: gold + confetti emoji, bigger, from top.
    - Both no-op when `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.

F3. `src/lib/milestones.ts`
    - `computeMilestones(args: { course, sessions, history, threshold })` returns
      `{id, tone:'success'|'warn'|'info'|'celebrate', title, body, emoji}[]`.
    - Implement ALL: first-ever sign-in, first sign-in for course, perfect week, 100% course,
      streak (3/7/14/30), at-risk warning (< threshold), comeback (was <threshold now ≥).
    - Pure + unit-testable; no React inside.

F4. `src/lib/useSiteSettings.ts` (or inside api hook file)
    - `useSiteSettings()` = `useSuspenseQuery(queryOptions({queryKey:['siteSettings'], queryFn:getSiteSettings}))`.
    - Provide `useAtRiskThreshold()` convenience returning `data.atRiskThreshold ?? 70`.

F5. `src/components/Skeleton` extensions — add `CardSkeleton`, `TableSkeleton`, `StatSkeleton` using
    existing `ui/skeleton.tsx` + a `shimmer` animation (add keyframe to styles.css).

F6. `src/components/RouteTransition.tsx` — wrapper that applies `animate-fade-up`/`animate-in` on mount
    for route content; used in `AppShell` main and landing sections. Respect reduced-motion.

F7. `src/components/MilestoneToaster.tsx` — on student dashboard/course detail mount, compute
    milestones and fire non-duplicate toasts (persist seen ids in `localStorage` keyed by course+type).

F8. `styles.css` additions: `@keyframes shimmer`, `.animate-shimmer`, `.stagger > *` nth-child delays,
    `.animate-in` (opacity/translate), and the global reduced-motion disable block. Do NOT duplicate
    existing keyframes — read the file first.

═══════════════════════════════════════════════════════════════════════════════════
## 4. Per-screen frontend tasks (atomic)
═══════════════════════════════════════════════════════════════════════════════════

### Landing (`src/routes/index.tsx`)
L1. Replace `LogoMarquee` array with `useSiteSettings().marqueeItems` (fallback to current list if empty).
L2. Replace `Testimonials` array with `siteSettings.testimonials` (render nothing / EmptyState if empty).
L3. Hero fake stats: if `showFakeStats` false, hide the "Fraud blocked 100%" stat or swap for a real
    number from `adminOverview` (counts.attendance). Keep "Sign-in time ~4s" only behind showFakeStats.
L4. CTA demo accounts: read `demoAccountsEnabled`/`demoPassword`/`demoEmailDomain`; hide block if disabled.
L5. Replace hardcoded "SLAMS" strings with `siteSettings.institutionName` (Header, Footer, CTA).
L6. Reword QR "screenshots become useless" → accurate copy (e.g. "Each session uses a short-lived code").
L7. Wrap each section in `<RouteTransition>` for staggered entrance; add `animate-float` already present.

### Login (`src/routes/login.tsx`)
G1. Demo buttons read `demoAccountsEnabled`/`demoPassword`/`demoEmailDomain`; hide if disabled.
G2. Replace literal "password123" hint with `siteSettings.demoPassword` (or hide when disabled).

### Student dashboard (`src/routes/student.index.tsx`)
S1. Use `useAtRiskThreshold()` instead of `70` (lines 19, 35).
S2. Add "Active sessions" tile: query open sessions (B7); if any, show a live card with code + countdown
    linking to /student/attend. Use new `CardSkeleton` while loading.
S3. Replace plain course cards with `CourseGlyph` (icon+color from `course.icon`/`course.color`); keep
    progress + at-risk coloring from threshold.
S4. Fire milestone toasts via `<MilestoneToaster>` using `computeMilestones` over courses+sessions.
S5. Wrap grid in `RouteTransition`; use `EmptyState` when no courses (replace inline dashed box).

### Student course detail (`src/routes/student/courses/$courseId.tsx`)
C1. Use `CourseGlyph` in header (icon/color).
C2. Replace `BookOpen`/hardcoded layout: show description (if any), track/department glyph.
C3. Add confetti when a session in this course is the one just signed into (read `?signed=1` or recent
    history) — call `burstSuccess()` once.
C4. Add milestone badges inline (perfect week / 100% / streak) using `computeMilestones`.
C5. Use `EmptyState` for no-sessions; `TableSkeleton`/skeleton while loading.

### Student attend (`src/routes/student.attend.tsx`)
A1. On success (`setResult`), call `confetti.burstSuccess()` (different from lecturer preset).
A2. Add a celebratory headline variant + subtle scale-in (already has animate-scale-in) + ring pulse.
A3. Offer "auto-open camera" toggle (remembers in localStorage) to cut steps (friction reduction).
A4. Use `useAtRiskThreshold()` not needed here, but show encouraging copy based on course %.

### Student history (`src/routes/student.history.tsx`)
H1. Replace inline empty row with `<EmptyState>`; add `TableSkeleton` while loading; wrap in transition.

### Lecturer dashboard / courses / sessions index
K1. `lecturer.index.tsx`, `lecturer.courses.tsx`, `lecturer.sessions.tsx`: replace `BookOpen` static
    icon with `CourseGlyph(course.icon, course.color)`. Wrap in `RouteTransition`; use `EmptyState`.
K2. Add confetti on "End session" success in `lecturer.courses.$courseId.tsx` (`burstCelebrate()`)
    showing "N students reached".
K3. `lecturer.courses.$courseId.tsx`: replace hardcoded `70` (line 178) with threshold; add
    `CourseGlyph`; add milestone/celebration when course hits 100% attendance.

### Lecturer live session (`src/routes/lecturer.sessions.$sessionId.tsx`)
V1. On "End session", call `confetti.burstCelebrate()`.
V2. Keep QR (real deep link) — fine. Add subtle pulse already present; ensure `prefers-reduced-motion`
    disables pulse.

### Admin overview (`src/routes/admin.index.tsx`)
M1. Replace hardcoded chart `oklch` colors with `siteSettings.primaryColor` when set (fallback current).
M2. Use `useAtRiskThreshold()` where relevant (none today, but future-proof the recent-sessions coloring).
M3. Add `CardSkeleton` loaders; wrap in `RouteTransition`.

### Admin Students / Lecturers (`admin.students.tsx`, `admin.lecturers.tsx`)
U1. Remove `password:"password123"` prefill (lines 43/74 students; 42/66 lecturers) — leave blank or
    generate a random temp password shown once via toast. (Security + honesty.)
U2. Add "Edit" dialog wired to `updateStudent`/`updateLecturer` (name, email, dept, level/staffId,
    optional password). Currently the server fns exist but UI never calls them (gap closure).
U3. Add search/filter input (client-side) over the user table (scale guard for large cohorts).
U4. Wrap lists in `RouteTransition`; use `EmptyState` when none.

### Admin Courses (`admin.courses.tsx`)
O1. Course create dialog: add `icon` (select from `ICON_NAMES`) + `color` (color input / preset swatches)
    + optional `description`. Pass to `createCourse`.
O2. Course card: render `CourseGlyph(course.icon, course.color)` instead of static `BookOpen`.
O3. Add edit dialog (reuse create form) wired to `updateCourse` (icon/color/description/title/units…).
O4. Wrap in `RouteTransition`; skeletons.

### Admin Departments (`admin.departments.tsx`)
D1. Add `icon`+`color` to create/edit; render `TrackGlyph` (department glyph) in list. (Read file first
    to mirror existing patterns.)

### Admin Branding / Site Settings (NEW `src/routes/admin.settings.tsx` + nav entry)
P1. Add `{ to:"/admin/settings", label:"Branding", icon:Settings2 }` to `admin.tsx` nav (rename existing
    Settings→Account or keep both; the existing `/settings` is per-user; this is faculty branding).
P2. Build page with form bound to `getSiteSettings`/`updateSiteSettings`:
    - Institution name; atRiskThreshold (number); demoAccountsEnabled (switch); demoPassword;
      demoEmailDomain; showFakeStats (switch); marqueeItems (tag/coma input); testimonials
      (repeatable name/role/text rows); primaryColor (color picker, optional); contactEmail.
P3. On save → `updateSiteSettings`, invalidate `['siteSettings']`, toast success.
P4. Use existing Dialog/Input/Switch/Button components; `RouteTransition` + skeleton.

### Settings (per-user) (`src/routes/settings.tsx`)
T1. Allow editing display name (and avatar seed) via a new `updateProfile` server fn (or extend
    `updateStudent`/`updateLecturer` to accept `name`). Wire a small form. (Gap closure, P1/P2.)

═══════════════════════════════════════════════════════════════════════════════════
## 5. Validation
═══════════════════════════════════════════════════════════════════════════════════
- `npm run build` must stay green (currently green after db.server fixes).
- Manual smoke: login as each role; student signs in → confetti + milestone toast; lecturer ends
  session → celebrate confetti; admin branding page edits institution name/threshold/marquee/testimonials
  → landing + dashboards reflect changes after reload/invalidate.
- Verify `prefers-reduced-motion: reduce` disables confetti + non-essential animation.
- Verify no literal `70`, `password123`, or hardcoded faculty/testimonial arrays remain in routes.
- Typecheck via build (rolldown/tsc). Add at least one unit test for `computeMilestones` if a test
  runner exists; otherwise note as follow-up.

═══════════════════════════════════════════════════════════════════════════════════
## 6. Risks / open questions
═══════════════════════════════════════════════════════════════════════════════════
- R1 D1 store: confirm whether `db.server.ts` uses in-memory only or D1; `saveSiteSettings` must
  persist appropriately (don't lose settings on redeploy). Inspect `getRepo()` before B1/B2.
- R2 Primary-color theming: if `primaryColor` is added, it must flow through Tailwind tokens, not just
  inline chart colors. Keep M1 minimal (chart + accents) to avoid a full token rebuild; flag full
  rebrand theming as a separate later effort.
- R3 Confetti on SSR: guard with `typeof window !== 'undefined'` (already pattern in session view).
- R4 Performance: `marquee`/aurora are GPU-light; keep new animations transform/opacity only.
- R5 Scope: P3 gap-closures (forgot-password, excused, alerts, audit log, tests/CI, persistence
  strategy) are OUT of this pass unless explicitly requested — they are cataloged, not built here.
