// Server-only data layer for SLAMS.
//
// Persists to Cloudflare D1 when deployed (or via `wrangler dev`). When no D1
// binding is present (e.g. plain `vite dev` in Node), it transparently falls
// back to an in-memory store so the app stays usable for local development.
//
// Every function is async so callers don't care which backend is active.

import { nanoid } from "nanoid";
import { hashPassword, verifyPassword } from "./auth.server";

export type Role = "admin" | "lecturer" | "student";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  matricNo?: string;
  staffId?: string;
  departmentId?: string;
  level?: string;
  createdAt: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  icon?: string;
  color?: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  departmentId: string;
  level: string;
  units: number;
  lecturerId?: string;
  enrolledStudentIds: string[];
  icon?: string;
  color?: string;
  category?: string;
  description?: string;
}

export interface Testimonial {
  name: string;
  role: string;
  text: string;
}

export interface SiteSettings {
  id: string;
  institutionName: string;
  atRiskThreshold: number;
  marqueeItems: string[];
  testimonials: Testimonial[];
  demoAccountsEnabled: boolean;
  demoPassword: string;
  demoEmailDomain: string;
  showFakeStats: boolean;
  primaryColor?: string | null;
  contactEmail?: string | null;
}

export function defaultSiteSettings(): SiteSettings {
  return {
    id: "site",
    institutionName: "SLAMS",
    atRiskThreshold: 70,
    marqueeItems: [
      "Real-time QR check-in",
      "Fraud-resistant codes",
      "Zero paper sheets",
      "Instant reports",
      "Works offline-first",
    ],
    testimonials: [
      {
        name: "Dr. Amina Yusuf",
        role: "Lecturer, Computer Science",
        text: "I stopped chasing attendance sheets. SLAMS just works.",
      },
      {
        name: "Ada Obi",
        role: "300L Student",
        text: "Signing in takes 4 seconds. I never miss a mark now.",
      },
      {
        name: "Prof. Chuka Okafor",
        role: "HOD, Mathematics",
        text: "The faculty report saved me days of manual tallying.",
      },
    ],
    demoAccountsEnabled: true,
    demoPassword: "password123",
    demoEmailDomain: "slams.edu",
    showFakeStats: true,
    primaryColor: null,
    contactEmail: null,
  };
}

export interface AttendanceSession {
  id: string;
  courseId: string;
  lecturerId: string;
  code: string;
  startedAt: number;
  expiresAt: number;
  endedAt?: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  topic?: string;
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  courseId: string;
  timestamp: number;
  latitude?: number;
  longitude?: number;
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

export function generateCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000));
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function safeJsonArray<T>(value: unknown, fallback: T[]): T[] {
  if (!value) return fallback;
  if (Array.isArray(value)) return value as T[];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

// ─── D1 access ─────────────────────────────────────────────────────────────
// Nitro v3 attaches bindings to `event.req.runtime.cloudflare.env`. The most
// reliable cross-environment way (works in production Workers and `wrangler
// dev`) is the `cloudflare:workers` module's `env`. We fall back to null when
// running in a plain Node process (e.g. `vite dev`) so the in-memory store is
// used instead.

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta: unknown }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

let cachedD1: D1Database | null | undefined;

export async function getD1(): Promise<D1Database | null> {
  if (cachedD1 !== undefined) return cachedD1;
  // Canonical Cloudflare Workers path: the per-request Worker env.
  // Returns null on non-Cloudflare runtimes (e.g. plain `vite dev`), which
  // makes the data layer fall back to the in-memory store.
  try {
    const mod = (await import("cloudflare:workers")) as { env?: Record<string, unknown> };
    cachedD1 = (mod.env?.["DB"] as D1Database) ?? null;
  } catch {
    cachedD1 = null;
  }
  return cachedD1;
}

// ─── Repository interface ──────────────────────────────────────────────────
// Both backends implement this so `api.functions.ts` never branches on storage.

export interface SessionDetail {
  session: AttendanceSession;
  course: Course;
  totalEnrolled: number;
  attendance: Array<{ id: string; studentId: string; name: string; matricNo: string; timestamp: number }>;
}

export interface StudentCourseView {
  id: string;
  code: string;
  title: string;
  departmentId: string;
  level: string;
  units: number;
  lecturerId?: string;
  enrolledStudentIds: string[];
  lecturerName: string;
  totalSessions: number;
  attendedSessions: number;
  percentage: number;
}

export interface CourseReportStudent {
  id: string;
  name: string;
  matricNo: string;
  attended: number;
  percentage: number;
}

export interface CourseReport {
  course: { id: string; code: string; title: string; level: string; units: number };
  totalSessions: number;
  sessions: AttendanceSession[];
  students: CourseReportStudent[];
}

export interface AdminOverview {
  counts: {
    students: number;
    lecturers: number;
    courses: number;
    departments: number;
    sessions: number;
    attendance: number;
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

export interface Repo {
  ensureSeeded(): Promise<void>;
listUsers(role?: Role): Promise<Omit<User, "passwordHash">[]>;
  createUser(input: {
    name: string;
    email: string;
    password: string;
    role: Role;
    matricNo?: string;
    staffId?: string;
    departmentId?: string;
    level?: string;
  }): Promise<string>;
  emailExists(email: string): Promise<boolean>;
  deleteUser(id: string): Promise<void>;
  listDepartments(): Promise<Department[]>;
  createDepartment(name: string, code: string, icon?: string, color?: string): Promise<Department>;
  updateDepartment(id: string, name: string, code: string, icon?: string, color?: string): Promise<void>;
  deleteDepartment(id: string): Promise<void>;
  listCourses(): Promise<Course[]>;
  getCourse(id: string): Promise<Course | undefined>;
  createCourse(input: {
    code: string;
    title: string;
    departmentId: string;
    level: string;
    units: number;
    icon?: string;
    color?: string;
    category?: string;
    description?: string;
  }): Promise<Course>;
  updateCourse(id: string, input: {
    code: string;
    title: string;
    departmentId: string;
    level: string;
    units: number;
    icon?: string;
    color?: string;
    category?: string;
    description?: string;
  }): Promise<void>;
  deleteCourse(id: string): Promise<void>;
  assignLecturer(courseId: string, lecturerId: string | null): Promise<void>;
  setEnrollments(courseId: string, studentIds: string[]): Promise<void>;
  lecturerCourses(lecturerId: string): Promise<Course[]>;
  studentCourses(studentId: string): Promise<StudentCourseView[]>;
  startSession(input: {
    courseId: string;
    lecturerId: string;
    durationMinutes: number;
    topic?: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
  }): Promise<AttendanceSession>;
  endSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): Promise<AttendanceSession | undefined>;
  listSessionsForCourse(courseId: string): Promise<AttendanceSession[]>;
  sessionDetail(sessionId: string): Promise<SessionDetail | undefined>;
  submitAttendance(input: {
    code: string;
    studentId: string;
    latitude?: number;
    longitude?: number;
  }): Promise<{ course: { code: string; title: string }; timestamp: number }>;
  studentHistory(studentId: string): Promise<Array<{ id: string; timestamp: number; courseCode: string; courseTitle: string }>>;
  courseReport(courseId: string): Promise<CourseReport | undefined>;
  adminOverview(): Promise<AdminOverview>;
  updateStudent(id: string, input: {
    name: string;
    email: string;
    matricNo?: string;
    departmentId: string;
    level: string;
    password: string;
  }): Promise<void>;
  updateLecturer(id: string, input: {
    name: string;
    email: string;
    staffId: string;
    departmentId: string;
    password: string;
  }): Promise<void>;
  deleteAttendanceRecord(sessionId: string, studentId: string): Promise<void>;
  courseReport(courseId: string): Promise<CourseReport | undefined>;
  adminOverview(): Promise<AdminOverview>;
  getSiteSettings(): Promise<SiteSettings>;
  saveSiteSettings(partial: Partial<SiteSettings>): Promise<SiteSettings>;
  listOpenSessionsForStudent(studentId: string): Promise<
    Array<{ sessionId: string; courseId: string; courseCode: string; courseTitle: string; code: string; expiresAt: number }>
  >;
}

// ═══════════════════════════════════════════════════════════════════════════
// In-memory implementation (local dev fallback)
// ═══════════════════════════════════════════════════════════════════════════

interface MemStore {
  users: Map<string, User>;
  departments: Map<string, Department>;
  courses: Map<string, Course>;
  sessions: Map<string, AttendanceSession>;
  records: AttendanceRecord[];
  siteSettings?: SiteSettings;
  seeded: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __slams_mem: MemStore | undefined;
}

function newStore(): MemStore {
  return {
    users: new Map(),
    departments: new Map(),
    courses: new Map(),
    sessions: new Map(),
    records: [],
    siteSettings: undefined,
    seeded: false,
  };
}

class MemRepo implements Repo {
  private s: MemStore;
  constructor() {
    if (!globalThis.__slams_mem) globalThis.__slams_mem = newStore();
    this.s = globalThis.__slams_mem;
  }

