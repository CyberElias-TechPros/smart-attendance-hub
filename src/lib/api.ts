// Typed browser client for the Cloudflare Worker API.
//
// Requests go to a relative `/api/...` path in production: `vercel.json` rewrites
// them to the Worker, so the browser sees a same-origin call. That avoids
// third-party-cookie restrictions entirely and keeps CORS out of the hot path.
// `VITE_API_BASE_URL` can point directly at a Worker for local development.

import type {
  AdminOverview,
  ApiErrorBody,
  AttendanceSession,
  AuditEntry,
  Course,
  CourseReport,
  Department,
  ErrorCode,
  FacultyReport,
  Page,
  PublicUser,
  SessionDetail,
  SiteSettings,
  StudentCourseView,
} from "../../shared/schemas";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const CSRF_COOKIE = "slams_csrf";
const CSRF_HEADER = "x-slams-csrf";

/** Error surfaced to UI code, carrying the machine-readable code and field errors. */
export class ApiClientError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK_ERROR",
    message: string,
    readonly fields?: Record<string, string>,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  get isAuthError(): boolean {
    return this.code === "UNAUTHENTICATED";
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal } = options;
  const url = new URL(`${API_BASE}${path}`, typeof window === "undefined" ? "http://localhost" : window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    // Double-submit CSRF token; the cookie is readable, the session cookie is not.
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiClientError(
      "NETWORK_ERROR",
      "We couldn't reach the server. Check your connection and try again.",
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | undefined;
    throw new ApiClientError(
      errorBody?.error?.code ?? "INTERNAL_ERROR",
      errorBody?.error?.message ?? "Something went wrong. Please try again.",
      errorBody?.error?.fields,
      response.status,
      errorBody?.error?.requestId,
    );
  }

  return payload as T;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export const api = {
  health: () => request<{ status: string }>("/api/health"),

  me: () => request<{ user: PublicUser | null }>("/api/auth/me"),

  login: (body: { email: string; password: string }) =>
    request<{ user: PublicUser }>("/api/auth/login", { method: "POST", body }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: {} }),

  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ ok: true }>("/api/auth/password", { method: "POST", body }),

  updateProfile: (body: { name: string; email: string }) =>
    request<{ user: PublicUser }>("/api/auth/profile", { method: "POST", body }),

  // ── Reference ─────────────────────────────────────────────────────────────

  publicSettings: () => request<SiteSettings>("/api/public/settings"),
  departments: () => request<{ items: Department[] }>("/api/departments"),
  courses: () => request<{ items: Course[] }>("/api/courses"),

  // ── Admin ─────────────────────────────────────────────────────────────────

  adminOverview: () => request<AdminOverview>("/api/admin/overview"),

  listUsers: (query: {
    role?: string;
    page?: number;
    pageSize?: number;
    search?: string;
    sort?: string;
    dir?: string;
    departmentId?: string;
    level?: string;
  }) => request<Page<PublicUser>>("/api/admin/users", { query }),

  studentOptions: () => request<{ items: PublicUser[] }>("/api/admin/students/options"),
  lecturerOptions: () => request<{ items: PublicUser[] }>("/api/admin/lecturers/options"),

  createStudent: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/students", { method: "POST", body }),
  updateStudent: (body: Record<string, unknown>) =>
    request<{ ok: true }>("/api/admin/students/update", { method: "POST", body }),
  createLecturer: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/lecturers", { method: "POST", body }),
  updateLecturer: (body: Record<string, unknown>) =>
    request<{ ok: true }>("/api/admin/lecturers/update", { method: "POST", body }),
  deleteUser: (id: string) =>
    request<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }),

  createDepartment: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/departments", { method: "POST", body }),
  updateDepartment: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/departments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
    }),
  deleteDepartment: (id: string) =>
    request<{ ok: true }>(`/api/admin/departments/${encodeURIComponent(id)}`, { method: "DELETE" }),

  createCourse: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/courses", { method: "POST", body }),
  updateCourse: (body: Record<string, unknown>) =>
    request<{ ok: true }>("/api/admin/courses/update", { method: "POST", body }),
  deleteCourse: (id: string) =>
    request<{ ok: true }>(`/api/admin/courses/${encodeURIComponent(id)}`, { method: "DELETE" }),
  archiveCourse: (id: string, archived: boolean) =>
    request<{ ok: true }>(`/api/admin/courses/${encodeURIComponent(id)}/archive`, {
      method: "PATCH",
      body: { archived },
    }),
  assignLecturer: (body: { courseId: string; lecturerId: string | null }) =>
    request<{ ok: true }>("/api/admin/courses/assign-lecturer", { method: "POST", body }),
  enrollStudents: (body: { courseId: string; studentIds: string[] }) =>
    request<{ ok: true }>("/api/admin/courses/enroll", { method: "POST", body }),

  facultyReport: () => request<FacultyReport>("/api/admin/reports/faculty"),
  updateSiteSettings: (body: Record<string, unknown>) =>
    request<SiteSettings>("/api/admin/settings", { method: "POST", body }),
  listAudit: (query: { page?: number; pageSize?: number; search?: string; action?: string }) =>
    request<Page<AuditEntry>>("/api/admin/audit", { query }),

  // ── Lecturer ──────────────────────────────────────────────────────────────

  lecturerOverview: () =>
    request<{
      stats: {
        courses: number;
        sessions: number;
        liveSessions: number;
        enrollments: number;
        attendance: number;
      };
      courses: Course[];
      recentSessions: AttendanceSession[];
    }>("/api/lecturer/overview"),

  lecturerCourses: () => request<{ items: Course[] }>("/api/lecturer/courses"),
  lecturerSessions: () => request<{ items: AttendanceSession[] }>("/api/lecturer/sessions"),

  courseDetail: (id: string) =>
    request<{ course: Course; sessions: AttendanceSession[]; report: CourseReport | null }>(
      `/api/courses/${encodeURIComponent(id)}/detail`,
    ),
  courseSessions: (id: string) =>
    request<{ items: AttendanceSession[] }>(`/api/courses/${encodeURIComponent(id)}/sessions`),
  courseReport: (id: string) =>
    request<CourseReport>(`/api/courses/${encodeURIComponent(id)}/report`),

  startSession: (body: Record<string, unknown>) =>
    request<{ session: AttendanceSession }>("/api/sessions", { method: "POST", body }),
  sessionDetail: (id: string) => request<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`),
  endSession: (id: string) =>
    request<{ session: AttendanceSession }>(`/api/sessions/${encodeURIComponent(id)}/end`, {
      method: "POST",
      body: {},
    }),
  extendSession: (id: string, minutes: number) =>
    request<{ session: AttendanceSession }>(`/api/sessions/${encodeURIComponent(id)}/extend`, {
      method: "POST",
      body: { minutes },
    }),
  markAttendance: (body: { sessionId: string; studentId: string }) =>
    request<{ ok: true }>("/api/attendance/mark", { method: "POST", body }),
  deleteAttendance: (id: string) =>
    request<{ ok: true }>(`/api/attendance/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ── Student ───────────────────────────────────────────────────────────────

  studentCourses: () => request<{ items: StudentCourseView[] }>("/api/student/courses"),
  studentCourseDetail: (id: string) =>
    request<{
      course: StudentCourseView;
      sessions: Array<{
        id: string;
        startedAt: number;
        endedAt?: number;
        expiresAt: number;
        topic?: string;
        attended: boolean;
        timestamp?: number;
      }>;
    }>(`/api/student/courses/${encodeURIComponent(id)}`),
  studentHistory: (query: { page?: number; pageSize?: number; search?: string }) =>
    request<
      Page<{
        id: string;
        timestamp: number;
        method: string;
        sessionId: string;
        courseId: string;
        courseCode: string;
        courseTitle: string;
        topic?: string;
      }>
    >("/api/student/history", { query }),
  studentOpenSessions: () =>
    request<{
      items: Array<{
        sessionId: string;
        courseId: string;
        courseCode: string;
        courseTitle: string;
        topic?: string;
        expiresAt: number;
        alreadySignedIn: boolean;
      }>;
    }>("/api/student/open-sessions"),
  submitAttendance: (body: { code: string; latitude?: number; longitude?: number }) =>
    request<{ course: { code: string; title: string }; timestamp: number; sessionId: string }>(
      "/api/student/attendance",
      { method: "POST", body },
    ),
};

/** Human-readable message for any thrown value, for use in toasts. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
