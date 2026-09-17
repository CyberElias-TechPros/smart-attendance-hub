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
  AdminOverview,
  AttendanceSession,
  AttendanceStatus,
  Course,
  CourseReport,
  Department,
  FacultyReport,
  OpenSession,
  PublicSettings,
  Role,
  Schedule,
  SessionDetail,
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
  removeAttendance: (recordId: string) =>
    request<{ ok: boolean }>(`/api/attendance/${encodeURIComponent(recordId)}`, {
      method: "DELETE",
    }),
  setAttendanceStatus: (recordId: string, status: AttendanceStatus) =>
    request<{ ok: boolean }>(`/api/attendance/${encodeURIComponent(recordId)}/status`, {
      method: "PATCH",
      body: { status },
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

export const reports = {
  course: (courseId: string) =>
    request<CourseReport>(`/api/reports/course/${encodeURIComponent(courseId)}`),
  faculty: () => request<FacultyReport>("/api/reports/faculty"),
  adminOverview: () => request<AdminOverview>("/api/admin/overview"),
};

// ─── Settings ─────────────────────────────────────────────────────────────

export const settings = {
  public: () => request<PublicSettings>("/api/public/settings"),
  get: () => request<SiteSettings>("/api/settings"),
  save: (input: Partial<SiteSettings>) =>
    request<SiteSettings>("/api/settings", { method: "PATCH", body: input }),
};
