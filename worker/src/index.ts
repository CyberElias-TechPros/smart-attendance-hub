// SLAMS API — Cloudflare Workers entry point.
//
// A small, dependency-light fetch router over the D1 repository (./db.ts).
// Handles: CORS, security headers, request IDs, rate limiting, JSON body
// limits, zod input validation, Bearer-token auth, role + ownership
// authorization, and consistent error responses.

import { z } from "zod";
import {
  extractBearerToken,
  getJwtSecret,
  signSession,
  verifySession,
  SESSION_TTL_SECONDS,
  type SessionPayload,
} from "./auth";
import { getRepo, type D1Database } from "./db";
import { hashedPointer } from "./audit";
import {
  applyImport,
  previewImport,
  templateColumns,
  type ImportApplyResult,
  type ImportKind,
} from "./import";
import { toCsv } from "../../shared/csv";
import { recordAudit, type AuditContext } from "./audit-log";
import { BusinessError } from "./errors";
import { ApiError, clientIp, jsonError, jsonOk, readJsonBody } from "./http";
import { DEFAULT_LIMITS, FixedWindowLimiter } from "./rate-limit";
import { isValidTimeZone } from "./time";
import type { Role, User } from "./types";

export interface Env {
  DB: D1Database;
  SLAMS_JWT_SECRET?: string;
  /** Comma-separated list of allowed browser origins. Empty = allow all (dev). */
  ALLOWED_ORIGINS?: string;
}

/** Minimal surface of Cloudflare's IncomingRequestCfProperties (the full types
 *  package isn't in this project). `request.cf` holds client-city geolocation
 *  — latitude/longitude/colo — which backs the venue-lock network fallback. */
interface IncomingRequestCfProperties {
  city?: string;
  country?: string;
  colo?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
  asOrganization?: string;
  asn?: number;
}

const limiter = new FixedWindowLimiter();
let corsWarned = false;

// ─── CORS ──────────────────────────────────────────────────────────────────

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true; // non-browser clients (no Origin header)
  if (allowed.length === 0) return true; // dev convenience
  return allowed.includes(origin);
}

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const h: Record<string, string> = {
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    vary: "origin",
  };
  h["access-control-allow-origin"] = origin && originAllowed(origin, allowed) ? origin : "*";
  return h;
}

// ─── Security headers & plumbing ──────────────────────────────────────────

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), geolocation=()",
  "cache-control": "no-store",
};

function withHeaders(response: Response, extra: Record<string, string> = {}): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function requestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

// ─── Validation schemas ────────────────────────────────────────────────────

const emailSchema = z.string().trim().email().max(200);
const nameSchema = z.string().trim().min(2).max(120);
const passwordSchema = z.string().min(8).max(128);
const levelSchema = z.enum(["100", "200", "300", "400", "500"]);
const idSchema = z.string().min(1).max(64);
const shortStr = (max: number) => z.string().trim().max(max);
const optionalShortStr = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

/** Read Cloudflare client-city geolocation off the request (undefined when
 *  absent — local dev, Tor, or a proxied request). Latitude°/longitude° are
 *  strings in the CF object, so parse defensively. */
function cfGeo(req: Request): {
  latParse?: number;
  lngParse?: number;
  netLat?: number;
  netLng?: number;
  colo?: string;
  city?: string;
  country?: string;
} {
  const cf = (req as unknown as { cf?: IncomingRequestCfProperties }).cf;
  if (!cf) return {};
  const latParse = typeof cf.latitude === "string" ? Number(cf.latitude) : NaN;
  const lngParse = typeof cf.longitude === "string" ? Number(cf.longitude) : NaN;
  return {
    latParse: Number.isFinite(latParse) ? latParse : undefined,
    lngParse: Number.isFinite(lngParse) ? lngParse : undefined,
    netLat: Number.isFinite(latParse) ? latParse : undefined,
    netLng: Number.isFinite(lngParse) ? lngParse : undefined,
    colo: cf.colo || undefined,
    city: cf.city || undefined,
    country: cf.country || undefined,
  };
}

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

const createStudentSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  matricNo: shortStr(40).min(2),
  departmentId: idSchema,
  level: levelSchema,
  password: passwordSchema,
});

const createLecturerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  staffId: shortStr(40).min(2),
  departmentId: idSchema,
  password: passwordSchema,
});

const createUserSchema = z.discriminatedUnion("role", [
  createStudentSchema.extend({ role: z.literal("student") }),
  createLecturerSchema.extend({ role: z.literal("lecturer") }),
]);

const updateStudentSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  matricNo: shortStr(40).min(2).optional(),
  departmentId: idSchema.optional().or(z.literal("")),
  level: levelSchema.optional(),
  password: passwordSchema.optional(),
});

const updateLecturerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  staffId: shortStr(40).min(2).optional(),
  departmentId: idSchema.optional().or(z.literal("")),
  password: passwordSchema.optional(),
});

const updateUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  matricNo: shortStr(40).min(2).optional(),
  staffId: shortStr(40).min(2).optional(),
  departmentId: idSchema.optional().or(z.literal("")),
  level: levelSchema.optional(),
  password: passwordSchema.optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

const profileSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema.optional(),
});

const departmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z
    .string()
    .trim()
    .min(2)
    .max(10)
    .transform((s) => s.toUpperCase()),
  icon: optionalShortStr(40),
  color: optionalShortStr(200),
});
const departmentUpdateSchema = departmentSchema.extend({ id: idSchema });

const courseSchemaBase = z.object({
  code: z.string().trim().min(2).max(20),
  title: z.string().trim().min(2).max(120),
  departmentId: idSchema,
  level: levelSchema,
  units: z.number().int().min(1).max(12),
  icon: optionalShortStr(40),
  color: optionalShortStr(200),
  category: optionalShortStr(40),
  description: optionalShortStr(500),
  // Course-level venue geofence: sessions inherit it unless they pin their
  // own location. Latitude/longitude/radius must be set together.
  venueLat: latSchema.optional(),
  venueLng: lngSchema.optional(),
  venueRadius: z.number().int().min(10).max(5000).optional(),
  clearVenue: z.boolean().optional(),
});
const courseSchema = courseSchemaBase.refine(
  (v) => {
    const n = [v.venueLat, v.venueLng, v.venueRadius].filter((x) => x !== undefined).length;
    return n === 0 || n === 3;
  },
  { message: "Venue geofence requires venueLat, venueLng and venueRadius together (or none)" },
);
const courseUpdateSchema = courseSchemaBase.extend({ id: idSchema });

const startSessionSchema = z
  .object({
    courseId: idSchema,
    durationMinutes: z.number().int().min(1).max(240).default(15),
    topic: optionalShortStr(160),
    latitude: latSchema.optional(),
    longitude: lngSchema.optional(),
    radiusMeters: z.number().int().min(10).max(5000).optional(),
    // Anti-sharing: when set, the code rotates every N seconds (with a grace
    // window for students mid-sign-in). Null/omitted = one static code.
    codeIntervalSeconds: z.number().int().min(30).max(600).nullish(),
    // Venue capacity (optional). 0/omitted = unlimited.
    seats: z.number().int().min(0).max(10000).optional(),
    // Whether the session closes itself at expires_at (default true, unless
    // the lecturer explicitly opts into an "I'll close it" session).
    autoEndEnabled: z.boolean().optional(),
  })
  // A geofence is only enforced when ALL of lat/lng/radius are present —
  // reject partial coordinates instead of silently running an open session.
  .refine(
    (v) => {
      const n = [v.latitude, v.longitude, v.radiusMeters].filter((x) => x !== undefined).length;
      return n === 0 || n === 3;
    },
    {
      message: "Geofence requires latitude, longitude and radiusMeters together (or none)",
    },
  );

