// SLAMS API client (browser side of the Vercel SPA).
//
// The backend is the Cloudflare Workers API. API base URL resolution:
//   - `VITE_API_URL` env var wins (set it on Vercel to the Worker's public
//     URL, e.g. https://slams-api.<subdomain>.workers.dev).
//   - Otherwise same-origin (""), which is correct in local dev: the Vite
//     dev server proxies `/api` to the Worker at http://127.0.0.1:8787, so
//     the browser never needs cross-origin access (see vite.config.ts).
// The session token is a short-lived JWT kept in localStorage and sent as an
// Authorization header — works same-origin and cross-origin alike.

import type {
  AcademicPeriod,
  AcademicSession,
  AdminOverview,
  AttendanceSession,
  AttendanceStatus,
  AuditEntry,
  Course,
  CourseReport,
  CourseSessionStat,
  CoursesReport,
  Department,
  Faculty,
  Exam,
  ExamKind,
  ExamResult,
  ImportApplyResult,
  ImportInput,
  ImportKind,
  ImportPreview,
  FacultyReport,
  NotificationsPage,
  ResultAnalytics,
  OpenSession,
  Paginated,
  PublicSettings,
  ReportFilters,
  Role,
  Schedule,
  Semester,
  SessionDetail,
  SessionRegisterPage,
  SiteSettings,
  StudentCourseSession,
  StudentCourseView,
  StudentHistoryItem,
  User,
} from "./types";

// Strip any trailing slash; empty string means "same origin" (dev proxy or
// same-host deployment).
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

const TOKEN_KEY = "slams.token";
const TOKEN_EXPIRES_KEY = "slams.token.expiresAt";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string, expiresInSeconds?: number): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    if (expiresInSeconds) {
      localStorage.setItem(TOKEN_EXPIRES_KEY, String(Date.now() + expiresInSeconds * 1000));
    }
  } catch {
    /* private mode — session won't persist, still works in-memory */
  }
}
export function getTokenExpiresAt(): number | null {
  try {
    const v = localStorage.getItem(TOKEN_EXPIRES_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRES_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let onUnauthorized: (() => void) | null = null;
/** main.tsx registers the global 401 redirect here. */
export function handleUnauthorized(fn: () => void): void {
  onUnauthorized = fn;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Slide the session forward before it expires (no-op most of the time).
  if (path !== "/api/auth/login") void tryRefresh();

  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const token = getToken();
  if (token) headers["authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      "network",
      "Cannot reach the server. Check your connection and try again.",
    );
  }

  if (res.status === 401 && path !== "/api/auth/login") {
    clearToken();
    onUnauthorized?.();
  }

  // NOTE: the body can only be consumed once — parse it a single time and
  // reuse the parsed payload for both the error and success paths.
  let payload: unknown = null;
  try {
    payload = (await res.json()) as unknown;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const err = (payload as ErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "error",
      err?.message ?? `Request failed (${res.status})`,
    );
  }
  return payload as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as Array<
    [string, string]
  >;
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
};

/** Serialise the brief's attendance filters (§6) for any report endpoint.
 *  Booleans/numbers are stringified so the same object can drive a link the
 *  administrator copies, an export, and a print view. */
export function reportQuery(filters: ReportFilters = {}): string {
  const params: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params[key] = String(value);
  }
  return qs(params);
}

// ─── Auth ──────────────────────────────────────────────────────────────────

/** Re-signs a still-valid session (rolling session) so a student mid-lecture
 *  never hits an expired token. Silent no-op on failure — the next request
 *  handles auth normally. */
async function tryRefresh(): Promise<void> {
  try {
    const token = getToken();
    const expiresAt = getTokenExpiresAt();
    if (!token || !expiresAt) return;
    // Refresh in the last 25% of the token's life (or when already "expired"
    // by our tracked clock but still accepted by jose's grace-less check).
    if (Date.now() < expiresAt - 0.25 * (7 * 24 * 60 * 60 * 1000)) return;

    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const body = (await res.json()) as { token: string; expiresInSeconds?: number };
      setToken(body.token, body.expiresInSeconds);
    } else if (res.status === 401) {
      clearToken();
      onUnauthorized?.();
    }
  } catch {
    /* network hiccup — let the main request surface it */
  }
}

export const auth = {
  async login(email: string, password: string): Promise<User> {
    const { token, expiresInSeconds, user } = await request<{
      token: string;
      expiresInSeconds?: number;
      user: User;
    }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setToken(token, expiresInSeconds);
    return user;
  },
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<User>("/api/auth/me"),
  refresh: () =>
    request<{ token: string; expiresInSeconds: number }>("/api/auth/refresh", {
      method: "POST",
    }),
};

// ─── Users (admin) ────────────────────────────────────────────────────────

