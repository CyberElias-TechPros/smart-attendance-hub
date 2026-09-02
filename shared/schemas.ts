// Shared request/response contract between the Cloudflare Worker API and the
// Vercel-hosted frontend. Both sides import these schemas so the contract can
// never silently drift: the Worker validates input with them at the trust
// boundary, and the frontend derives its TypeScript types from them.

import { z } from "zod";

export const ROLES = ["admin", "lecturer", "student"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = (typeof ROLES)[number];

// ── Primitives ──────────────────────────────────────────────────────────────

export const idSchema = z.string().min(1).max(64);
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254);
/**
 * Password policy, enforced by the API and mirrored by the account settings UI.
 * Length does the heavy lifting; the character classes stop the most obvious
 * weak choices without pushing users towards unmemorable passwords.
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200, "Password is too long")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/\d/, "Password must contain a number");
export const nameSchema = z.string().trim().min(2, "Name is too short").max(120);
export const levelSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{3}$/, "Level must be like 100, 200, 300");
export const matricSchema = z.string().trim().min(2).max(40);
export const staffIdSchema = z.string().trim().min(2).max(40);
export const courseCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, "Course code is too short")
  .max(16);
export const deptCodeSchema = z.string().trim().toUpperCase().min(2).max(10);
export const attendanceCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, "Attendance codes are 6 digits");

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).optional(),
  dir: z.enum(["asc", "desc"]).default("asc"),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(200),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: nameSchema,
  email: emailSchema,
});

// ── Users ───────────────────────────────────────────────────────────────────

export const listUsersSchema = paginationSchema.extend({
  role: roleSchema.optional(),
  departmentId: idSchema.optional(),
  level: z.string().trim().max(8).optional(),
});

export const createStudentSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  matricNo: matricSchema,
  departmentId: idSchema,
  level: levelSchema,
  password: passwordSchema,
});

export const updateStudentSchema = createStudentSchema
  .extend({ password: passwordSchema.optional().or(z.literal("")) })
  .extend({ id: idSchema });

export const createLecturerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  staffId: staffIdSchema,
  departmentId: idSchema,
  password: passwordSchema,
});

export const updateLecturerSchema = createLecturerSchema
  .extend({ password: passwordSchema.optional().or(z.literal("")) })
  .extend({ id: idSchema });

export const idParamSchema = z.object({ id: idSchema });

// ── Departments ─────────────────────────────────────────────────────────────

export const departmentInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: deptCodeSchema,
  icon: z.string().trim().max(40).optional().nullable(),
  color: z.string().trim().max(64).optional().nullable(),
});
export const updateDepartmentSchema = departmentInputSchema.extend({ id: idSchema });

// ── Courses ─────────────────────────────────────────────────────────────────

export const courseInputSchema = z.object({
  code: courseCodeSchema,
  title: z.string().trim().min(2).max(160),
  departmentId: idSchema,
  level: levelSchema,
  units: z.coerce.number().int().min(1).max(12),
  icon: z.string().trim().max(40).optional().nullable(),
  color: z.string().trim().max(64).optional().nullable(),
  category: z.string().trim().max(40).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
});
export const updateCourseSchema = courseInputSchema.extend({ id: idSchema });

export const assignLecturerSchema = z.object({
  courseId: idSchema,
  lecturerId: idSchema.nullable(),
});

export const enrollStudentsSchema = z.object({
  courseId: idSchema,
  studentIds: z.array(idSchema).max(2000),
});

// ── Sessions ────────────────────────────────────────────────────────────────

export const startSessionSchema = z
  .object({
    courseId: idSchema,
    durationMinutes: z.coerce.number().int().min(1).max(240).default(15),
    topic: z.string().trim().max(160).optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    radiusMeters: z.coerce.number().int().min(10).max(5000).optional(),
  })
  .refine(
    (v) =>
      (v.latitude == null && v.longitude == null) || (v.latitude != null && v.longitude != null),
    { message: "Latitude and longitude must be provided together", path: ["latitude"] },
  )
  .refine((v) => v.radiusMeters == null || v.latitude != null, {
    message: "A geofence radius needs a venue location",
    path: ["radiusMeters"],
  });

export const sessionIdSchema = z.object({ sessionId: idSchema });
export const courseIdSchema = z.object({ courseId: idSchema });

export const submitAttendanceSchema = z.object({
  code: attendanceCodeSchema,
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
});

export const markAttendanceSchema = z.object({
  sessionId: idSchema,
  studentId: idSchema,
});

export const recordIdSchema = z.object({ recordId: idSchema });

// ── Site settings ───────────────────────────────────────────────────────────

export const testimonialSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(400),
});

export const siteSettingsSchema = z.object({
  institutionName: z.string().trim().min(1).max(120).optional(),
  atRiskThreshold: z.coerce.number().int().min(0).max(100).optional(),
  marqueeItems: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  testimonials: z.array(testimonialSchema).max(20).optional(),
  demoAccountsEnabled: z.boolean().optional(),
  demoEmailDomain: z.string().trim().max(120).optional(),
  showFakeStats: z.boolean().optional(),
  primaryColor: z.string().trim().max(64).nullable().optional(),
  contactEmail: z.string().trim().email().max(254).nullable().optional().or(z.literal("")),
});

// ── Audit ───────────────────────────────────────────────────────────────────

export const listAuditSchema = paginationSchema.extend({
  action: z.string().trim().max(60).optional(),
  actorId: idSchema.optional(),
});

// ── Domain response types ───────────────────────────────────────────────────

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  matricNo?: string;
  staffId?: string;
  departmentId?: string;
  departmentName?: string;
  level?: string;
  createdAt: number;
  lastLoginAt?: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  icon?: string;
  color?: string;
  courseCount: number;
  studentCount: number;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  departmentId: string;
  departmentName?: string;
  level: string;
  units: number;
  lecturerId?: string;
  lecturerName?: string;
  enrolledStudentIds: string[];
  enrolledCount: number;
  sessionCount: number;
  icon?: string;
  color?: string;
  category?: string;
  description?: string;
  archivedAt?: number;
}

export interface AttendanceSession {
  id: string;
  courseId: string;
  courseCode?: string;
  courseTitle?: string;
  lecturerId: string;
  code: string;
  startedAt: number;
  expiresAt: number;
  endedAt?: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  topic?: string;
  attendedCount?: number;
  enrolledCount?: number;
}

export interface SessionDetail {
  session: AttendanceSession;
  course: Pick<Course, "id" | "code" | "title" | "level" | "units">;
  totalEnrolled: number;
  attendance: Array<{
    id: string;
    studentId: string;
    name: string;
    matricNo: string;
    timestamp: number;
    method: string;
  }>;
  absentees: Array<{ id: string; name: string; matricNo: string }>;
}

export interface StudentCourseView extends Course {
  totalSessions: number;
  attendedSessions: number;
  percentage: number;
}

export interface CourseReport {
  course: { id: string; code: string; title: string; level: string; units: number };
  totalSessions: number;
  sessions: AttendanceSession[];
  students: Array<{
    id: string;
    name: string;
    matricNo: string;
    attended: number;
    percentage: number;
  }>;
}

export interface FacultyReport {
  courses: Array<{
    id: string;
    code: string;
    title: string;
    enrolled: number;
    sessions: number;
    avg: number;
  }>;
  students: Array<{
    id: string;
    name: string;
    matricNo: string;
    courses: number;
    attended: number;
    total: number;
    percentage: number;
  }>;
}

export interface AdminOverview {
  counts: {
    students: number;
    lecturers: number;
    courses: number;
    departments: number;
    sessions: number;
    attendance: number;
    liveSessions: number;
  };
  recentSessions: Array<{
    id: string;
    courseCode: string;
    startedAt: number;
    endedAt?: number;
    attended: number;
    enrolled: number;
  }>;
  weeklyAttendance: Array<{ label: string; count: number }>;
}

export interface SiteSettings {
  id: string;
  institutionName: string;
  atRiskThreshold: number;
  marqueeItems: string[];
  testimonials: Array<z.infer<typeof testimonialSchema>>;
  demoAccountsEnabled: boolean;
  demoEmailDomain: string;
  showFakeStats: boolean;
  primaryColor?: string | null;
  contactEmail?: string | null;
}

export interface AuditEntry {
  id: string;
  actorId?: string;
  actorRole?: string;
  actorName?: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

// ── Error contract ──────────────────────────────────────────────────────────

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "LOCKED",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Field-level messages for VALIDATION_ERROR. */
    fields?: Record<string, string>;
    requestId?: string;
  };
}