const scheduleSchema = z
  .object({
    courseId: idSchema,
    durationMinutes: z.number().int().min(1).max(240).default(15),
    topic: optionalShortStr(160),
    latitude: latSchema.optional(),
    longitude: lngSchema.optional(),
    radiusMeters: z.number().int().min(10).max(5000).optional(),
    codeIntervalSeconds: z.number().int().min(30).max(600).nullish(),
    seats: z.number().int().min(0).max(10000).optional(),
    recurrence: z.enum(["daily", "weekdays", "weekly", "custom"]),
    /** Room / lecture theatre; surfaced in the weekly timetable grid. */
    room: optionalShortStr(60),
    // ISO weekday numbers 1(Mon)..7(Sun), required for weekly/custom.
    days: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    // Local wall-clock start of day in minutes (0 = 00:00, 540 = 09:00).
    minuteOfDay: z.number().int().min(0).max(1439),
    // Guest local time offset east of UTC (client derives it on save).
    tzOffsetMinutes: z.number().int().min(-840).max(840).default(0),
    // Stop materializing after this Unix seconds timestamp (optional).
    endsOn: z.number().int().positive().optional(),
    // Hard cap on materialized sessions (optional).
    maxOccurrences: z.number().int().min(1).max(500).optional(),
  })
  .refine(
    (v) => (v.recurrence !== "weekly" && v.recurrence !== "custom") || (v.days?.length ?? 0) > 0,
    { message: "Weekly/custom schedules need at least one day of the week" },
  );

const setAttendanceStatusSchema = z.object({
  status: z.enum(["present", "late", "excused", "absent"]),
  // Brief §9: every correction must be explainable after the fact. Enforced
  // here (not just in the UI) so a script cannot bypass the trail.
  reason: z.string().trim().min(3, "Give a short reason for this correction").max(280),
});

const deleteAttendanceSchema = z.object({
  reason: z.string().trim().min(3, "Give a short reason for this deletion").max(280),
  /** Admin-only escape hatch for finalised periods. */
  override: z.boolean().optional(),
});

/** The eight attendance filters from the brief (§6). Every report, export and
 *  print view takes exactly this shape, so "exports use the current filters" is
 *  structural rather than something a caller has to remember. */
const reportFilterSchema = z.object({
  academicSessionId: z.string().trim().max(60).optional(),
  semesterId: z.string().trim().max(60).optional(),
  facultyId: z.string().trim().max(60).optional(),
  departmentId: z.string().trim().max(60).optional(),
  courseId: z.string().trim().max(60).optional(),
  /**
   * Several courses at once ("export the courses I selected"). Comma-separated
   * so it fits a query string, which is what makes a selection shareable and
   * makes the screen, the print view and the export agree on the same set.
   */
  courseIds: z.string().trim().max(4000).optional(),
  lecturerId: z.string().trim().max(60).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  status: z.enum(["present", "late", "excused", "absent"]).optional(),
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(60).optional(),
  sort: z
    .enum([
      "code",
      "title",
      "department",
      "enrolled",
      "classesHeld",
      "classesAttended",
      "rate",
      "present",
      "absent",
      "late",
    ])
    .optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

const facultySchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(12),
  deanUserId: z.string().trim().max(60).optional(),
  icon: z.string().trim().max(40).optional(),
  color: z.string().trim().max(60).optional(),
});

const academicSessionSchema = z.object({
  name: z.string().trim().min(4).max(60),
  code: z.string().trim().min(4).max(40),
  startsOn: z.number().int().optional(),
  endsOn: z.number().int().optional(),
  makeCurrent: z.boolean().optional(),
});

const semesterSchema = z.object({
  academicSessionId: z.string().trim().min(1).max(60),
  name: z.string().trim().min(3).max(60),
  sequence: z.number().int().min(1).max(8).optional(),
  startsOn: z.number().int().optional(),
  endsOn: z.number().int().optional(),
  makeCurrent: z.boolean().optional(),
});

const semesterUpdateSchema = z.object({
  name: z.string().trim().min(3).max(60).optional(),
  startsOn: z.number().int().nullable().optional(),
  endsOn: z.number().int().nullable().optional(),
});

const exportAuditSchema = z.object({
  format: z.enum(["pdf", "xlsx", "csv", "print"]),
  scope: z.enum(["course", "courses", "all", "semester", "session", "date-range"]),
  courseId: z.string().trim().max(60).optional(),
  title: z.string().trim().max(160).optional(),
  rowCount: z.number().int().min(0).max(1_000_000).optional(),
  filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const examKindSchema = z.enum(["ca", "test", "exam", "practical"]);

const examSchema = z.object({
  courseId: idSchema,
  title: z.string().trim().min(2).max(160),
  kind: examKindSchema.default("exam"),
  /** Contribution to the final score, in percent. Omitted ⇒ counts once. */
  weight: z.number().min(0).max(100).nullish(),
  maxScore: z.number().positive().max(10_000).default(100),
  scheduledAt: z.number().int().positive().nullish(),
  durationMinutes: z.number().int().min(5).max(600).nullish(),
  venue: optionalShortStr(120),
  room: optionalShortStr(60),
  semesterId: z.string().trim().max(60).optional(),
});

const examUpdateSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  kind: examKindSchema.optional(),
  weight: z.number().min(0).max(100).nullish(),
  maxScore: z.number().positive().max(10_000).optional(),
  scheduledAt: z.number().int().positive().nullish(),
  durationMinutes: z.number().int().min(5).max(600).nullish(),
  venue: optionalShortStr(120),
  room: optionalShortStr(60),
  published: z.boolean().optional(),
});

/**
 * One mark per student. `score: null` explicitly clears a mark — "not marked
 * yet" and "scored nothing" are different facts, and collapsing them would make
 * an unmarked script count as a fail in every average.
 */
const resultsSchema = z.object({
  rows: z
    .array(
      z.object({
        studentId: idSchema,
        score: z.number().min(0).max(10_000).nullable(),
        grade: optionalShortStr(4),
      }),
    )
    .min(1)
    .max(1000),
});

const importSchema = z.object({
  kind: z.enum(["students", "lecturers", "enrollments", "results"]),
  csv: z.string().min(1).max(2_000_000),
  courseId: idSchema.optional(),
  examId: idSchema.optional(),
  defaultPassword: z.string().trim().min(8).max(72).optional(),
});

const snapshotSchema = z.object({
  scope: z.enum(["semester", "course", "faculty", "department", "institution"]),
  entityId: z.string().trim().max(60).optional(),
  label: z.string().trim().min(2).max(200),
  payload: z.unknown(),
  totals: z.record(z.string(), z.number().nullable()).optional(),
  rowCount: z.number().int().min(0).max(1_000_000).optional(),
});

const auditQuerySchema = z.object({
  action: z.string().trim().max(60).optional(),
  actorId: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  courseId: z.string().trim().max(60).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const attendanceSchema = z.object({
  code: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, ""))
    .refine((s) => s.length === 6, { message: "Attendance code must be exactly 6 digits" }),
  latitude: latSchema.optional(),
  longitude: lngSchema.optional(),
  // Device clock at submission (attested + bounded server-side).
  clientTime: z.number().int().positive().optional(),
  // Opaque per-device token (generated client-side, persisted). Sanitized,
  // never trusted, in the repo layer — see sanitizeDeviceId.
  deviceId: z.string().trim().max(64).optional().or(z.literal("")),
});

const testimonialSchema = z.object({
  name: z.string().max(120),
  role: z.string().max(120),
  text: z.string().max(500),
});

const siteSettingsSchema = z.object({
  institutionName: z.string().trim().min(1).max(120).optional(),
  /** IANA timezone — every "today"/"this week" boundary is computed in it. */
  timezone: z
    .string()
    .trim()
    .max(64)
    .refine((tz) => isValidTimeZone(tz), "Unknown IANA timezone")
    .optional(),
  /** Print/PDF branding (brief §7). */
  logoUrl: z.string().trim().max(600).nullable().optional(),
  reportFooterNote: z.string().trim().max(300).nullable().optional(),
  /** Plan decisions D3/D4 — changeable without a deploy. */
  lateCountsAsAttended: z.boolean().optional(),
  excusedCountsAsAbsent: z.boolean().optional(),
  atRiskThreshold: z.number().min(0).max(100).optional(),
  marqueeItems: z.array(z.string().trim().max(80)).max(20).optional(),
  testimonials: z.array(testimonialSchema).max(12).optional(),
  demoAccountsEnabled: z.boolean().optional(),
  demoPassword: z.string().min(6).max(128).optional(),
  demoEmailDomain: z.string().trim().min(3).max(60).optional(),
  showFakeStats: z.boolean().optional(),
  primaryColor: z.string().trim().max(200).nullable().optional(),
  contactEmail: z.string().trim().email().max(200).nullable().optional(),
});