export const users = {
  list: (role?: Role) => request<User[]>(`/api/users${qs({ role })}`),
  create: (input: {
    role: Role;
    name: string;
    email: string;
    password: string;
    matricNo?: string;
    staffId?: string;
    departmentId?: string;
    level?: string;
  }) => request<{ id: string }>("/api/users", { method: "POST", body: input }),
  update: (id: string, input: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/api/users/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    }),
  updateProfile: (input: { name: string; email: string; password?: string }) =>
    request<{ ok: boolean }>("/api/users/profile", { method: "PATCH", body: input }),
};

// ─── Departments ───────────────────────────────────────────────────────────

export const departments = {
  list: () => request<Department[]>("/api/departments"),
  create: (input: { name: string; code: string; icon?: string; color?: string }) =>
    request<Department>("/api/departments", { method: "POST", body: input }),
  update: (id: string, input: { name: string; code: string; icon?: string; color?: string }) =>
    request<{ ok: boolean }>(`/api/departments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/departments/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

// ─── Courses ───────────────────────────────────────────────────────────────

export interface CourseInput {
  code: string;
  title: string;
  departmentId: string;
  level: string;
  units: number;
  icon?: string;
  color?: string;
  category?: string;
  description?: string;
  venueLat?: number;
  venueLng?: number;
  venueRadius?: number;
  clearVenue?: boolean;
}

export const courses = {
  list: () => request<Course[]>("/api/courses"),
  lecturer: () => request<Course[]>("/api/lecturer/courses"),
  unassigned: () => request<Course[]>("/api/lecturer/unassigned-courses"),
  claim: (courseId: string) =>
    request<Course>("/api/lecturer/claim-course", {
      method: "POST",
      body: { courseId },
    }),
  create: (input: CourseInput) => request<Course>("/api/courses", { method: "POST", body: input }),
  update: (id: string, input: CourseInput) =>
    request<{ ok: boolean }>(`/api/courses/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/courses/${encodeURIComponent(id)}`, { method: "DELETE" }),
  assignLecturer: (courseId: string, lecturerId: string | null) =>
    request<{ ok: boolean }>(`/api/courses/${encodeURIComponent(courseId)}/lecturer`, {
      method: "PATCH",
      body: { lecturerId },
    }),
  setVenue: (
    courseId: string,
    patch: { latitude?: number; longitude?: number; radiusMeters?: number; clear?: boolean },
  ) =>
    request<{ ok: boolean }>(`/api/courses/${encodeURIComponent(courseId)}/venue`, {
      method: "PATCH",
      body: patch,
    }),
  setEnrollments: (courseId: string, studentIds: string[]) =>
    request<{ ok: boolean }>(`/api/courses/${encodeURIComponent(courseId)}/enrollments`, {
      method: "PATCH",
      body: { studentIds },
    }),
  sessions: (courseId: string) =>
    request<AttendanceSession[]>(`/api/courses/${encodeURIComponent(courseId)}/sessions`),
};

// ─── Sessions (lecturer) ───────────────────────────────────────────────────

export const sessions = {
  start: (input: {
    courseId: string;
    durationMinutes?: number;
    topic?: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
    codeIntervalSeconds?: number | null;
    seats?: number;
    autoEndEnabled?: boolean;
  }) => request<AttendanceSession>("/api/sessions", { method: "POST", body: input }),
  detail: (sessionId: string) =>
    request<SessionDetail>(`/api/sessions/${encodeURIComponent(sessionId)}`),
  end: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}/end`, {
      method: "POST",
    }),
  /**
   * Deleting a sign-in requires a reason: every correction is written to the
   * audit trail (brief §9). `override` is the admin-only escape hatch for a
   * finalised period.
   */
  removeAttendance: (recordId: string, input: { reason: string; override?: boolean }) =>
    request<{ ok: boolean; removed: number }>(`/api/attendance/${encodeURIComponent(recordId)}`, {
      method: "DELETE",
      body: input,
    }),
  /** Changing a status also requires a reason (same trail). */
  setAttendanceStatus: (recordId: string, status: AttendanceStatus, input: { reason: string }) =>
    request<{ record: unknown }>(`/api/attendance/${encodeURIComponent(recordId)}/status`, {
      method: "PATCH",
      body: { status, ...input },
    }),
};

// ─── Recurring schedules (lecturer) ────────────────────────────────────────

export type ScheduleInput = {
  courseId: string;
  durationMinutes?: number;
  topic?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  codeIntervalSeconds?: number | null;
  seats?: number;
  recurrence: "daily" | "weekdays" | "weekly" | "custom";
  days?: number[];
  minuteOfDay: number;
  tzOffsetMinutes?: number;
  endsOn?: number;
  maxOccurrences?: number;
};

