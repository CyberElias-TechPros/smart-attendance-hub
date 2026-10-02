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
import { BusinessError } from "./errors";
import { ApiError, clientIp, jsonError, jsonOk, readJsonBody } from "./http";
import { DEFAULT_LIMITS, FixedWindowLimiter } from "./rate-limit";
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

async function requireCourseOwnership(
  repo: FullCtx["repo"],
  user: User,
  courseId: string,
): Promise<void> {
  if (user.role === "admin") return;
  const course = await repo.getCourse(courseId);
  if (!course) throw new ApiError(404, "not_found", "Course not found");
  if (course.lecturerId !== user.id) {
    throw new ApiError(403, "forbidden", "This course is not assigned to you");
  }
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
      await ctx.repo.deleteAttendanceRecord(p[0]);
      return jsonOk({ ok: true });
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
      await ctx.repo.setAttendanceStatus(p[0], data.status);
      return jsonOk({ ok: true });
    },
  },

  // ── Recurring schedules (lecturer) ──
  {
    method: "GET",
    pattern: /^\/api\/schedules$/,
    handler: async (req, _p, base) => {
      const ctx = await needAuth(req, base, ["admin", "lecturer"]);
      const courseId = new URL(req.url).searchParams.get("courseId") ?? undefined;
      return jsonOk(await ctx.repo.listSchedules(ctx.user.id, courseId));
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
      const report = await ctx.repo.courseReport(p[0]);
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
    if (closed > 0 || started > 0) {
      console.log(JSON.stringify({ msg: "housekeeping", closed, started_schedules: started }));
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