// ─── Auth helpers ──────────────────────────────────────────────────────────

async function getUser(
  req: Request,
  env: Env,
): Promise<(SessionPayload & { name: string }) | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  return verifySession(token, env);
}

// ─── Route helpers ─────────────────────────────────────────────────────────

interface Route {
  method: string;
  pattern: RegExp;
  handler: (
    req: Request,
    params: string[],
    base: { env: Env; origin: string | null; reqId: string; ip: string },
  ) => Promise<Response>;
}

/** Authenticated user, fresh from the database (so deletions and role
 *  changes apply immediately instead of at JWT expiry). */

// ─── Routes ────────────────────────────────────────────────────────────────

type Base = { env: Env; origin: string | null; reqId: string; ip: string };
type FullCtx = Base & { repo: Awaited<ReturnType<typeof getRepo>>; user: User };

async function needAuth(req: Request, base: Base, roles?: Role[]): Promise<FullCtx> {
  const sess = await getUser(req, base.env);
  if (!sess) throw new ApiError(401, "unauthenticated", "Please sign in");
  const repo = await getRepo(base.env.DB);
  const user = await repo.getUser(sess.sub);
  if (!user) throw new ApiError(401, "unauthenticated", "Your account no longer exists");
  // Server-side revocation: the token carries the auth_version at sign-in; a
  // bump on the account means "signed out everywhere" — reject stale tokens.
  if (sess.v !== undefined && sess.v !== user.authVersion) {
    throw new ApiError(
      401,
      "session_revoked",
      "Your session was signed out on another device. Please sign in again.",
    );
  }
  if (roles && !roles.includes(user.role)) {
    throw new ApiError(403, "forbidden", "You do not have permission to perform this action");
  }
  return { ...base, repo, user };
}

async function bodyOf<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const raw = await readJsonBody(req);
  const result = schema.safeParse(raw ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ApiError(
      400,
      "validation_error",
      `${first.path.join(".") || "body"}: ${first.message}`,
    );
  }
  return result.data;
}

/** Validate query-string parameters against a zod schema (the read-side twin
 *  of `bodyOf`). Empty parameters are dropped so `?courseId=` means "absent"
 *  rather than "empty string". */
async function queryOf<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (v !== "") raw[k] = v;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ApiError(
      400,
      "validation_error",
      `${first.path.join(".") || "query"}: ${first.message}`,
    );
  }
  return result.data;
}

/** Attribution for the audit trail: who, from where, in which request. Raw IPs
 *  and user-agents are never stored — only HMAC pointers. */
function auditCtx(req: Request, base: Base, user: User): AuditContext {
  return {
    actorId: user.id,
    actorRole: user.role,
    actorEmail: user.email,
    ip: base.ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
    reqId: base.reqId,
    secret: getJwtSecret(base.env),
  };
}

async function requireCourseOwnership(
  repo: FullCtx["repo"],
  user: User,
  courseId: string,
  opts: { allowEnrolledStudent?: boolean } = {},
): Promise<void> {
  if (user.role === "admin") return;
  const course = await repo.getCourse(courseId);
  if (!course) throw new ApiError(404, "not_found", "Course not found");
  if (course.lecturerId === user.id) return;
  // A student may read their own course (and, in the caller, only their own
  // rows); anybody else — including a lecturer who does not teach it — may not.
  if (opts.allowEnrolledStudent && user.role === "student") {
    const mine = await repo.studentCourses(user.id);
    if (mine.some((c) => c.id === courseId)) return;
  }
  throw new ApiError(403, "forbidden", "This course is not assigned to you");
}