export const schedules = {
  list: (courseId?: string) => request<Schedule[]>(`/api/schedules${qs({ courseId })}`),
  create: (input: ScheduleInput) =>
    request<Schedule>("/api/schedules", { method: "POST", body: input }),
  setEnabled: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/api/schedules/${encodeURIComponent(id)}/enabled`, {
      method: "PATCH",
      body: { enabled },
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/schedules/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

// ─── Student ───────────────────────────────────────────────────────────────

export const student = {
  courses: () => request<StudentCourseView[]>("/api/me/courses"),
  courseSessions: (courseId: string) =>
    request<StudentCourseSession[]>(`/api/me/courses/${encodeURIComponent(courseId)}/sessions`),
  history: () => request<StudentHistoryItem[]>("/api/me/history"),
  openSessions: () => request<OpenSession[]>("/api/me/open-sessions"),
  submitAttendance: (input: {
    code: string;
    latitude?: number;
    longitude?: number;
    deviceId?: string;
    clientTime?: number;
  }) =>
    request<{ course: { code: string; title: string }; timestamp: number }>("/api/attendance", {
      method: "POST",
      body: input,
    }),
};

// ─── Reports ───────────────────────────────────────────────────────────────

export const faculties = {
  list: () => request<Faculty[]>(`/api/faculties`),
  create: (input: {
    name: string;
    code: string;
    deanUserId?: string;
    icon?: string;
    color?: string;
  }) => request<Faculty>(`/api/faculties`, { method: "POST", body: input }),
  update: (
    id: string,
    input: { name?: string; code?: string; deanUserId?: string; icon?: string; color?: string },
  ) =>
    request<Faculty>(`/api/faculties/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/faculties/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setDepartment: (departmentId: string, facultyId: string | null) =>
    request<{ ok: boolean }>(`/api/departments/${encodeURIComponent(departmentId)}/faculty`, {
      method: "PATCH",
      body: { facultyId },
    }),
};

