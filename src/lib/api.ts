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
  Course,
  CourseReport,
  Department,
  FacultyReport,
  OpenSession,
  PublicSettings,
  Role,
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

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode — session won't persist, still works in-memory */
  }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
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

  let payload: ErrorBody | null = null;
  try {
    payload = (await res.json()) as ErrorBody | null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      payload?.error?.code ?? "error",
      payload?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as Array<
    [string, string]
  >;
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
};

// ─── Auth ──────────────────────────────────────────────────────────────────

export const auth = {
  async login(email: string, password: string): Promise<User> {
    const { token, user } = await request<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setToken(token);
    return user;
  },
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<User>("/api/auth/me"),
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
}

export const courses = {
  list: () => request<Course[]>("/api/courses"),
  lecturer: () => request<Course[]>("/api/lecturer/courses"),
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
};

// ─── Student ───────────────────────────────────────────────────────────────

export const student = {
  courses: () => request<StudentCourseView[]>("/api/me/courses"),
  courseSessions: (courseId: string) =>
    request<StudentCourseSession[]>(`/api/me/courses/${encodeURIComponent(courseId)}/sessions`),
  history: () => request<StudentHistoryItem[]>("/api/me/history"),
  openSessions: () => request<OpenSession[]>("/api/me/open-sessions"),
  submitAttendance: (input: { code: string; latitude?: number; longitude?: number }) =>
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