const routes: Route[] = [
  // ── Health ──
  {
    method: "GET",
    pattern: /^\/api\/health$/,
    handler: async (_req, _p, base) => {
      await getRepo(base.env.DB);
      return jsonOk({ status: "ok", time: Date.now() });
    },
  },

  // ── Auth ──
  {
    method: "POST",
    pattern: /^\/api\/auth\/login$/,
    handler: async (req, _p, base) => {
      const data = await bodyOf(req, loginSchema);
      // Count only FAILED attempts: campuses sit behind NAT, so counting
      // every attempt would lock out legitimate users sharing one IP, while
      // brute-force guessing (which always fails) is still throttled.
      if (!limiter.peek(`login:${base.ip}`, DEFAULT_LIMITS.login.limit)) {
        throw new ApiError(
          429,
          "rate_limited",
          "Too many login attempts. Try again in a few minutes.",
        );
      }
      const repo = await getRepo(base.env.DB);
      const user = await repo.verifyCredentials(data.email, data.password);
      if (!user) {
        limiter.hit(`login:${base.ip}`, DEFAULT_LIMITS.login.limit, DEFAULT_LIMITS.login.windowMs);
        throw new ApiError(401, "invalid_credentials", "Invalid email or password");
      }
      const token = await signSession(
        { sub: user.id, role: user.role, name: user.name, v: user.authVersion },
        base.env,
      );
      console.log(
        JSON.stringify({ msg: "login", reqId: base.reqId, userId: user.id, ip: base.ip }),
      );
      return jsonOk({ token, expiresInSeconds: SESSION_TTL_SECONDS, user });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/refresh$/,
    handler: async (req, _p, base) => {
      // Slide a still-valid session forward (rolling session). Fresh user is
      // reloaded from the DB so revoked/deleted accounts can't be re-signed.
      const ctx = await needAuth(req, base);
      const token = await signSession(
        { sub: ctx.user.id, role: ctx.user.role, name: ctx.user.name, v: ctx.user.authVersion },
        base.env,
      );
      return jsonOk({ token, expiresInSeconds: SESSION_TTL_SECONDS });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/logout$/,
    handler: async (req, _p, base) => {
      // Revoke on the server too: bump the account's auth_version so a stolen
      // token can't keep signing in after a clean logout.
      const sess = await getUser(req, base.env);
      if (sess) {
        const repo = await getRepo(base.env.DB);
        await repo.revokeTokens(sess.sub);
      }
      return jsonOk({ ok: true });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/auth\/me$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base);
      return jsonOk(ctx.user);
    },
  },

  // ── Public / site settings ──
  {
    method: "GET",
    pattern: /^\/api\/public\/settings$/,
    handler: async (_req, _p, base) => {
      const repo = await getRepo(base.env.DB);
      return jsonOk(await repo.publicSettings());
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/settings$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base);
      return jsonOk(await ctx.repo.getSiteSettings());
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/settings$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, siteSettingsSchema);
      return jsonOk(await ctx.repo.saveSiteSettings(data));
    },
  },

  // ── Users ──
  {
    method: "GET",
    pattern: /^\/api\/users$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const role = new URL(req.url).searchParams.get("role");
      const valid: Role[] = ["admin", "lecturer", "student"];
      return jsonOk(
        await ctx.repo.listUsers(valid.includes(role as Role) ? (role as Role) : undefined),
      );
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/users$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, createUserSchema);
      const id = await ctx.repo.createUser(data);
      return jsonOk({ id }, { status: 201 });
    },
  },
  // NOTE: the specific /change-password and /profile routes must stay
  // BEFORE the generic /:id routes — route matching is first-match-wins.
  {
    method: "POST",
    pattern: /^\/api\/users\/change-password$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base);
      const data = await bodyOf(req, changePasswordSchema);
      await ctx.repo.changePassword(ctx.user.id, data.currentPassword, data.newPassword);
      return jsonOk({ ok: true });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/users\/profile$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base);
      const data = await bodyOf(req, profileSchema);
      const u = ctx.user;
      if (u.role === "student") {
        await ctx.repo.updateStudent(u.id, {
          name: data.name,
          email: data.email,
          matricNo: u.matricNo ?? "",
          departmentId: u.departmentId,
          level: u.level,
          password: data.password,
        });
      } else if (u.role === "lecturer") {
        await ctx.repo.updateLecturer(u.id, {
          name: data.name,
          email: data.email,
          staffId: u.staffId ?? "",
          departmentId: u.departmentId,
          password: data.password,
        });
      } else {
        await ctx.repo.updateAdmin(u.id, {
          name: data.name,
          email: data.email,
          password: data.password,
        });
      }
      return jsonOk({ ok: true });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/users\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, updateUserSchema);
      const target = await ctx.repo.getUser(p[0]);
      if (!target) throw new ApiError(404, "not_found", "User not found");
      if (target.role === "student") {
        await ctx.repo.updateStudent(target.id, data);
      } else if (target.role === "lecturer") {
        await ctx.repo.updateLecturer(target.id, data);
      } else {
        await ctx.repo.updateAdmin(target.id, {
          name: data.name,
          email: data.email,
          password: data.password,
        });
      }
      return jsonOk({ ok: true });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/users\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      await ctx.repo.deleteUser(p[0]);
      return jsonOk({ ok: true });
    },
  },

  // ── Departments ──
  {
    method: "GET",
    pattern: /^\/api\/departments$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base);
      return jsonOk(await ctx.repo.listDepartments());
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/departments$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, departmentSchema);
      return jsonOk(
        await ctx.repo.createDepartment(
          data.name,
          data.code,
          data.icon || undefined,
          data.color || undefined,
        ),
        { status: 201 },
      );
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/departments\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, departmentUpdateSchema);
      await ctx.repo.updateDepartment(
        p[0],
        data.name,
        data.code,
        data.icon || undefined,
        data.color || undefined,
      );
      return jsonOk({ ok: true });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/departments\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      await ctx.repo.deleteDepartment(p[0]);
      return jsonOk({ ok: true });
    },
  },

  // ── Courses ─
  {
    method: "GET",
    pattern: /^\/api\/courses$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base);
      return jsonOk(await ctx.repo.listCourses());
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/courses$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, courseSchema);
      return jsonOk(await ctx.repo.createCourse(data), { status: 201 });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/courses\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, courseUpdateSchema);
      const { id: _id, ...rest } = data;
      await ctx.repo.updateCourse(p[0], rest);
      return jsonOk({ ok: true });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/courses\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      await ctx.repo.deleteCourse(p[0]);
      return jsonOk({ ok: true });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/courses\/([^/]+)\/lecturer$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(
        req,
        z.object({ lecturerId: z.string().min(1).max(64).nullable() }),
      );
      await ctx.repo.assignLecturer(p[0], data.lecturerId);
      return jsonOk({ ok: true });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/courses\/([^/]+)\/venue$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(
        req,
        z.object({
          latitude: latSchema.optional(),
          longitude: lngSchema.optional(),
          radiusMeters: z.number().int().min(10).max(5000).optional(),
          clear: z.boolean().optional(),
        }),
      );
      if (data.clear) {
        await ctx.repo.setCourseVenue(p[0], null);
      } else {
        await ctx.repo.setCourseVenue(p[0], {
          latitude: data.latitude,
          longitude: data.longitude,
          radiusMeters: data.radiusMeters,
        });
      }
      return jsonOk({ ok: true });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/courses\/([^/]+)\/enrollments$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(
        req,
        z.object({ studentIds: z.array(z.string().min(1).max(64)).max(5000) }),
      );
      await ctx.repo.setEnrollments(p[0], data.studentIds);
      return jsonOk({ ok: true });
    },
  },

  // ── Sessions (lecturer) ──
  {
    method: "GET",
    pattern: /^\/api\/lecturer\/courses$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["lecturer"]);
      return jsonOk(await ctx.repo.lecturerCourses(ctx.user.id));
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/lecturer\/unassigned-courses$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["lecturer"]);
      return jsonOk(await ctx.repo.unassignedCoursesForLecturer(ctx.user.id));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/lecturer\/claim-course$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["lecturer"]);
      const data = await bodyOf(req, z.object({ courseId: idSchema }));
      const course = await ctx.repo.claimCourse(data.courseId, ctx.user.id);
      return jsonOk(course);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/sessions$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["lecturer"]);
      const data = await bodyOf(req, startSessionSchema);
      await requireCourseOwnership(ctx.repo, ctx.user, data.courseId);
      // Venue lock inheritance: a course with a default geofence applies it to
      // any session that didn't pin its own location (and never overrides an
      // explicit per-session geofence).
      const course = await ctx.repo.getCourse(data.courseId);
      const inherited =
        data.latitude == null && data.longitude == null && data.radiusMeters == null
          ? {
              latitude: course?.venueLat,
              longitude: course?.venueLng,
              radiusMeters: course?.venueRadius,
            }
          : { latitude: undefined, longitude: undefined, radiusMeters: undefined };
      const session = await ctx.repo.startSession({
        ...data,
        durationMinutes: data.durationMinutes ?? 15,
        codeIntervalSeconds: data.codeIntervalSeconds ?? undefined,
        seats: data.seats ?? undefined,
        autoEndEnabled: data.autoEndEnabled ?? true,
        lecturerId: ctx.user.id,
        latitude: data.latitude ?? inherited.latitude,
        longitude: data.longitude ?? inherited.longitude,
        radiusMeters: data.radiusMeters ?? inherited.radiusMeters,
      });
      return jsonOk(session, { status: 201 });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/sessions\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const detail = await ctx.repo.sessionDetail(p[0]);
      if (!detail) throw new ApiError(404, "not_found", "Session not found");
      if (ctx.user.role === "lecturer" && detail.session.lecturerId !== ctx.user.id) {
        throw new ApiError(403, "forbidden", "This session does not belong to you");
      }
      return jsonOk(detail);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/sessions\/([^/]+)\/end$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["lecturer", "admin"]);
      const session = await ctx.repo.getSession(p[0]);
      if (!session) throw new ApiError(404, "not_found", "Session not found");
      if (ctx.user.role === "lecturer" && session.lecturerId !== ctx.user.id) {
        throw new ApiError(403, "forbidden", "This session does not belong to you");
      }
      await ctx.repo.endSession(p[0]);
      return jsonOk({ ok: true });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/courses\/([^/]+)\/sessions$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      await requireCourseOwnership(ctx.repo, ctx.user, p[0]);
      return jsonOk(await ctx.repo.listSessionsForCourse(p[0]));
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/attendance\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const record = await ctx.repo.getAttendanceRecord(p[0]);
      if (!record) throw new ApiError(404, "not_found", "Attendance record not found");
      if (ctx.user.role === "lecturer") {
        const session = await ctx.repo.getSession(record.sessionId);
        if (!session || session.lecturerId !== ctx.user.id) {
          throw new ApiError(403, "forbidden", "This record belongs to a session you do not own");
        }
      }
      const data = await bodyOf(req, deleteAttendanceSchema);
      // Deleting a sign-in is the most destructive attendance action there is,
      // so it needs a reason (brief §9) and, inside a finalised period, an
      // explicit admin override.
      if (data.override && ctx.user.role !== "admin") {
        throw new ApiError(
          403,
          "forbidden",
          "Only an administrator can override a finalised period",
        );
      }
      const removed = await ctx.repo.deleteAttendanceRecord(p[0], {
        ...auditCtx(req, base, ctx.user),
        reason: data.reason,
        allowLocked: Boolean(data.override && ctx.user.role === "admin"),
      });
      if (record.studentId && record.studentId !== ctx.user.id) {
        await ctx.repo.notify({
          audience: { kind: "user", userId: record.studentId },
          kind: "attendance.voided",
          title: "An attendance record was withdrawn",
          body: `${ctx.user.name} withdrew your ${record.status} mark. Reason: ${data.reason}`,
          entityType: "attendance_record",
          entityId: p[0],
          href: `/student/courses/${record.courseId}`,
          courseId: record.courseId,
        });
      }
      return jsonOk({ ok: true, removed });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/attendance\/([^/]+)\/status$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const record = await ctx.repo.getAttendanceRecord(p[0]);
      if (!record) throw new ApiError(404, "not_found", "Attendance record not found");
      if (ctx.user.role === "lecturer") {
        const session = await ctx.repo.getSession(record.sessionId);
        if (!session || session.lecturerId !== ctx.user.id) {
          throw new ApiError(403, "forbidden", "This record belongs to a session you do not own");
        }
      }
      const data = await bodyOf(req, setAttendanceStatusSchema);
      const updated = await ctx.repo.setAttendanceStatus(p[0], data.status, {
        ...auditCtx(req, base, ctx.user),
        reason: data.reason,
        allowLocked: ctx.user.role === "admin",
      });
      // The student is told about the change to *their* record, with the reason
      // and who decided it — an unnoticed correction is indistinguishable from
      // a silent one (brief §9).
      if (record.studentId && record.studentId !== ctx.user.id) {
        await ctx.repo.notify({
          audience: { kind: "user", userId: record.studentId },
          kind: "attendance.corrected",
          title: `Attendance updated to ${data.status}`,
          body: `${ctx.user.name} changed your ${record.status} mark to ${data.status}. Reason: ${data.reason}`,
          entityType: "attendance_record",
          entityId: p[0],
          href: `/student/courses/${record.courseId}`,
          courseId: record.courseId,
        });
      }
      return jsonOk({ record: updated });
    },
  },

  // ── Recurring schedules (lecturer) ──
  {
    method: "GET",
    pattern: /^\/api\/schedules$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const courseId = new URL(req.url).searchParams.get("courseId") ?? undefined;
      // An administrator sees the whole institution's timetable; a lecturer sees
      // only their own series (the `lecturerId` argument is what scopes it, so it
      // is never taken from the query string).
      const lecturerId = ctx.user.role === "lecturer" ? ctx.user.id : undefined;
      return jsonOk(await ctx.repo.listSchedules(lecturerId, courseId));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/schedules$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["lecturer"]);
      const data = await bodyOf(req, scheduleSchema);
      await requireCourseOwnership(ctx.repo, ctx.user, data.courseId);
      // Inherit the course-level venue lock when the series has no own geofence.
      const course = await ctx.repo.getCourse(data.courseId);
      const inherited =
        data.latitude == null && data.longitude == null && data.radiusMeters == null
          ? {
              latitude: course?.venueLat,
              longitude: course?.venueLng,
              radiusMeters: course?.venueRadius,
            }
          : { latitude: undefined, longitude: undefined, radiusMeters: undefined };
      const schedule = await ctx.repo.createSchedule({
        courseId: data.courseId,
        lecturerId: ctx.user.id,
        durationMinutes: data.durationMinutes ?? 15,
        topic: data.topic,
        latitude: data.latitude ?? inherited.latitude,
        longitude: data.longitude ?? inherited.longitude,
        radiusMeters: data.radiusMeters ?? inherited.radiusMeters,
        codeIntervalSeconds: data.codeIntervalSeconds ?? undefined,
        seats: data.seats ?? undefined,
        recurrence: data.recurrence,
        daysMask: (data.days ?? []).sort((a, b) => a - b).join(","),
        minuteOfDay: data.minuteOfDay,
        tzOffsetMinutes: data.tzOffsetMinutes ?? 0,
        endsOn: data.endsOn ? data.endsOn * 1000 : undefined,
        maxOccurrences: data.maxOccurrences,
      });
      return jsonOk(schedule, { status: 201 });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/schedules\/([^/]+)\/enabled$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["lecturer", "admin"]);
      const schedule = await ctx.repo.getSchedule(p[0]);
      if (!schedule) throw new ApiError(404, "not_found", "Schedule not found");
      if (ctx.user.role === "lecturer" && schedule.lecturerId !== ctx.user.id) {
        throw new ApiError(403, "forbidden", "This schedule does not belong to you");
      }
      const data = await bodyOf(req, z.object({ enabled: z.boolean() }));
      await ctx.repo.setScheduleEnabled(p[0], data.enabled);
      return jsonOk({ ok: true });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/schedules\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["lecturer", "admin"]);
      const schedule = await ctx.repo.getSchedule(p[0]);
      if (!schedule) throw new ApiError(404, "not_found", "Schedule not found");
      if (ctx.user.role === "lecturer" && schedule.lecturerId !== ctx.user.id) {
        throw new ApiError(403, "forbidden", "This schedule does not belong to you");
      }
      await ctx.repo.deleteSchedule(p[0]);
      return jsonOk({ ok: true });
    },
  },

  // ── Student ──
  {
    method: "POST",
    pattern: /^\/api\/attendance$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["student"]);
      if (
        !limiter.hit(
          `att:${ctx.user.id}`,
          DEFAULT_LIMITS.attendance.limit,
          DEFAULT_LIMITS.attendance.windowMs,
        )
      ) {
        throw new ApiError(429, "rate_limited", "Too many sign-in attempts. Try again shortly.");
      }
      const data = await bodyOf(req, attendanceSchema);
      const geo = cfGeo(req);
      const result = await ctx.repo.submitAttendance({
        ...data,
        studentId: ctx.user.id,
        secret: getJwtSecret(base.env),
        network: {
          latParse: geo.latParse,
          lngParse: geo.lngParse,
          ip: base.ip || null,
          ua: req.headers.get("user-agent"),
          colo: geo.colo ?? null,
        },
      });
      // Forensic audit: log a block-level fingerprint (never the full IP) so
      // proxy-ring investigations have a join key.
      const uaPtr = await hashedPointer(
        getJwtSecret(base.env),
        req.headers.get("user-agent") ?? "",
      );
      console.log(
        JSON.stringify({
          msg: "attendance",
          reqId: base.reqId,
          userId: ctx.user.id,
          code: data.code,
          uaPtr,
          colo: geo.colo ?? null,
          gps: data.latitude != null,
        }),
      );
      return jsonOk(result);
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/me\/courses$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["student"]);
      return jsonOk(await ctx.repo.studentCourses(ctx.user.id));
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/me\/courses\/([^/]+)\/sessions$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["student"]);
      try {
        return jsonOk(await ctx.repo.studentCourseSessions(ctx.user.id, p[0]));
      } catch (e) {
        if (e instanceof Error && e.message === "Not enrolled in this course") {
          throw new ApiError(403, "forbidden", "You are not enrolled in this course");
        }
        throw e;
      }
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/me\/history$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["student"]);
      return jsonOk(await ctx.repo.studentHistory(ctx.user.id));
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/me\/open-sessions$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["student"]);
      return jsonOk(await ctx.repo.listOpenSessionsForStudent(ctx.user.id));
    },
  },

  // ── Reports ──
  {
    method: "GET",
    pattern: /^\/api\/reports\/course\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      await requireCourseOwnership(ctx.repo, ctx.user, p[0]);
      const filters = await queryOf(req, reportFilterSchema);
      const report = await ctx.repo.courseReport(p[0], filters);
      if (!report) throw new ApiError(404, "not_found", "Course not found");
      return jsonOk(report);
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/reports\/faculty$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      return jsonOk(await ctx.repo.facultyReport());
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/overview$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      return jsonOk(await ctx.repo.adminOverview());
    },
  },

  // ── Academic structure: faculties, sessions, semesters (plan §4.1) ──
  {
    method: "GET",
    pattern: /^\/api\/faculties$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base);
      return jsonOk(await ctx.repo.listFaculties());
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/faculties$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, facultySchema);
      const faculty = await ctx.repo.createFaculty(data);
      await recordAudit(
        ctx.repo,
        { action: "course.create", entityType: "faculty", entityId: faculty.id, after: faculty },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk(faculty, { status: 201 });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/faculties\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, facultySchema.partial());
      const faculty = await ctx.repo.updateFaculty(p[0], data);
      await recordAudit(
        ctx.repo,
        { action: "course.update", entityType: "faculty", entityId: p[0], after: faculty },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk(faculty);
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/faculties\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      await ctx.repo.deleteFaculty(p[0]);
      await recordAudit(
        ctx.repo,
        { action: "course.delete", entityType: "faculty", entityId: p[0] },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk({ ok: true });
    },
  },
  {
    // Attach (or detach) a department from a faculty — the link the brief's
    // faculty filter, faculty column and faculty roll-ups all read (plan §4.1).
    method: "PATCH",
    pattern: /^\/api\/departments\/([^/]+)\/faculty$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, z.object({ facultyId: z.string().trim().max(60).nullable() }));
      await ctx.repo.setDepartmentFaculty(p[0], data.facultyId);
      return jsonOk({ ok: true });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/academics\/period$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base);
      return jsonOk(await ctx.repo.academicPeriod());
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/academic-sessions$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, academicSessionSchema);
      const created = await ctx.repo.createAcademicSession(data);
      await recordAudit(
        ctx.repo,
        {
          action: "settings.update",
          entityType: "academic_session",
          entityId: created.id,
          after: created,
        },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk(created, { status: 201 });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/semesters$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, semesterSchema);
      const created = await ctx.repo.createSemester(data);
      await recordAudit(
        ctx.repo,
        { action: "settings.update", entityType: "semester", entityId: created.id, after: created },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk(created, { status: 201 });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/semesters\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, semesterUpdateSchema);
      // `null` from the client means "clear this date"; the repo models an
      // absent window as undefined.
      return jsonOk(
        await ctx.repo.updateSemester(p[0], {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.startsOn !== undefined ? { startsOn: data.startsOn ?? undefined } : {}),
          ...(data.endsOn !== undefined ? { endsOn: data.endsOn ?? undefined } : {}),
        }),
      );
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/semesters\/([^/]+)\/current$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      await ctx.repo.setCurrentSemester(p[0]);
      return jsonOk(await ctx.repo.academicPeriod());
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/semesters\/([^/]+)\/finalize$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      // Freezing the records is only half of publishing: the figures that were
      // announced are stored alongside them so the report stays reproducible
      // even after a later correction or a threshold change (plan P5.3).
      const { semester, snapshot } = await ctx.repo.finalizeSemesterWithSnapshot(p[0], ctx.user.id);
      await recordAudit(
        ctx.repo,
        {
          action: "semester.finalize",
          entityType: "semester",
          entityId: p[0],
          after: { semester, snapshotId: snapshot.id, totals: snapshot.totals },
        },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk({ ...semester, snapshot: { id: snapshot.id, createdAt: snapshot.createdAt } });
    },
  },

  // ── Attendance reports (brief §4 + §6) ──
  {
    method: "GET",
    pattern: /^\/api\/reports\/courses$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const filters = await queryOf(req, reportFilterSchema);
      // Lecturers may only report on their own courses, whatever they ask for.
      if (ctx.user.role === "lecturer") filters.lecturerId = ctx.user.id;
      return jsonOk(await ctx.repo.coursesReport(filters));
    },
  },
  {
    // Institution-wide lecture register (P4.2). Lecturers are pinned to their own
    // lectures the same way every other report is, so the page cannot be used to
    // read another lecturer's rosters.
    method: "GET",
    pattern: /^\/api\/reports\/sessions$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const filters = await queryOf(req, reportFilterSchema);
      if (ctx.user.role === "lecturer") filters.lecturerId = ctx.user.id;
      return jsonOk(await ctx.repo.sessionRegister(filters));
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/reports\/courses\/([^/]+)\/sessions$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      await requireCourseOwnership(ctx.repo, ctx.user, p[0]);
      const filters = await queryOf(req, reportFilterSchema);
      return jsonOk(await ctx.repo.courseSessionStats(p[0], filters));
    },
  },
  {
    // One student's lecture-by-lecture history inside one course (brief §5:
    // "each student's attendance history"). Same maths the student sees on their
    // own page, so an administrator and the student read identical numbers.
    method: "GET",
    pattern: /^\/api\/reports\/courses\/([^/]+)\/students\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      await requireCourseOwnership(ctx.repo, ctx.user, p[0]);
      const rows = await ctx.repo.studentCourseSessions(p[1], p[0]);
      const present = rows.filter((r) => r.status === "present").length;
      const late = rows.filter((r) => r.status === "late").length;
      const excused = rows.filter((r) => r.status === "excused").length;
      const absent = rows.filter((r) => r.status === "absent").length;
      return jsonOk({ rows, summary: { present, late, excused, absent, total: rows.length } });
    },
  },

  // ── Examinations & results (plan §4.4 / P4.3) ──
  {
    method: "GET",
    pattern: /^\/api\/exams$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer", "student"]);
      const url = new URL(req.url);
      const courseId = url.searchParams.get("courseId") ?? undefined;
      const semesterId = url.searchParams.get("semesterId") ?? undefined;
      if (courseId) await requireCourseOwnership(ctx.repo, ctx.user, courseId);
      if (ctx.user.role === "student") {
        // A student sees exams for courses they are enrolled in, and only once
        // the results are published — an exam that exists is not yet news.
        const mine = await ctx.repo.studentCourses(ctx.user.id);
        const allowed = new Set(mine.map((c) => c.id));
        const exams = (await ctx.repo.listExams(courseId, semesterId)).filter(
          (e) => allowed.has(e.courseId) && (e.published || !courseId),
        );
        return jsonOk(exams.map((e) => (e.published ? e : { ...e, marked: undefined })));
      }
      if (ctx.user.role === "lecturer") {
        const own = (await ctx.repo.listCourses()).filter((c) => c.lecturerId === ctx.user.id);
        const allowed = new Set(own.map((c) => c.id));
        return jsonOk(
          (await ctx.repo.listExams(courseId, semesterId)).filter((e) => allowed.has(e.courseId)),
        );
      }
      return jsonOk(await ctx.repo.listExams(courseId, semesterId));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/exams$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const data = await bodyOf(req, examSchema);
      await requireCourseOwnership(ctx.repo, ctx.user, data.courseId);
      const exam = await ctx.repo.createExam({
        ...data,
        weight: data.weight ?? undefined,
        scheduledAt: data.scheduledAt ?? undefined,
        durationMinutes: data.durationMinutes ?? undefined,
        venue: data.venue || undefined,
        room: data.room || undefined,
        createdBy: ctx.user.id,
      });
      await recordAudit(
        ctx.repo,
        {
          action: "exam.create",
          entityType: "exam",
          entityId: exam.id,
          courseId: exam.courseId,
          semesterId: exam.semesterId ?? null,
          after: exam,
        },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk(exam, { status: 201 });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/exams\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer", "student"]);
      const exam = await ctx.repo.getExam(p[0]);
      if (!exam) throw new ApiError(404, "not_found", "Exam not found");
      await requireCourseOwnership(ctx.repo, ctx.user, exam.courseId, {
        allowEnrolledStudent: ctx.user.role === "student",
      });
      const results = await ctx.repo.listResults(exam.id);
      if (ctx.user.role === "student") {
        if (!exam.published) {
          throw new ApiError(403, "forbidden", "These results have not been published yet");
        }
        return jsonOk({
          exam,
          results: results.filter((r) => r.studentId === ctx.user.id),
        });
      }
      return jsonOk({ exam, results });
    },
  },
  {
    method: "PATCH",
    pattern: /^\/api\/exams\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const exam = await ctx.repo.getExam(p[0]);
      if (!exam) throw new ApiError(404, "not_found", "Exam not found");
      await requireCourseOwnership(ctx.repo, ctx.user, exam.courseId);
      const data = await bodyOf(req, examUpdateSchema);
      // Publishing releases marks to students, so only an administrator may do it
      // (a lecturer cannot un-publish a bad result to hide it either).
      if (data.published !== undefined && ctx.user.role !== "admin") {
        throw new ApiError(
          403,
          "forbidden",
          "Only an administrator can publish or unpublish results",
        );
      }
      const updated = await ctx.repo.updateExam(p[0], data);
      await recordAudit(
        ctx.repo,
        {
          action: "exam.update",
          entityType: "exam",
          entityId: p[0],
          courseId: exam.courseId,
          before: exam,
          after: updated,
        },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk(updated);
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/exams\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const exam = await ctx.repo.getExam(p[0]);
      if (!exam) throw new ApiError(404, "not_found", "Exam not found");
      const removed = await ctx.repo.deleteExam(p[0]);
      await recordAudit(
        ctx.repo,
        {
          action: "exam.delete",
          entityType: "exam",
          entityId: p[0],
          courseId: exam.courseId,
          before: exam,
          reason: `Deleted an exam and ${removed} mark(s)`,
        },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk({ ok: true, removed });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/exams\/([^/]+)\/results$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const exam = await ctx.repo.getExam(p[0]);
      if (!exam) throw new ApiError(404, "not_found", "Exam not found");
      await requireCourseOwnership(ctx.repo, ctx.user, exam.courseId);
      return jsonOk({ exam, results: await ctx.repo.listResults(exam.id) });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/exams\/([^/]+)\/results$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const exam = await ctx.repo.getExam(p[0]);
      if (!exam) throw new ApiError(404, "not_found", "Exam not found");
      await requireCourseOwnership(ctx.repo, ctx.user, exam.courseId);
      const data = await bodyOf(req, resultsSchema);
      const outOfRange = data.rows.find((r) => r.score != null && r.score > exam.maxScore);
      if (outOfRange) {
        throw new ApiError(
          400,
          "validation_error",
          `A score of ${outOfRange.score} exceeds the maximum of ${exam.maxScore}`,
        );
      }
      const { saved, cleared } = await ctx.repo.saveResults(
        p[0],
        data.rows.map((r) => ({
          studentId: r.studentId,
          score: r.score,
          grade: r.grade || undefined,
        })),
        ctx.user.id,
      );
      await recordAudit(
        ctx.repo,
        {
          action: "result.save",
          entityType: "exam",
          entityId: p[0],
          courseId: exam.courseId,
          semesterId: exam.semesterId ?? null,
          after: { saved, cleared, maxScore: exam.maxScore },
          reason: `${saved} mark(s) recorded, ${cleared} cleared`,
        },
        auditCtx(req, base, ctx.user),
      );
      // Students only learn about a mark once it is published; notifying earlier
      // would leak an unpublished result.
      if (exam.published) {
        for (const row of data.rows) {
          if (row.score == null) continue;
          await ctx.repo.notify({
            audience: { kind: "user", userId: row.studentId },
            kind: "result.published",
            title: `${exam.title}: ${row.score}/${exam.maxScore}`,
            body: `Your mark for ${exam.title} is available.`,
            entityType: "exam",
            entityId: exam.id,
            href: `/student/results`,
            courseId: exam.courseId,
          });
        }
      }
      return jsonOk({ ok: true, saved, cleared });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/exams\/([^/]+)\/results\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const exam = await ctx.repo.getExam(p[0]);
      if (!exam) throw new ApiError(404, "not_found", "Exam not found");
      await requireCourseOwnership(ctx.repo, ctx.user, exam.courseId);
      const removed = await ctx.repo.deleteResult(p[0], p[1]);
      if (!removed) throw new ApiError(404, "not_found", "No mark recorded for that student");
      await recordAudit(
        ctx.repo,
        {
          action: "result.delete",
          entityType: "exam",
          entityId: p[0],
          courseId: exam.courseId,
          reason: "Mark withdrawn",
        },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk({ ok: true });
    },
  },
  {
    // Attendance × performance for one course (plan P4.4).
    method: "GET",
    pattern: /^\/api\/reports\/courses\/([^/]+)\/analytics$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      await requireCourseOwnership(ctx.repo, ctx.user, p[0]);
      const filters = await queryOf(req, reportFilterSchema);
      const analytics = await ctx.repo.resultAnalytics(p[0], filters);
      if (!analytics) throw new ApiError(404, "not_found", "Course not found");
      return jsonOk(analytics);
    },
  },

  // ── Bulk import (plan P5.4 / decision D8) ──
  {
    // A downloadable template, so the registrar's file matches the importer
    // rather than the importer guessing at theirs.
    method: "GET",
    pattern: /^\/api\/import\/template$/,
    handler: async (req, _p, base) => {
      await needAuth(req, base, ["admin", "lecturer"]);
      const kind = (new URL(req.url).searchParams.get("kind") ?? "students") as ImportKind;
      if (!["students", "lecturers", "enrollments", "results"].includes(kind)) {
        throw new ApiError(400, "validation_error", "Unknown import kind");
      }
      const header = templateColumns(kind);
      const sample: Record<ImportKind, string[][]> = {
        students: [["Ada Obi", "ada.obi@slams.edu", "CSC/22/0001", "CSC", "200"]],
        lecturers: [["Dr. Grace Adeyemi", "grace.adeyemi@slams.edu", "STF/0007", "EEE"]],
        enrollments: [["CSC/22/0001"], ["CSC/22/0002"]],
        results: [
          ["CSC/22/0001", "68"],
          ["CSC/22/0002", "54"],
        ],
      };
      const body = toCsv(header, sample[kind]);
      return new Response(body, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="slams-${kind}-template.csv"`,
          ...corsHeaders(base.origin, allowedOrigins(base.env)),
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/import\/preview$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const data = await bodyOf(req, importSchema);
      if (data.courseId) await requireCourseOwnership(ctx.repo, ctx.user, data.courseId);
      if (data.examId) {
        const exam = await ctx.repo.getExam(data.examId);
        if (!exam) throw new ApiError(404, "not_found", "Exam not found");
        await requireCourseOwnership(ctx.repo, ctx.user, exam.courseId);
      }
      return jsonOk(await previewImport(ctx.repo, data));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/import\/apply$/,
    handler: async (req, _p, base) => {
      // Creating accounts is an administrative action: a lecturer may import
      // marks for their own course, but not people.
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const data = await bodyOf(req, importSchema);
      if (data.kind !== "results" && ctx.user.role !== "admin") {
        throw new ApiError(
          403,
          "forbidden",
          "Only an administrator can import people or enrolments",
        );
      }
      if (data.courseId) await requireCourseOwnership(ctx.repo, ctx.user, data.courseId);
      if (data.examId) {
        const exam = await ctx.repo.getExam(data.examId);
        if (!exam) throw new ApiError(404, "not_found", "Exam not found");
        await requireCourseOwnership(ctx.repo, ctx.user, exam.courseId);
      }
      let result: ImportApplyResult;
      try {
        result = await applyImport(ctx.repo, data);
      } catch (error) {
        throw new ApiError(
          400,
          "validation_error",
          error instanceof Error ? error.message : "The import could not be applied",
        );
      }
      await recordAudit(
        ctx.repo,
        {
          action: "import.apply",
          entityType: "import",
          entityId: data.kind,
          courseId: data.courseId ?? null,
          after: result,
          reason: `${data.kind}: ${result.created} created, ${result.linked} linked, ${result.skipped} skipped`,
        },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk(result);
    },
  },

  // ── Published period snapshots (plan §4.3 / P5.3) ──
  {
    method: "GET",
    pattern: /^\/api\/snapshots$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const url = new URL(req.url);
      return jsonOk(
        await ctx.repo.listSnapshots(
          url.searchParams.get("scope") ?? undefined,
          url.searchParams.get("entityId") ?? undefined,
        ),
      );
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/snapshots\/([^/]+)$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const snapshot = await ctx.repo.getSnapshot(p[0]);
      if (!snapshot) throw new ApiError(404, "not_found", "Snapshot not found");
      return jsonOk(snapshot);
    },
  },
  {
    // Record the exact payload of a report the user is publishing/exporting, so
    // the audit trail can name the figures as well as the fact.
    method: "POST",
    pattern: /^\/api\/snapshots$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const data = await bodyOf(req, snapshotSchema);
      const snapshot = await ctx.repo.createSnapshot({
        ...data,
        payload: data.payload ?? null,
        createdBy: ctx.user.id,
      });
      await recordAudit(
        ctx.repo,
        {
          action: "snapshot.create",
          entityType: "report",
          entityId: snapshot.id,
          semesterId: data.scope === "semester" ? (data.entityId ?? null) : null,
          after: { scope: data.scope, label: data.label, totals: data.totals ?? null },
          reason: data.label,
        },
        auditCtx(req, base, ctx.user),
      );
      return jsonOk(snapshot, { status: 201 });
    },
  },

  // ── Notifications (plan §4.5 / P4.5) ──
  {
    // Scoped to the caller by construction: there is no way to read somebody
    // else's inbox, which is why no role list is needed here.
    method: "GET",
    pattern: /^\/api\/notifications$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer", "student"]);
      const url = new URL(req.url);
      return jsonOk(
        await ctx.repo.notificationsFor(ctx.user.id, {
          page: url.searchParams.get("page") ? Number(url.searchParams.get("page")) : undefined,
          pageSize: url.searchParams.get("pageSize")
            ? Number(url.searchParams.get("pageSize"))
            : undefined,
          unreadOnly: url.searchParams.get("unreadOnly") === "1",
        }),
      );
    },
  },
  {
    // The bell polls this, so it stays deliberately tiny.
    method: "GET",
    pattern: /^\/api\/notifications\/summary$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer", "student"]);
      return jsonOk({ unread: await ctx.repo.unreadNotificationCount(ctx.user.id) });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/notifications\/read-all$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer", "student"]);
      return jsonOk({ marked: await ctx.repo.markAllNotificationsRead(ctx.user.id) });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/notifications\/([^/]+)\/read$/,
    handler: async (req, p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer", "student"]);
      const ok = await ctx.repo.markNotificationRead(ctx.user.id, p[0]);
      if (!ok) throw new ApiError(404, "not_found", "Notification not found");
      return jsonOk({ ok: true });
    },
  },

  // ── Audit trail (read-only by design — plan §4.6) ──
  {
    method: "GET",
    pattern: /^\/api\/audit$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin"]);
      const query = await queryOf(req, auditQuerySchema);
      return jsonOk(await ctx.repo.listAudit(query));
    },
  },
  {
    // Recorded when a client finishes generating a report, so an institution can
    // answer "who exported the attendance data, and with which filters?" — the
    // brief's §9 requirement that exports respect access permissions has an
    // auditable counterpart here.
    method: "POST",
    pattern: /^\/api\/reports\/exports$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const data = await bodyOf(req, exportAuditSchema);
      await recordAudit(
        ctx.repo,
        {
          action: "export.generate",
          entityType: "report",
          entityId: null,
          courseId: data.courseId ?? null,
          after: {
            format: data.format,
            scope: data.scope,
            rowCount: data.rowCount ?? null,
            filters: data.filters ?? null,
          },
          reason: data.title ?? null,
        },
        auditCtx(req, base, ctx.user),
      );
      // A finished export is an event the requester may have walked away from:
      // the bell is where they find out it is ready (and what it contained).
      await ctx.repo.notify({
        audience: { kind: "user", userId: ctx.user.id },
        kind: "export.ready",
        title: `${data.format.toUpperCase()} export ready — ${data.scope}`,
        body:
          data.rowCount != null
            ? `${data.rowCount} row(s) included. Filters: ${data.title ?? "none"}.`
            : `Filters: ${data.title ?? "none"}.`,
        entityType: "report",
        entityId: data.courseId ?? null,
        href: "/admin/reports",
        courseId: data.courseId ?? null,
      });
      return jsonOk({ ok: true });
    },
  },
];

// ─── Entry point ───────────────────────────────────────────────────────────

/** Runs the lifecycle housekeeping that would otherwise need a cron: close
 *  expired sessions and materialize due recurring legs. Called from fetch()
 *  at most once per minute (cheap in local dev / cron-less deployments) and
 *  from the scheduled() cron trigger in production. */
let lastHousekeepingRun = 0;
async function housekeeping(env: Env): Promise<void> {
  const now = Date.now();
  if (now - lastHousekeepingRun < 60_000) return;
  lastHousekeepingRun = now;
  try {
    const repo = await getRepo(env.DB);
    const [closed, started] = await Promise.all([
      repo.closeExpiredSessions(),
      repo.materializeSchedules(now),
    ]);
    // Heal lectures that closed before their roster tally was written (feature
    // rollout, an interrupted close, a migration still rolling out). Bounded per
    // tick so a busy institution can never turn housekeeping into a backfill.
    const backfilled = await repo.backfillAbsences(5);
    if (closed > 0 || started > 0 || backfilled > 0) {
      console.log(
        JSON.stringify({
          msg: "housekeeping",
          closed,
          started_schedules: started,
          absences_backfilled: backfilled,
        }),
      );
    }
  } catch (e) {
    console.error(JSON.stringify({ msg: "housekeeping_error" }), e);
  }
}

// Minimal local type for the Cron Trigger controller (the @cloudflare/workers-types
// global is not in this project's tsc `types` array, so define the surface we use).
interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry: (err?: Error) => void;
}

export default {
  // Cloudflare Cron Trigger entrypoint. Configure in wrangler.toml:
  //   [triggers] crons = ["*/15 * * * *"]
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await housekeeping(env);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const reqId = requestId();
    const origin = request.headers.get("origin");
    const allowed = allowedOrigins(env);
    const ip = clientIp(request);
    const base: Base = { env, origin, reqId, ip };
    const started = Date.now();

    // Lag-tolerant lifecycle tick: keeps schedules/expiry honest even when a
    // cron trigger isn't configured yet (local dev, pre-deploy previews).
    void housekeeping(env);

    if (!url.pathname.startsWith("/api/")) {
      return withHeaders(jsonError(404, "not_found", "Not found"), corsHeaders(origin, allowed));
    }

    if (request.method === "OPTIONS") {
      if (!originAllowed(origin, allowed)) {
        return withHeaders(jsonError(403, "cors_denied", "Origin not allowed"), {
          "access-control-allow-origin": "null",
        });
      }
      return withHeaders(new Response(null, { status: 204 }), corsHeaders(origin, allowed));
    }

    if (origin && !originAllowed(origin, allowed)) {
      if (!corsWarned) {
        console.warn(
          `[slams] CORS: origin "${origin}" not in ALLOWED_ORIGINS. Add it to the ALLOWED_ORIGINS worker var.`,
        );
        corsWarned = true;
      }
      return withHeaders(jsonError(403, "cors_denied", "Origin not allowed"));
    }

    // Global rate limits.
    const authedUser = (await getUser(request, env)) as { sub?: string } | null;
    if (authedUser?.sub) {
      if (
        !limiter.hit(
          `authed:${authedUser.sub}`,
          DEFAULT_LIMITS.authedApi.limit,
          DEFAULT_LIMITS.authedApi.windowMs,
        )
      ) {
        return withHeaders(
          jsonError(429, "rate_limited", "Too many requests. Try again shortly."),
          corsHeaders(origin, allowed),
        );
      }
    } else if (
      !limiter.hit(`pub:${ip}`, DEFAULT_LIMITS.publicApi.limit, DEFAULT_LIMITS.publicApi.windowMs)
    ) {
      return withHeaders(
        jsonError(429, "rate_limited", "Too many requests. Try again shortly."),
        corsHeaders(origin, allowed),
      );
    }

    try {
      const route = routes.find((r) => r.method === request.method && r.pattern.test(url.pathname));
      if (!route) {
        return withHeaders(jsonError(404, "not_found", "Not found"), corsHeaders(origin, allowed));
      }
      const params = url.pathname.match(route.pattern)!.slice(1);
      const response = await route.handler(request, params, base);
      const ms = Date.now() - started;
      console.log(
        JSON.stringify({
          msg: "request",
          reqId,
          ip,
          method: request.method,
          path: url.pathname,
          status: response.status,
          ms,
        }),
      );
      return withHeaders(response, corsHeaders(origin, allowed));
    } catch (e) {
      const ms = Date.now() - started;
      if (e instanceof ApiError) {
        console.log(
          JSON.stringify({
            msg: "request",
            reqId,
            ip,
            method: request.method,
            path: url.pathname,
            status: e.status,
            ms,
            code: e.code,
          }),
        );
        return withHeaders(jsonError(e.status, e.code, e.message), corsHeaders(origin, allowed));
      }
      if (e instanceof BusinessError) {
        console.log(
          JSON.stringify({
            msg: "request",
            reqId,
            ip,
            method: request.method,
            path: url.pathname,
            status: 400,
            ms,
            code: "business_error",
          }),
        );
        return withHeaders(
          jsonError(400, "business_error", e.message),
          corsHeaders(origin, allowed),
        );
      }
      console.error(
        JSON.stringify({
          msg: "request_error",
          reqId,
          ip,
          method: request.method,
          path: url.pathname,
          ms,
        }),
        e,
      );
      return withHeaders(
        jsonError(500, "internal_error", "Something went wrong. Please try again."),
        corsHeaders(origin, allowed),
      );
    } finally {
      limiter.maybePrune();
    }
  },
};