export const academics = {
  period: () => request<AcademicPeriod>(`/api/academics/period`),
  createSession: (input: {
    name: string;
    code: string;
    startsOn?: number;
    endsOn?: number;
    makeCurrent?: boolean;
  }) => request<AcademicSession>(`/api/academic-sessions`, { method: "POST", body: input }),
  createSemester: (input: {
    academicSessionId: string;
    name: string;
    sequence?: number;
    startsOn?: number;
    endsOn?: number;
    makeCurrent?: boolean;
  }) => request<Semester>(`/api/semesters`, { method: "POST", body: input }),
  updateSemester: (
    id: string,
    input: { name?: string; startsOn?: number | null; endsOn?: number | null },
  ) =>
    request<Semester>(`/api/semesters/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  setCurrentSemester: (id: string) =>
    request<AcademicPeriod>(`/api/semesters/${encodeURIComponent(id)}/current`, { method: "POST" }),
  finalizeSemester: (id: string) =>
    request<Semester>(`/api/semesters/${encodeURIComponent(id)}/finalize`, { method: "POST" }),
};

export const audit = {
  list: (
    query: {
      action?: string;
      actorId?: string;
      entityType?: string;
      entityId?: string;
      courseId?: string;
      from?: number;
      to?: number;
      page?: number;
      pageSize?: number;
    } = {},
  ) => request<Paginated<AuditEntry>>(`/api/audit${reportQuery(query as ReportFilters)}`),
};

// ─── Notifications (plan §4.5 / P4.5) ──────────────────────────────────────

export const notifications = {
  list: (opts: { page?: number; pageSize?: number; unreadOnly?: boolean } = {}) =>
    request<NotificationsPage>(
      `/api/notifications${reportQuery({
        page: opts.page,
        pageSize: opts.pageSize,
        unreadOnly: opts.unreadOnly ? "1" : undefined,
      } as unknown as ReportFilters)}`,
    ),
  /** Tiny endpoint the bell polls. */
  summary: () => request<{ unread: number }>(`/api/notifications/summary`),
  markRead: (id: string) =>
    request<{ ok: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
    }),
  markAllRead: () => request<{ marked: number }>(`/api/notifications/read-all`, { method: "POST" }),
};

// ─── Examinations & results (plan §4.4 / P4.3) ──────────────────────────────

export const exams = {
  list: (query: { courseId?: string; semesterId?: string } = {}) =>
    request<Exam[]>(`/api/exams${reportQuery(query as ReportFilters)}`),
  get: (id: string) =>
    request<{ exam: Exam; results: ExamResult[] }>(`/api/exams/${encodeURIComponent(id)}`),
  create: (input: {
    courseId: string;
    title: string;
    kind?: ExamKind;
    weight?: number | null;
    maxScore?: number;
    scheduledAt?: number | null;
    durationMinutes?: number | null;
    venue?: string;
    room?: string;
    semesterId?: string;
  }) => request<Exam>(`/api/exams`, { method: "POST", body: input }),
  update: (
    id: string,
    input: {
      title?: string;
      kind?: ExamKind;
      weight?: number | null;
      maxScore?: number;
      scheduledAt?: number | null;
      durationMinutes?: number | null;
      venue?: string;
      room?: string;
      published?: boolean;
    },
  ) => request<Exam>(`/api/exams/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  remove: (id: string) =>
    request<{ ok: boolean; removed: number }>(`/api/exams/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  /** Marks for one exam — a `score: null` row clears that student's mark. */
  saveResults: (
    id: string,
    rows: Array<{ studentId: string; score: number | null; grade?: string }>,
  ) =>
    request<{ ok: boolean; saved: number; cleared: number }>(
      `/api/exams/${encodeURIComponent(id)}/results`,
      { method: "POST", body: { rows } },
    ),
  deleteResult: (examId: string, studentId: string) =>
    request<{ ok: boolean }>(
      `/api/exams/${encodeURIComponent(examId)}/results/${encodeURIComponent(studentId)}`,
      { method: "DELETE" },
    ),
  /** Attendance × performance for a course (plan P4.4). */
  analytics: (courseId: string, filters: ReportFilters = {}) =>
    request<ResultAnalytics>(
      `/api/reports/courses/${encodeURIComponent(courseId)}/analytics${reportQuery(filters)}`,
    ),
};

export const reports = {
  /** The brief's §4 table: every course with its attendance columns. */
  courses: (filters: ReportFilters = {}) =>
    request<CoursesReport>(`/api/reports/courses${reportQuery(filters)}`),
  /** Institution-wide lecture register (P4.2). */
  sessions: (filters: ReportFilters = {}) =>
    request<SessionRegisterPage>(`/api/reports/sessions${reportQuery(filters)}`),
  /** Per-lecture rows for one course (brief §5). */
  courseSessions: (courseId: string, filters: ReportFilters = {}) =>
    request<CourseSessionStat[]>(
      `/api/reports/courses/${encodeURIComponent(courseId)}/sessions${reportQuery(filters)}`,
    ),
  /** One student's lecture-by-lecture history within a course (brief §5). */
  courseStudentHistory: (courseId: string, studentId: string) =>
    request<{
      rows: StudentCourseSession[];
      summary: { present: number; late: number; excused: number; absent: number; total: number };
    }>(
      `/api/reports/courses/${encodeURIComponent(courseId)}/students/${encodeURIComponent(studentId)}`,
    ),
  /** Record an export so the trail shows who took data out (brief §9). */
  logExport: (input: {
    format: "pdf" | "xlsx" | "csv" | "print";
    scope: "course" | "courses" | "all" | "semester" | "session" | "date-range";
    courseId?: string;
    title?: string;
    rowCount?: number;
    filters?: Record<string, string | number | boolean>;
  }) => request<{ ok: boolean }>(`/api/reports/exports`, { method: "POST", body: input }),
  /** One course's full attendance report, scoped to the same filters the
   *  All-Courses table uses (so the two can never disagree). */
  course: (courseId: string, filters: ReportFilters = {}) =>
    request<CourseReport>(
      `/api/reports/course/${encodeURIComponent(courseId)}${reportQuery(filters)}`,
    ),
  faculty: () => request<FacultyReport>("/api/reports/faculty"),
  adminOverview: () => request<AdminOverview>("/api/admin/overview"),
};

// ─── Bulk import (plan P5.4 / decision D8) ───────────────────────────────────

/**
 * CSV imports run in two steps on purpose: `preview` validates the whole file
 * against the live database and reports every row with its file line number, and
 * `apply` re-validates before writing anything. An error row stops the file.
 */
export const imports = {
  preview: (input: ImportInput) =>
    request<ImportPreview>("/api/import/preview", { method: "POST", body: input }),
  apply: (input: ImportInput) =>
    request<ImportApplyResult>("/api/import/apply", { method: "POST", body: input }),
};

/**
 * Templates are served behind the session, so a plain `<a href>` cannot fetch
 * them — the file is downloaded with the token and handed to the browser as a
 * blob. Failure is thrown rather than swallowed: the user asked for a file.
 */
export async function downloadImportTemplate(kind: ImportKind): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/import/template?kind=${encodeURIComponent(kind)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, "error", "The template could not be downloaded");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `slams-${kind}-template.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ─── Settings ─────────────────────────────────────────────────────────────

export const settings = {
  public: () => request<PublicSettings>("/api/public/settings"),
  get: () => request<SiteSettings>("/api/settings"),
  save: (input: Partial<SiteSettings>) =>
    request<SiteSettings>("/api/settings", { method: "PATCH", body: input }),
};