  private strip(u: User): Omit<User, "passwordHash"> {
    const { passwordHash, ...rest } = u;
    void passwordHash;
    return rest;
  }

  async ensureSeeded() {
    if (this.s.seeded) return;
    this.s.seeded = true;
    await seedMem(this.s);
  }

async deleteUser(id: string) {
    this.s.users.delete(id);
    for (const c of this.s.courses.values()) {
      c.enrolledStudentIds = c.enrolledStudentIds.filter((x) => x !== id);
      if (c.lecturerId === id) c.lecturerId = undefined;
    }
  }
  async updateStudent(id: string, input: { name?: string; email: string; matricNo?: string; departmentId?: string; level?: string; password?: string; }): Promise<void> {
    const u = this.s.users.get(id);
    if (!u) return;
    if (input.name) u.name = input.name;
    if (input.email) u.email = input.email;
    if (input.matricNo) u.matricNo = input.matricNo;
    if (input.departmentId) u.departmentId = input.departmentId;
    if (input.level) u.level = input.level;
    if (input.password) u.passwordHash = await hashPassword(input.password);
  }

  async updateLecturer(id: string, input: {
    name: string;
    email: string;
    staffId: string;
    departmentId: string;
    password?: string;
  }): Promise<void> {
    const l = this.s.users.get(id);
    if (!l) throw new Error("Lecturer not found");
    l.name = input.name;
    l.email = input.email;
    l.staffId = input.staffId;
    l.departmentId = input.departmentId;
    if (input.password) l.passwordHash = await hashPassword(input.password);
  }
  async verifyCredentials(email: string, password: string) {
    const u = [...this.s.users.values()].find(
      (x) => x.email.toLowerCase() === email.toLowerCase(),
    );
    if (!u) return null;
    const ok = await verifyPassword(password, u.passwordHash);
    return ok ? this.strip(u) : null;
  }
  async getUser(id: string) {
    const u = this.s.users.get(id);
    return u ? this.strip(u) : undefined;
  }
  async listUsers(role?: Role) {
    return [...this.s.users.values()]
      .filter((u) => (role ? u.role === role : true))
      .map((u) => this.strip(u))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  async createUser(input: Parameters<Repo["createUser"]>[0]) {
    const id = nanoid(10);
    const u: User = {
      id,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      name: input.name,
      role: input.role,
      matricNo: input.matricNo,
      staffId: input.staffId,
      departmentId: input.departmentId,
      level: input.level,
      createdAt: Date.now(),
    };
    this.s.users.set(id, u);
    return id;
  }
  async emailExists(email: string) {
    return [...this.s.users.values()].some(
      (u) => u.email.toLowerCase() === email.toLowerCase(),
    );
  }
  async deleteUser(id: string) {
    this.s.users.delete(id);
    for (const c of this.s.courses.values()) {
      c.enrolledStudentIds = c.enrolledStudentIds.filter((x) => x !== id);
      if (c.lecturerId === id) c.lecturerId = undefined;
    }
  }
  async listDepartments() {
    return [...this.s.departments.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async createDepartment(name: string, code: string, icon?: string, color?: string) {
    const d: Department = { id: nanoid(8), name, code: code.toUpperCase(), icon, color };
    this.s.departments.set(d.id, d);
    return d;
  }
  async deleteDepartment(id: string) {
    this.s.departments.delete(id);
  }
  async listCourses() {
    return [...this.s.courses.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
  async getCourse(id: string) {
    return this.s.courses.get(id);
  }
  async createCourse(input: Parameters<Repo["createCourse"]>[0]) {
    const c: Course = {
      id: nanoid(8),
      code: input.code.toUpperCase(),
      title: input.title,
      departmentId: input.departmentId,
      level: input.level,
      units: input.units,
      enrolledStudentIds: [],
      icon: input.icon,
      color: input.color,
      category: input.category,
      description: input.description,
    };
    this.s.courses.set(c.id, c);
    return c;
  }
  async deleteCourse(id: string) {
    this.s.courses.delete(id);
  }
  async assignLecturer(courseId: string, lecturerId: string | null) {
    const c = this.s.courses.get(courseId);
    if (c) c.lecturerId = lecturerId ?? undefined;
  }
  async setEnrollments(courseId: string, studentIds: string[]) {
    const c = this.s.courses.get(courseId);
    if (c) c.enrolledStudentIds = Array.from(new Set(studentIds));
  }
  async lecturerCourses(lecturerId: string) {
    return [...this.s.courses.values()].filter((c) => c.lecturerId === lecturerId);
  }
  async studentCourses(studentId: string): Promise<StudentCourseView[]> {
    const courses = [...this.s.courses.values()].filter((c) =>
      c.enrolledStudentIds.includes(studentId),
    );
    return courses.map((c) => {
      const lecturer = c.lecturerId ? this.s.users.get(c.lecturerId) : undefined;
      const sessions = [...this.s.sessions.values()].filter((s) => s.courseId === c.id);
      const attended = this.s.records.filter(
        (r) => r.courseId === c.id && r.studentId === studentId,
      ).length;
      return {
        ...c,
        lecturerName: lecturer?.name ?? "Unassigned",
        totalSessions: sessions.length,
        attendedSessions: attended,
        percentage: sessions.length === 0 ? 0 : Math.round((attended / sessions.length) * 100),
      };
    });
  }
  async startSession(input: Parameters<Repo["startSession"]>[0]) {
    const now = Date.now();
    const s: AttendanceSession = {
      id: nanoid(10),
      courseId: input.courseId,
      lecturerId: input.lecturerId,
      code: generateCode(),
      startedAt: now,
      expiresAt: now + input.durationMinutes * 60 * 1000,
      topic: input.topic,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
    };
    this.s.sessions.set(s.id, s);
    return s;
  }
  async endSession(sessionId: string) {
    const s = this.s.sessions.get(sessionId);
    if (s) s.endedAt = Date.now();
  }
  async getSession(sessionId: string) {
    return this.s.sessions.get(sessionId);
  }
  async getAttendanceRecord(recordId: string) {
    return this.s.records.find((r) => r.id === recordId);
  }
  async listSessionsForCourse(courseId: string) {
    return [...this.s.sessions.values()]
      .filter((s) => s.courseId === courseId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }
  async sessionDetail(sessionId: string) {
    const s = this.s.sessions.get(sessionId);
    if (!s) return undefined;
    const course = this.s.courses.get(s.courseId);
    if (!course) return undefined;
    const attended = this.s.records.filter((r) => r.sessionId === s.id);
    return {
      session: s,
      course,
      totalEnrolled: course.enrolledStudentIds.length,
      attendance: attended
        .map((r) => {
          const st = this.s.users.get(r.studentId);
          return {
            id: r.id,
            studentId: r.studentId,
            name: st?.name ?? "Unknown",
            matricNo: st?.matricNo ?? "—",
            timestamp: r.timestamp,
          };
        })
        .sort((a, b) => a.timestamp - b.timestamp),
    };
  }
  async submitAttendance(input: Parameters<Repo["submitAttendance"]>[0]) {
    const now = Date.now();
    const s = [...this.s.sessions.values()].find(
      (x) => x.code === input.code && !x.endedAt && x.expiresAt > now,
    );
    if (!s) throw new Error("Invalid or expired attendance code");
    const course = this.s.courses.get(s.courseId);
    if (!course) throw new Error("Course not found");
    if (!course.enrolledStudentIds.includes(input.studentId))
      throw new Error("You are not enrolled in this course");
    if (this.s.records.some((r) => r.sessionId === s.id && r.studentId === input.studentId))
      throw new Error("Attendance already submitted for this session");
    if (s.latitude != null && s.longitude != null && s.radiusMeters != null) {
      if (input.latitude == null || input.longitude == null)
        throw new Error("Location required for this session");
      const dist = haversineMeters(
        { lat: s.latitude, lng: s.longitude },
        { lat: input.latitude, lng: input.longitude },
      );
      if (dist > s.radiusMeters)
        throw new Error(
          `You are ${Math.round(dist)}m from the venue (max ${s.radiusMeters}m)`,
        );
    }
    this.s.records.push({
      id: nanoid(10),
      sessionId: s.id,
      studentId: input.studentId,
      courseId: s.courseId,
      timestamp: now,
      latitude: input.latitude,
      longitude: input.longitude,
    });
    return { course: { code: course.code, title: course.title }, timestamp: now };
  }
  async studentHistory(studentId: string) {
    return this.s.records
      .filter((r) => r.studentId === studentId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((r) => {
        const c = this.s.courses.get(r.courseId);
        return {
          id: r.id,
          timestamp: r.timestamp,
          courseCode: c?.code ?? "—",
          courseTitle: c?.title ?? "—",
        };
      });
  }
  async studentCourseSessions(studentId: string, courseId: string) {
    const sessions = [...this.s.sessions.values()]
      .filter((s) => s.courseId === courseId)
      .sort((a, b) => b.startedAt - a.startedAt);
    const attendedIds = new Set(
      this.s.records.filter((r) => r.studentId === studentId && r.courseId === courseId).map((r) => r.sessionId),
    );
    const tsById = new Map(
      this.s.records.filter((r) => r.studentId === studentId && r.courseId === courseId).map((r) => [r.sessionId, r.timestamp]),
    );
    return sessions.map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      topic: s.topic,
      attended: attendedIds.has(s.id),
      timestamp: tsById.get(s.id),
    }));
  }
  async courseReport(courseId: string) {
    const c = this.s.courses.get(courseId);
    if (!c) return undefined;
    const sessions = [...this.s.sessions.values()]
      .filter((s) => s.courseId === c.id)
      .sort((a, b) => a.startedAt - b.startedAt);
    const total = sessions.length;
    const students = c.enrolledStudentIds.map((sid) => {
      const u = this.s.users.get(sid);
      const attended = this.s.records.filter(
        (r) => r.courseId === c.id && r.studentId === sid,
      ).length;
      return {
        id: sid,
        name: u?.name ?? "Unknown",
        matricNo: u?.matricNo ?? "—",
        attended,
        percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
      };
    });
    return {
      course: { id: c.id, code: c.code, title: c.title, level: c.level, units: c.units },
      totalSessions: total,
      sessions,
      students: students.sort((a, b) => b.percentage - a.percentage),
    };
  }
  async adminOverview() {
    const users = [...this.s.users.values()];
    const courses = [...this.s.courses.values()];
    const sessions = [...this.s.sessions.values()];
    const records = this.s.records;
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const weeklyAttendance: Array<{ label: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const start = now - i * day;
      const d = new Date(start);
      const label = d.toLocaleDateString("en", { weekday: "short" });
      const count = records.filter(
        (r) => r.timestamp >= start - day / 2 && r.timestamp <= start + day / 2,
      ).length;
      weeklyAttendance.push({ label, count });
    }
    return {
      counts: {
        students: users.filter((u) => u.role === "student").length,
        lecturers: users.filter((u) => u.role === "lecturer").length,
        courses: courses.length,
        departments: this.s.departments.size,
        sessions: sessions.length,
        attendance: records.length,
      },
      recentSessions: sessions
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 8)
        .map((s) => {
          const c = courses.find((x) => x.id === s.courseId);
          return {
            id: s.id,
            courseCode: c?.code ?? "—",
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            attended: records.filter((r) => r.sessionId === s.id).length,
            enrolled: c?.enrolledStudentIds.length ?? 0,
          };
        }),
      weeklyAttendance,
    };
  }

  // ── updates / settings / record deletion (in-memory) ──
  async facultyReport() {
    const courses = [...this.s.courses.values()];
    const courseSummaries = courses.map((c) => {
      const sessions = [...this.s.sessions.values()].filter((s) => s.courseId === c.id);
      const total = sessions.length;
      let att = 0;
      for (const sid of c.enrolledStudentIds)
        att += this.s.records.filter((r) => r.courseId === c.id && r.studentId === sid).length;
      const denom = total * Math.max(1, c.enrolledStudentIds.length);
      return {
        id: c.id,
        code: c.code,
        title: c.title,
        enrolled: c.enrolledStudentIds.length,
        sessions: total,
        avg: denom === 0 ? 0 : Math.round((att / denom) * 100),
      };
    });
    const studentIds = new Set<string>();
    courses.forEach((c) => c.enrolledStudentIds.forEach((id) => studentIds.add(id)));
    const students = [...studentIds]
      .map((sid) => {
        const u = this.s.users.get(sid);
        let attended = 0;
        let total = 0;
        courses.forEach((c) => {
          if (!c.enrolledStudentIds.includes(sid)) return;
          total += [...this.s.sessions.values()].filter((s) => s.courseId === c.id).length;
          attended += this.s.records.filter((r) => r.courseId === c.id && r.studentId === sid).length;
        });
        return {
          id: sid,
          name: u?.name ?? "Unknown",
          matricNo: u?.matricNo ?? "—",
          courses: courses.filter((c) => c.enrolledStudentIds.includes(sid)).length,
          attended,
          total,
          percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
        };
      })
      .sort((a, b) => b.percentage - a.percentage);
    return { courses: courseSummaries, students };
  }

  async updateStudent(id: string, input: Parameters<Repo["updateStudent"]>[1]) {
    const u = this.s.users.get(id);
    if (!u) throw new Error("User not found");
    if ([...this.s.users.values()].some((x) => x.id !== id && x.email.toLowerCase() === input.email.toLowerCase()))
      throw new Error("Email already in use");
    u.name = input.name;
    u.email = input.email;
    u.matricNo = input.matricNo;
    u.departmentId = input.departmentId;
    u.level = input.level;
    if (input.password) u.passwordHash = await hashPassword(input.password);
  }

  async updateLecturer(id: string, input: Parameters<Repo["updateLecturer"]>[1]) {
    const u = this.s.users.get(id);
    if (!u) throw new Error("User not found");
    if ([...this.s.users.values()].some((x) => x.id !== id && x.email.toLowerCase() === input.email.toLowerCase()))
      throw new Error("Email already in use");
    u.name = input.name;
    u.email = input.email;
    u.staffId = input.staffId;
    u.departmentId = input.departmentId;
    if (input.password) u.passwordHash = await hashPassword(input.password);
  }

  async updateDepartment(id: string, name: string, code: string, icon?: string, color?: string) {
    const d = this.s.departments.get(id);
    if (d) {
      d.name = name;
      d.code = code.toUpperCase();
      d.icon = icon;
      d.color = color;
    }
  }

  async updateCourse(id: string, input: Parameters<Repo["updateCourse"]>[1]) {
    const c = this.s.courses.get(id);
    if (c) {
      c.code = input.code.toUpperCase();
      c.title = input.title;
      c.departmentId = input.departmentId;
      c.level = input.level;
      c.units = input.units;
      c.icon = input.icon;
      c.color = input.color;
      c.category = input.category;
      c.description = input.description;
    }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const u = this.s.users.get(userId);
    if (!u) throw new Error("User not found");
    const ok = await verifyPassword(currentPassword, u.passwordHash);
    if (!ok) throw new Error("Current password is incorrect");
    if (newPassword.length < 6) throw new Error("New password must be at least 6 characters");
    u.passwordHash = await hashPassword(newPassword);
  }

  async getSiteSettings() {
    if (!this.s.siteSettings) this.s.siteSettings = defaultSiteSettings();
    return this.s.siteSettings;
  }

  async saveSiteSettings(partial: Partial<SiteSettings>) {
    const current = await this.getSiteSettings();
    const next: SiteSettings = { ...current, ...partial, id: "site" };
    this.s.siteSettings = next;
    return next;
  }

  async listOpenSessionsForStudent(studentId: string) {
    const now = Date.now();
    const courses = [...this.s.courses.values()].filter((c) =>
      c.enrolledStudentIds.includes(studentId),
    );
    const out: Array<{
      sessionId: string;
      courseId: string;
      courseCode: string;
      courseTitle: string;
      code: string;
      expiresAt: number;
    }> = [];
    for (const c of courses) {
      for (const s of this.s.sessions.values()) {
        if (s.courseId !== c.id) continue;
        if (s.endedAt) continue;
        if (s.expiresAt <= now) continue;
        out.push({
          sessionId: s.id,
          courseId: c.id,
          courseCode: c.code,
          courseTitle: c.title,
          code: s.code,
          expiresAt: s.expiresAt,
        });
      }
    }
    return out.sort((a, b) => a.expiresAt - b.expiresAt);
  }

  async deleteAttendanceRecord(recordId: string) {
    this.s.records = this.s.records.filter((r) => r.id !== recordId);
  }
}

async function seedMem(s: MemStore) {
  const passHash = await hashPassword("password123");
  const mkUser = (u: Omit<User, "passwordHash">) => ({ ...u, passwordHash: passHash });

  const csc: Department = { id: nanoid(8), name: "Computer Science", code: "CSC", icon: "Code2", color: "oklch(0.5 0.18 250)" };
  const mth: Department = { id: nanoid(8), name: "Mathematics", code: "MTH", icon: "Sigma", color: "oklch(0.6 0.16 60)" };
  const eee: Department = { id: nanoid(8), name: "Electrical Engineering", code: "EEE", icon: "Cpu", color: "oklch(0.55 0.16 200)" };
  [csc, mth, eee].forEach((d) => s.departments.set(d.id, d));
  s.siteSettings = defaultSiteSettings();

  const admin = mkUser({ id: nanoid(10), email: "admin@slams.edu", name: "System Administrator", role: "admin", createdAt: Date.now() });
  const lec1 = mkUser({ id: nanoid(10), email: "lecturer@slams.edu", name: "Dr. Amina Yusuf", role: "lecturer", staffId: "STF-1001", departmentId: csc.id, createdAt: Date.now() });
  const lec2 = mkUser({ id: nanoid(10), email: "okafor@slams.edu", name: "Prof. Chuka Okafor", role: "lecturer", staffId: "STF-1002", departmentId: mth.id, createdAt: Date.now() });
  const stu1 = mkUser({ id: nanoid(10), email: "student@slams.edu", name: "Ada Obi", role: "student", matricNo: "CSC/21/1001", departmentId: csc.id, level: "300", createdAt: Date.now() });
  const stu2 = mkUser({ id: nanoid(10), email: "bello@slams.edu", name: "Ibrahim Bello", role: "student", matricNo: "CSC/21/1002", departmentId: csc.id, level: "300", createdAt: Date.now() });
  const stu3 = mkUser({ id: nanoid(10), email: "eze@slams.edu", name: "Ngozi Eze", role: "student", matricNo: "CSC/21/1003", departmentId: csc.id, level: "300", createdAt: Date.now() });
  const stu4 = mkUser({ id: nanoid(10), email: "musa@slams.edu", name: "Fatima Musa", role: "student", matricNo: "MTH/21/2001", departmentId: mth.id, level: "200", createdAt: Date.now() });
  [admin, lec1, lec2, stu1, stu2, stu3, stu4].forEach((u) => s.users.set(u.id, u));

  const c1: Course = { id: nanoid(8), code: "CSC 305", title: "Data Structures & Algorithms", departmentId: csc.id, level: "300", units: 3, lecturerId: lec1.id, enrolledStudentIds: [stu1.id, stu2.id, stu3.id], icon: "Atom", color: "oklch(0.55 0.16 165)", category: "Core", description: "Foundations of data organization, algorithms, and complexity analysis." };
  const c2: Course = { id: nanoid(8), code: "CSC 311", title: "Operating Systems", departmentId: csc.id, level: "300", units: 3, lecturerId: lec1.id, enrolledStudentIds: [stu1.id, stu2.id, stu3.id], icon: "Cpu", color: "oklch(0.5 0.15 220)", category: "Core", description: "Processes, memory, scheduling, and concurrency." };
  const c3: Course = { id: nanoid(8), code: "MTH 201", title: "Linear Algebra", departmentId: mth.id, level: "200", units: 3, lecturerId: lec2.id, enrolledStudentIds: [stu4.id, stu1.id], icon: "Sigma", color: "oklch(0.6 0.16 60)", category: "Core", description: "Vectors, matrices, and linear transformations." };
  [c1, c2, c3].forEach((c) => s.courses.set(c.id, c));

  const day = 24 * 60 * 60 * 1000;
  for (let i = 12; i >= 1; i--) {
    const started = Date.now() - i * day;
    const sess: AttendanceSession = {
      id: nanoid(10),
      courseId: c1.id,
      lecturerId: lec1.id,
      code: String(100000 + Math.floor(Math.random() * 900000)),
      startedAt: started,
      expiresAt: started + 30 * 60 * 1000,
      endedAt: started + 45 * 60 * 1000,
      topic: `Lecture ${13 - i}`,
    };
    s.sessions.set(sess.id, sess);
    for (const sid of c1.enrolledStudentIds) {
      if (Math.random() > 0.15) {
        s.records.push({
          id: nanoid(10),
          sessionId: sess.id,
          studentId: sid,
          courseId: c1.id,
          timestamp: started + Math.floor(Math.random() * 20 * 60 * 1000),
        });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// D1 implementation (production)
// ═══════════════════════════════════════════════════════════════════════════

class D1Repo implements Repo {
  constructor(private db: D1Database) {}

  private async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.db.prepare(sql).bind(...params).all<T>();
    return (r.results ?? []) as T[];
  }
  private async first<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.db.prepare(sql).bind(...params).first<T>()) as T | null;
  }
  private async run(sql: string, params: unknown[] = []) {
    await this.db.prepare(sql).bind(...params).run();
  }

  private rowToUser(r: any): Omit<User, "passwordHash"> {
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      matricNo: r.matric_no ?? undefined,
      staffId: r.staff_id ?? undefined,
      departmentId: r.department_id ?? undefined,
      level: r.level ?? undefined,
      createdAt: r.created_at,
    };
  }
  private rowToCourse(r: any, enrolledStudentIds: string[] = []): Course {
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      departmentId: r.department_id,
      level: r.level,
      units: r.units,
      lecturerId: r.lecturer_id ?? undefined,
      enrolledStudentIds,
      icon: r.icon ?? undefined,
      color: r.color ?? undefined,
      category: r.category ?? undefined,
      description: r.description ?? undefined,
    };
  }

  async ensureSeeded() {
    const depts = await this.first<{ c: number }>("SELECT COUNT(*) AS c FROM departments");
    if (depts && depts.c > 0) return;
    await seedD1(this.db);
  }

  async getUserByEmail(email: string) {
    const r = await this.first<any>("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email]);
    return r ? this.rowToUser(r) : undefined;
  }
  async verifyCredentials(email: string, password: string) {
    const r = await this.first<any>("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email]);
    if (!r) return null;
    const ok = await verifyPassword(password, r.password_hash);
    return ok ? this.rowToUser(r) : null;
  }
  async getUser(id: string) {
    const r = await this.first<any>("SELECT * FROM users WHERE id = ?", [id]);
    return r ? this.rowToUser(r) : undefined;
  }
  async listUsers(role?: Role) {
    const rows = role
      ? await this.all<any>("SELECT * FROM users WHERE role = ? ORDER BY name ASC", [role])
      : await this.all<any>("SELECT * FROM users ORDER BY name ASC");
    return rows.map((r) => this.rowToUser(r));
  }
  async createUser(input: Parameters<Repo["createUser"]>[0]) {
    const id = nanoid(10);
    await this.run(
      `INSERT INTO users (id, email, password_hash, name, role, matric_no, staff_id, department_id, level, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.email,
        await hashPassword(input.password),
        input.name,
        input.role,
        input.matricNo ?? null,
        input.staffId ?? null,
        input.departmentId ?? null,
        input.level ?? null,
        Date.now(),
      ],
    );
    return id;
  }
  async emailExists(email: string) {
    const r = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users WHERE LOWER(email) = LOWER(?)",
      [email],
    );
    return !!r && r.c > 0;
  }
  async deleteUser(id: string) {
    await this.run("DELETE FROM users WHERE id = ?", [id]);
    await this.run("DELETE FROM course_enrollments WHERE student_id = ?", [id]);
    await this.run("UPDATE courses SET lecturer_id = NULL WHERE lecturer_id = ?", [id]);
  }
  async listDepartments() {
    return this.all<Department>("SELECT * FROM departments ORDER BY name ASC");
  }
  async createDepartment(name: string, code: string, icon?: string, color?: string) {
    const d: Department = { id: nanoid(8), name, code: code.toUpperCase(), icon, color };
    await this.run("INSERT INTO departments (id, name, code, icon, color) VALUES (?, ?, ?, ?, ?)", [d.id, d.name, d.code, d.icon ?? null, d.color ?? null]);
    return d;
  }
  async deleteDepartment(id: string) {
    await this.run("DELETE FROM departments WHERE id = ?", [id]);
  }
  async listCourses(): Promise<Course[]> {
    const rows = await this.all<any>("SELECT * FROM courses ORDER BY code ASC");
    const enroll = await this.all<{ course_id: string; student_id: string }>(
      "SELECT course_id, student_id FROM course_enrollments",
    );
    const byCourse = new Map<string, string[]>();
    for (const e of enroll) {
      if (!byCourse.has(e.course_id)) byCourse.set(e.course_id, []);
      byCourse.get(e.course_id)!.push(e.student_id);
    }
    return rows.map((r) => this.rowToCourse(r, byCourse.get(r.id) ?? []));
  }
  async getCourse(id: string): Promise<Course | undefined> {
    const r = await this.first<any>("SELECT * FROM courses WHERE id = ?", [id]);
    if (!r) return undefined;
    const enroll = await this.all<{ student_id: string }>(
      "SELECT student_id FROM course_enrollments WHERE course_id = ?",
      [id],
    );
    return this.rowToCourse(
      r,
      enroll.map((e) => e.student_id),
    );
  }
  async createCourse(input: Parameters<Repo["createCourse"]>[0]) {
    const c: Course = {
      id: nanoid(8),
      code: input.code.toUpperCase(),
      title: input.title,
      departmentId: input.departmentId,
      level: input.level,
      units: input.units,
      enrolledStudentIds: [],
      icon: input.icon,
      color: input.color,
      category: input.category,
      description: input.description,
    };
    await this.run(
      "INSERT INTO courses (id, code, title, department_id, level, units, lecturer_id, icon, color, category, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [c.id, c.code, c.title, c.departmentId, c.level, c.units, null, c.icon ?? null, c.color ?? null, c.category ?? null, c.description ?? null],
    );
    return c;
  }
  async deleteCourse(id: string) {
    await this.run("DELETE FROM courses WHERE id = ?", [id]);
    await this.run("DELETE FROM course_enrollments WHERE course_id = ?", [id]);
  }
  async assignLecturer(courseId: string, lecturerId: string | null) {
    await this.run("UPDATE courses SET lecturer_id = ? WHERE id = ?", [lecturerId, courseId]);
  }
  async setEnrollments(courseId: string, studentIds: string[]) {
    await this.run("DELETE FROM course_enrollments WHERE course_id = ?", [courseId]);
    for (const sid of studentIds) {
      await this.run(
        "INSERT OR IGNORE INTO course_enrollments (course_id, student_id) VALUES (?, ?)",
        [courseId, sid],
      );
    }
  }
  async lecturerCourses(lecturerId: string): Promise<Course[]> {
    const all = await this.listCourses();
    return all.filter((c) => c.lecturerId === lecturerId);
  }
  async studentCourses(studentId: string): Promise<StudentCourseView[]> {
    const enroll = await this.all<{ course_id: string }>(
      "SELECT course_id FROM course_enrollments WHERE student_id = ?",
      [studentId],
    );
    const courses = await Promise.all(enroll.map((e) => this.getCourse(e.course_id)));
    const sessions = await this.all<{ id: string; course_id: string; started_at: number }>(
      "SELECT id, course_id, started_at FROM sessions",
    );
    const records = await this.all<{ course_id: string; student_id: string }>(
      "SELECT course_id, student_id FROM attendance_records",
    );
    const result: StudentCourseView[] = [];
    for (const c of courses) {
      if (!c) continue;
      const lecturer = c.lecturerId ? await this.getUser(c.lecturerId) : undefined;
      const total = sessions.filter((s) => s.course_id === c.id).length;
      const attended = records.filter(
        (r) => r.course_id === c.id && r.student_id === studentId,
      ).length;
      result.push({
        ...c,
        lecturerName: lecturer?.name ?? "Unassigned",
        totalSessions: total,
        attendedSessions: attended,
        percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
      });
    }
    return result;
  }
  async startSession(input: Parameters<Repo["startSession"]>[0]) {
    const now = Date.now();
    const s: AttendanceSession = {
      id: nanoid(10),
      courseId: input.courseId,
      lecturerId: input.lecturerId,
      code: generateCode(),
      startedAt: now,
      expiresAt: now + input.durationMinutes * 60 * 1000,
      topic: input.topic,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
    };
    await this.run(
      `INSERT INTO sessions (id, course_id, lecturer_id, code, started_at, expires_at, ended_at, latitude, longitude, radius_meters, topic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id,
        s.courseId,
        s.lecturerId,
        s.code,
        s.startedAt,
        s.expiresAt,
        null,
        s.latitude ?? null,
        s.longitude ?? null,
        s.radiusMeters ?? null,
        s.topic ?? null,
      ],
    );
    return s;
  }
  async endSession(sessionId: string) {
    await this.run("UPDATE sessions SET ended_at = ? WHERE id = ?", [Date.now(), sessionId]);
  }
  async getSession(sessionId: string) {
    const r = await this.first<any>("SELECT * FROM sessions WHERE id = ?", [sessionId]);
    if (!r) return undefined;
    return this.rowToSession(r);
  }
  async getAttendanceRecord(recordId: string) {
    const r = await this.first<any>("SELECT * FROM attendance_records WHERE id = ?", [recordId]);
    if (!r) return undefined;
    return {
      id: r.id,
      sessionId: r.session_id,
      studentId: r.student_id,
      courseId: r.course_id,
      timestamp: r.timestamp,
      latitude: r.latitude ?? undefined,
      longitude: r.longitude ?? undefined,
    };
  }
  private rowToSession(r: any): AttendanceSession {
    return {
      id: r.id,
      courseId: r.course_id,
      lecturerId: r.lecturer_id,
      code: r.code,
      startedAt: r.started_at,
      expiresAt: r.expires_at,
      endedAt: r.ended_at ?? undefined,
      latitude: r.latitude ?? undefined,
      longitude: r.longitude ?? undefined,
      radiusMeters: r.radius_meters ?? undefined,
      topic: r.topic ?? undefined,
    };
  }
  async listSessionsForCourse(courseId: string) {
    const rows = await this.all<any>("SELECT * FROM sessions WHERE course_id = ? ORDER BY started_at DESC", [courseId]);
    return rows.map((r) => this.rowToSession(r));
  }
  async sessionDetail(sessionId: string) {
    const s = await this.getSession(sessionId);
    if (!s) return undefined;
    const course = await this.getCourse(s.courseId);
    if (!course) return undefined;
    const rows = await this.all<any>(
      `SELECT ar.*, u.name AS student_name, u.matric_no
       FROM attendance_records ar JOIN users u ON u.id = ar.student_id
       WHERE ar.session_id = ? ORDER BY ar.timestamp ASC`,
      [sessionId],
    );
    const attendance = rows.map((r) => ({
      id: r.id,
      studentId: r.student_id,
      name: r.student_name ?? "Unknown",
      matricNo: r.matric_no ?? "—",
      timestamp: r.timestamp,
    }));
    return { session: s, course, totalEnrolled: course.enrolledStudentIds.length, attendance };
  }
  async submitAttendance(input: Parameters<Repo["submitAttendance"]>[0]) {
    const now = Date.now();
    const r = await this.first<any>(
      "SELECT * FROM sessions WHERE code = ? AND ended_at IS NULL AND expires_at > ? LIMIT 1",
      [input.code, now],
    );
    if (!r) throw new Error("Invalid or expired attendance code");
    const s = this.rowToSession(r);
    const course = await this.getCourse(s.courseId);
    if (!course) throw new Error("Course not found");
    if (!course.enrolledStudentIds.includes(input.studentId))
      throw new Error("You are not enrolled in this course");
    const dup = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM attendance_records WHERE session_id = ? AND student_id = ?",
      [s.id, input.studentId],
    );
    if (dup && dup.c > 0) throw new Error("Attendance already submitted for this session");
    if (s.latitude != null && s.longitude != null && s.radiusMeters != null) {
      if (input.latitude == null || input.longitude == null)
        throw new Error("Location required for this session");
      const dist = haversineMeters(
        { lat: s.latitude, lng: s.longitude },
        { lat: input.latitude, lng: input.longitude },
      );
      if (dist > s.radiusMeters)
        throw new Error(`You are ${Math.round(dist)}m from the venue (max ${s.radiusMeters}m)`);
    }
    await this.run(
      `INSERT INTO attendance_records (id, session_id, student_id, course_id, timestamp, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(10),
        s.id,
        input.studentId,
        s.courseId,
        now,
        input.latitude ?? null,
        input.longitude ?? null,
      ],
    );
    return { course: { code: course.code, title: course.title }, timestamp: now };
  }
  async studentHistory(studentId: string) {
    const rows = await this.all<any>(
      `SELECT ar.id, ar.timestamp, c.code AS course_code, c.title AS course_title
       FROM attendance_records ar JOIN courses c ON c.id = ar.course_id
       WHERE ar.student_id = ? ORDER BY ar.timestamp DESC`,
      [studentId],
    );
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      courseCode: r.course_code ?? "—",
      courseTitle: r.course_title ?? "—",
    }));
  }
  async courseReport(courseId: string) {
    const course = await this.getCourse(courseId);
    if (!course) return undefined;
    const sessions = await this.all<any>(
      "SELECT * FROM sessions WHERE course_id = ? ORDER BY started_at ASC",
      [courseId],
    );
    const total = sessions.length;
    const students = await Promise.all(
      course.enrolledStudentIds.map(async (sid) => {
        const u = await this.getUser(sid);
        const rec = await this.first<{ c: number }>(
          "SELECT COUNT(*) AS c FROM attendance_records WHERE course_id = ? AND student_id = ?",
          [courseId, sid],
        );
        const attended = rec?.c ?? 0;
        return {
          id: sid,
          name: u?.name ?? "Unknown",
          matricNo: u?.matricNo ?? "—",
          attended,
          percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
        };
      }),
    );
    return {
      course: { id: course.id, code: course.code, title: course.title, level: course.level, units: course.units },
      totalSessions: total,
      sessions: sessions.map((r) => this.rowToSession(r)),
      students: students.sort((a, b) => b.percentage - a.percentage),
    };
  }
  async adminOverview() {
    const users = await this.all<any>("SELECT role FROM users");
    const courses = await this.all<any>("SELECT id, code FROM courses");
    const sessionRows = await this.all<any>("SELECT id, course_id, started_at, ended_at FROM sessions");
    const recordRows = await this.all<any>("SELECT session_id, timestamp FROM attendance_records");
    const deptCount = await this.first<{ c: number }>("SELECT COUNT(*) AS c FROM departments");
    const enrollRows = await this.all<{ course_id: string }>("SELECT course_id FROM course_enrollments");

    const enrolledByCourse = new Map<string, number>();
    for (const e of enrollRows) {
      enrolledByCourse.set(e.course_id, (enrolledByCourse.get(e.course_id) ?? 0) + 1);
    }
    const courseById = new Map(courses.map((c) => [c.id, c]));

    const sessions = sessionRows.map((s) => ({
      id: s.id,
      courseId: s.course_id,
      startedAt: s.started_at,
      endedAt: s.ended_at ?? undefined,
    }));
    const records = recordRows.map((r) => ({ sessionId: r.session_id, timestamp: r.timestamp }));

    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const weeklyAttendance: Array<{ label: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const start = now - i * day;
      const d = new Date(start);
      const label = d.toLocaleDateString("en", { weekday: "short" });
      const count = records.filter(
        (r) => r.timestamp >= start - day / 2 && r.timestamp <= start + day / 2,
      ).length;
      weeklyAttendance.push({ label, count });
    }

    return {
      counts: {
        students: users.filter((u) => u.role === "student").length,
        lecturers: users.filter((u) => u.role === "lecturer").length,
        courses: courses.length,
        departments: deptCount?.c ?? 0,
        sessions: sessions.length,
        attendance: records.length,
      },
      recentSessions: sessions
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 8)
        .map((s) => {
          const c = courseById.get(s.courseId);
          return {
            id: s.id,
            courseCode: c?.code ?? "—",
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            attended: records.filter((r) => r.sessionId === s.id).length,
            enrolled: enrolledByCourse.get(s.courseId) ?? 0,
          };
        }),
      weeklyAttendance,
    };
  }

  // ── updates / settings / record deletion (D1) ──
  async facultyReport() {
    const courses = await this.listCourses();
    const sessions = await this.all<{ id: string; course_id: string }>("SELECT id, course_id FROM sessions");
    const records = await this.all<{ course_id: string; student_id: string }>(
      "SELECT course_id, student_id FROM attendance_records",
    );
    const enrollRows = await this.all<{ course_id: string; student_id: string }>(
      "SELECT course_id, student_id FROM course_enrollments",
    );
    const courseSummaries = courses.map((c) => {
      const total = sessions.filter((s) => s.course_id === c.id).length;
      const enrolled = c.enrolledStudentIds.length;
      let att = 0;
      for (const sid of c.enrolledStudentIds)
        att += records.filter((r) => r.course_id === c.id && r.student_id === sid).length;
      const denom = total * Math.max(1, enrolled);
      return {
        id: c.id,
        code: c.code,
        title: c.title,
        enrolled,
        sessions: total,
        avg: denom === 0 ? 0 : Math.round((att / denom) * 100),
      };
    });
    const studentIds = new Set(enrollRows.map((e) => e.student_id));
    const students: Array<{
      id: string; name: string; matricNo: string; courses: number; attended: number; total: number; percentage: number;
    }> = [];
    for (const sid of studentIds) {
      const u = await this.getUser(sid);
      let attended = 0;
      let total = 0;
      for (const c of courses) {
        if (!c.enrolledStudentIds.includes(sid)) continue;
        total += sessions.filter((s) => s.course_id === c.id).length;
        attended += records.filter((r) => r.course_id === c.id && r.student_id === sid).length;
      }
      students.push({
        id: sid,
        name: u?.name ?? "Unknown",
        matricNo: u?.matricNo ?? "—",
        courses: courses.filter((c) => c.enrolledStudentIds.includes(sid)).length,
        attended,
        total,
        percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
      });
    }
    students.sort((a, b) => b.percentage - a.percentage);
    return { courses: courseSummaries, students };
  }

  async updateStudent(id: string, input: Parameters<Repo["updateStudent"]>[1]) {
    const existing = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users WHERE LOWER(email)=LOWER(?) AND id != ?",
      [input.email, id],
    );
    if (existing && existing.c > 0) throw new Error("Email already in use");
    await this.run(
      "UPDATE users SET name=?, email=?, matric_no=?, department_id=?, level=? WHERE id=?",
      [input.name, input.email, input.matricNo, input.departmentId, input.level, id],
    );
    if (input.password)
      await this.run("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(input.password), id]);
  }

  async updateLecturer(id: string, input: Parameters<Repo["updateLecturer"]>[1]) {
    const existing = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users WHERE LOWER(email)=LOWER(?) AND id != ?",
      [input.email, id],
    );
    if (existing && existing.c > 0) throw new Error("Email already in use");
    await this.run(
      "UPDATE users SET name=?, email=?, staff_id=?, department_id=? WHERE id=?",
      [input.name, input.email, input.staffId, input.departmentId, id],
    );
    if (input.password)
      await this.run("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(input.password), id]);
  }

  async updateDepartment(id: string, name: string, code: string, icon?: string, color?: string) {
    await this.run("UPDATE departments SET name=?, code=?, icon=?, color=? WHERE id=?", [name, code.toUpperCase(), icon ?? null, color ?? null, id]);
  }

  async updateCourse(id: string, input: Parameters<Repo["updateCourse"]>[1]) {
    await this.run(
      "UPDATE courses SET code=?, title=?, department_id=?, level=?, units=?, icon=?, color=?, category=?, description=? WHERE id=?",
      [input.code.toUpperCase(), input.title, input.departmentId, input.level, input.units, input.icon ?? null, input.color ?? null, input.category ?? null, input.description ?? null, id],
    );
  }

  async getSiteSettings() {
    const r = await this.first<any>("SELECT * FROM site_settings WHERE id = ?", ["site"]);
    if (!r) {
      const def = defaultSiteSettings();
      await this.run(
        `INSERT INTO site_settings (id, institution_name, at_risk_threshold, marquee_items, testimonials, demo_accounts_enabled, demo_password, demo_email_domain, show_fake_stats, primary_color, contact_email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [def.id, def.institutionName, def.atRiskThreshold, JSON.stringify(def.marqueeItems), JSON.stringify(def.testimonials), def.demoAccountsEnabled ? 1 : 0, def.demoPassword, def.demoEmailDomain, def.showFakeStats ? 1 : 0, def.primaryColor ?? null, def.contactEmail ?? null],
      );
      return def;
    }
    return this.rowToSiteSettings(r);
  }

  async saveSiteSettings(partial: Partial<SiteSettings>) {
    const current = await this.getSiteSettings();
    const next: SiteSettings = { ...current, ...partial, id: "site" };
    await this.run(
      `UPDATE site_settings SET institution_name=?, at_risk_threshold=?, marquee_items=?, testimonials=?, demo_accounts_enabled=?, demo_password=?, demo_email_domain=?, show_fake_stats=?, primary_color=?, contact_email=? WHERE id=?`,
      [next.institutionName, next.atRiskThreshold, JSON.stringify(next.marqueeItems), JSON.stringify(next.testimonials), next.demoAccountsEnabled ? 1 : 0, next.demoPassword, next.demoEmailDomain, next.showFakeStats ? 1 : 0, next.primaryColor ?? null, next.contactEmail ?? null, "site"],
    );
    return next;
  }

  private rowToSiteSettings(r: any): SiteSettings {
    return {
      id: r.id,
      institutionName: r.institution_name,
      atRiskThreshold: r.at_risk_threshold,
      marqueeItems: safeJsonArray(r.marquee_items, []),
      testimonials: safeJsonArray(r.testimonials, []),
      demoAccountsEnabled: !!r.demo_accounts_enabled,
      demoPassword: r.demo_password,
      demoEmailDomain: r.demo_email_domain,
      showFakeStats: !!r.show_fake_stats,
      primaryColor: r.primary_color ?? null,
      contactEmail: r.contact_email ?? null,
    };
  }

  async listOpenSessionsForStudent(studentId: string) {
    const now = Date.now();
    const enroll = await this.all<{ course_id: string }>(
      "SELECT course_id FROM course_enrollments WHERE student_id = ?",
      [studentId],
    );
    const courseIds = enroll.map((e) => e.course_id);
    if (courseIds.length === 0) return [];
    const rows = await this.all<any>(
      `SELECT s.id AS session_id, s.course_id, s.code, s.expires_at, c.code AS course_code, c.title AS course_title
       FROM sessions s JOIN courses c ON c.id = s.course_id
       WHERE s.ended_at IS NULL AND s.expires_at > ? AND s.course_id IN (${courseIds.map(() => "?").join(",")})`,
      [now, ...courseIds],
    );
    return rows
      .map((r) => ({
        sessionId: r.session_id,
        courseId: r.course_id,
        courseCode: r.course_code,
        courseTitle: r.course_title,
        code: r.code,
        expiresAt: r.expires_at,
      }))
      .sort((a, b) => a.expiresAt - b.expiresAt);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const r = await this.first<any>("SELECT password_hash FROM users WHERE id=?", [userId]);
    if (!r) throw new Error("User not found");
    const ok = await verifyPassword(currentPassword, r.password_hash);
    if (!ok) throw new Error("Current password is incorrect");
    if (newPassword.length < 6) throw new Error("New password must be at least 6 characters");
    await this.run("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(newPassword), userId]);
  }

  async deleteAttendanceRecord(recordId: string) {
    await this.run("DELETE FROM attendance_records WHERE id=?", [recordId]);
  }
}

async function seedD1(db: D1Database) {
  const passHash = await hashPassword("password123");
  const id = (n = 8) => nanoid(n);

  interface U { id: string; email: string; name: string; role: Role; matricNo?: string; staffId?: string; departmentId?: string; level?: string; }
  const csc = { id: id(), name: "Computer Science", code: "CSC", icon: "Code2", color: "oklch(0.5 0.18 250)" };
  const mth = { id: id(), name: "Mathematics", code: "MTH", icon: "Sigma", color: "oklch(0.6 0.16 60)" };
  const eee = { id: id(), name: "Electrical Engineering", code: "EEE", icon: "Cpu", color: "oklch(0.55 0.16 200)" };

  await db.prepare("INSERT INTO departments (id, name, code, icon, color) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)")
    .bind(
      csc.id, csc.name, csc.code, csc.icon, csc.color,
      mth.id, mth.name, mth.code, mth.icon, mth.color,
      eee.id, eee.name, eee.code, eee.icon, eee.color,
    ).run();

  const users: U[] = [
    { id: id(10), email: "admin@slams.edu", name: "System Administrator", role: "admin" },
    { id: id(10), email: "lecturer@slams.edu", name: "Dr. Amina Yusuf", role: "lecturer", staffId: "STF-1001", departmentId: csc.id },
    { id: id(10), email: "okafor@slams.edu", name: "Prof. Chuka Okafor", role: "lecturer", staffId: "STF-1002", departmentId: mth.id },
    { id: id(10), email: "student@slams.edu", name: "Ada Obi", role: "student", matricNo: "CSC/21/1001", departmentId: csc.id, level: "300" },
    { id: id(10), email: "bello@slams.edu", name: "Ibrahim Bello", role: "student", matricNo: "CSC/21/1002", departmentId: csc.id, level: "300" },
    { id: id(10), email: "eze@slams.edu", name: "Ngozi Eze", role: "student", matricNo: "CSC/21/1003", departmentId: csc.id, level: "300" },
    { id: id(10), email: "musa@slams.edu", name: "Fatima Musa", role: "student", matricNo: "MTH/21/2001", departmentId: mth.id, level: "200" },
  ];
  for (const u of users) {
    await db.prepare(
      `INSERT INTO users (id, email, password_hash, name, role, matric_no, staff_id, department_id, level, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(u.id, u.email, passHash, u.name, u.role, u.matricNo ?? null, u.staffId ?? null, u.departmentId ?? null, u.level ?? null, Date.now())
      .run();
  }

  const c1 = { id: id(), code: "CSC 305", title: "Data Structures & Algorithms", departmentId: csc.id, level: "300", units: 3, lecturerId: users[1].id, enrolled: [users[3].id, users[4].id, users[5].id], icon: "Atom", color: "oklch(0.55 0.16 165)", category: "Core", description: "Foundations of data organization, algorithms, and complexity analysis." };
  const c2 = { id: id(), code: "CSC 311", title: "Operating Systems", departmentId: csc.id, level: "300", units: 3, lecturerId: users[1].id, enrolled: [users[3].id, users[4].id, users[5].id], icon: "Cpu", color: "oklch(0.5 0.15 220)", category: "Core", description: "Processes, memory, scheduling, and concurrency." };
  const c3 = { id: id(), code: "MTH 201", title: "Linear Algebra", departmentId: mth.id, level: "200", units: 3, lecturerId: users[2].id, enrolled: [users[6].id, users[3].id], icon: "Sigma", color: "oklch(0.6 0.16 60)", category: "Core", description: "Vectors, matrices, and linear transformations." };
  const courses = [c1, c2, c3];
  for (const c of courses) {
    await db.prepare(
      "INSERT INTO courses (id, code, title, department_id, level, units, lecturer_id, icon, color, category, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(c.id, c.code, c.title, c.departmentId, c.level, c.units, c.lecturerId, c.icon ?? null, c.color ?? null, c.category ?? null, c.description ?? null)
      .run();
    for (const sid of c.enrolled) {
      await db.prepare(
        "INSERT OR IGNORE INTO course_enrollments (course_id, student_id) VALUES (?, ?)",
      ).bind(c.id, sid).run();
    }
  }

  const day = 24 * 60 * 60 * 1000;
  const lec1 = users[1].id;
  for (let i = 12; i >= 1; i--) {
    const started = Date.now() - i * day;
    const sid = id(10);
    const code = String(100000 + Math.floor(Math.random() * 900000));
    await db.prepare(
      `INSERT INTO sessions (id, course_id, lecturer_id, code, started_at, expires_at, ended_at, topic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(sid, c1.id, lec1, code, started, started + 30 * 60 * 1000, started + 45 * 60 * 1000, `Lecture ${13 - i}`)
      .run();
    for (const st of c1.enrolled) {
      if (Math.random() > 0.15) {
        await db.prepare(
          "INSERT INTO attendance_records (id, session_id, student_id, course_id, timestamp) VALUES (?, ?, ?, ?, ?)",
        )
          .bind(id(10), sid, st, c1.id, started + Math.floor(Math.random() * 20 * 60 * 1000))
          .run();
      }
    }
  }

  const def = defaultSiteSettings();
  await db.prepare(
    `INSERT INTO site_settings (id, institution_name, at_risk_threshold, marquee_items, testimonials, demo_accounts_enabled, demo_password, demo_email_domain, show_fake_stats, primary_color, contact_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(def.id, def.institutionName, def.atRiskThreshold, JSON.stringify(def.marqueeItems), JSON.stringify(def.testimonials), def.demoAccountsEnabled ? 1 : 0, def.demoPassword, def.demoEmailDomain, def.showFakeStats ? 1 : 0, def.primaryColor ?? null, def.contactEmail ?? null)
    .run();
}

// ─── Selector ───────────────────────────────────────────────────────────────

let memSingleton: MemRepo | null = null;

export async function getRepo(): Promise<Repo> {
  const d1 = await getD1();
  if (d1) {
    const repo = new D1Repo(d1);
    await repo.ensureSeeded();
    return repo;
  }
  if (!memSingleton) memSingleton = new MemRepo();
  await memSingleton.ensureSeeded();
  return memSingleton;
}
