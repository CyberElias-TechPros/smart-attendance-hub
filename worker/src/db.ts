// SLAMS data layer: a single D1-backed repository.
//
// Local development uses `wrangler dev` (Miniflare emulates D1 locally — no
// Cloudflare account needed), so there is no in-memory fallback to keep in
// sync. The narrow `D1Database` interface below is what the repo depends on,
// which also lets unit tests inject a shim (see worker/tests).

import { nanoid } from "nanoid";
import { BusinessError } from "./errors";
import { dummyVerify, hashPassword, verifyPassword, type SessionPayload } from "./auth";
import type {
  AdminOverview,
  AttendanceRecord,
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
  Testimonial,
  User,
} from "./types";

// ─── D1 surface ────────────────────────────────────────────────────────────

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta: unknown }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

// ─── Pure helpers ──────────────────────────────────────────────────────────

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

function toPublicSettings(s: SiteSettings): PublicSettings {
  const out: PublicSettings = {
    institutionName: s.institutionName,
    marqueeItems: s.marqueeItems,
    testimonials: s.testimonials,
    demoAccountsEnabled: s.demoAccountsEnabled,
    demoEmailDomain: s.demoEmailDomain,
    showFakeStats: s.showFakeStats,
    primaryColor: s.primaryColor,
    contactEmail: s.contactEmail,
    // The demo password is intentionally shown on the landing/login pages,
    // but only while demo accounts are enabled.
    demoPassword: s.demoAccountsEnabled ? s.demoPassword : "",
  };
  return out;
}

// ─── Repository ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const optStr = (v: unknown): string | undefined => (v == null ? undefined : String(v));
const optNum = (v: unknown): number | undefined => (v == null ? undefined : Number(v));

export class Repo {
  constructor(private db: D1Database) {}

  private async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.db
      .prepare(sql)
      .bind(...params)
      .all<Row>();
    return (r.results ?? []) as T[];
  }
  private async first<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.db
      .prepare(sql)
      .bind(...params)
      .first<Row>()) as T | null;
  }
  private async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.db
      .prepare(sql)
      .bind(...params)
      .run();
  }

  private rowToUser(r: Row): User {
    return {
      id: str(r.id),
      email: str(r.email),
      name: str(r.name),
      role: str(r.role) as Role,
      matricNo: optStr(r.matric_no),
      staffId: optStr(r.staff_id),
      departmentId: optStr(r.department_id),
      level: optStr(r.level),
      createdAt: num(r.created_at),
    };
  }

  private rowToCourse(r: Row, enrolled: string[] = []): Course {
    return {
      id: str(r.id),
      code: str(r.code),
      title: str(r.title),
      departmentId: str(r.department_id),
      level: str(r.level),
      units: num(r.units),
      lecturerId: optStr(r.lecturer_id),
      enrolledStudentIds: enrolled,
      icon: optStr(r.icon),
      color: optStr(r.color),
      category: optStr(r.category),
      description: optStr(r.description),
    };
  }

  private rowToSession(r: Row): AttendanceSession {
    return {
      id: str(r.id),
      courseId: str(r.course_id),
      lecturerId: str(r.lecturer_id),
      code: str(r.code),
      startedAt: num(r.started_at),
      expiresAt: num(r.expires_at),
      endedAt: optNum(r.ended_at),
      latitude: optNum(r.latitude),
      longitude: optNum(r.longitude),
      radiusMeters: optNum(r.radius_meters),
      topic: optStr(r.topic),
    };
  }

  private rowToSettings(r: Row): SiteSettings {
    return {
      id: str(r.id),
      institutionName: str(r.institution_name),
      atRiskThreshold: num(r.at_risk_threshold),
      marqueeItems: safeJsonArray<string>(r.marquee_items, []),
      testimonials: safeJsonArray<Testimonial>(r.testimonials, []),
      demoAccountsEnabled: !!r.demo_accounts_enabled,
      demoPassword: str(r.demo_password),
      demoEmailDomain: str(r.demo_email_domain),
      showFakeStats: !!r.show_fake_stats,
      primaryColor: r.primary_color == null ? null : String(r.primary_color),
      contactEmail: r.contact_email == null ? null : String(r.contact_email),
    };
  }

  private async enrollmentsForCourses(courseIds: string[]): Promise<Map<string, string[]>> {
    const byCourse = new Map<string, string[]>();
    if (courseIds.length === 0) return byCourse;
    const marks = courseIds.map(() => "?").join(",");
    const rows = await this.all<{ course_id: string; student_id: string }>(
      `SELECT course_id, student_id FROM course_enrollments WHERE course_id IN (${marks})`,
      courseIds,
    );
    for (const e of rows) {
      if (!byCourse.has(e.course_id)) byCourse.set(e.course_id, []);
      byCourse.get(e.course_id)!.push(e.student_id);
    }
    return byCourse;
  }

  // ── Seeding ──

  async ensureSeeded(): Promise<void> {
    const depts = await this.first<{ c: number }>("SELECT COUNT(*) AS c FROM departments");
    if (depts && depts.c > 0) return;
    const { seedD1 } = await import("./seed");
    await seedD1(this.db);
  }

  // ── Users / auth ──

  async verifyCredentials(email: string, password: string): Promise<User | null> {
    const r = await this.first<Row>("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email]);
    if (!r) {
      await dummyVerify(password); // equalize timing across known/unknown users
      return null;
    }
    const ok = await verifyPassword(password, str(r.password_hash));
    if (!ok) return null;
    return this.rowToUser(r);
  }

  async getUser(id: string): Promise<User | undefined> {
    const r = await this.first<Row>("SELECT * FROM users WHERE id = ?", [id]);
    return r ? this.rowToUser(r) : undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const r = await this.first<Row>("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email]);
    return r ? this.rowToUser(r) : undefined;
  }

  async countAdmins(): Promise<number> {
    const r = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin'",
    );
    return r?.c ?? 0;
  }

  async listUsers(role?: Role): Promise<User[]> {
    const rows = role
      ? await this.all<Row>("SELECT * FROM users WHERE role = ? ORDER BY name ASC", [role])
      : await this.all<Row>("SELECT * FROM users ORDER BY name ASC");
    return rows.map((r) => this.rowToUser(r));
  }

  async createUser(input: {
    name: string;
    email: string;
    password: string;
    role: Role;
    matricNo?: string;
    staffId?: string;
    departmentId?: string;
    level?: string;
  }): Promise<string> {
    // Case-insensitive uniqueness (the DB constraint alone is case-sensitive).
    const dup = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users WHERE LOWER(email) = LOWER(?)",
      [input.email],
    );
    if (dup && dup.c > 0) throw new BusinessError("Email already in use");
    const id = nanoid(10);
    try {
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
    } catch (e) {
      throw friendlyUniqueError(e, "Email already in use");
    }
    return id;
  }

  async updateStudent(
    id: string,
    input: {
      name: string;
      email: string;
      matricNo?: string;
      departmentId?: string;
      level?: string;
      password?: string;
    },
  ): Promise<void> {
    const u = await this.getUser(id);
    if (!u) throw new BusinessError("User not found");
    const taken = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users WHERE LOWER(email) = LOWER(?) AND id != ?",
      [input.email, id],
    );
    if (taken && taken.c > 0) throw new BusinessError("Email already in use");
    await this.run(
      "UPDATE users SET name=?, email=?, matric_no=?, department_id=?, level=? WHERE id=?",
      [
        input.name,
        input.email,
        // Omitted fields keep existing values; "" department → NULL (unassigned).
        input.matricNo ?? u.matricNo ?? null,
        input.departmentId === undefined ? (u.departmentId ?? null) : input.departmentId || null,
        input.level ?? u.level ?? null,
        id,
      ],
    );
    if (input.password) {
      await this.run("UPDATE users SET password_hash=? WHERE id=?", [
        await hashPassword(input.password),
        id,
      ]);
    }
  }

  async updateLecturer(
    id: string,
    input: {
      name: string;
      email: string;
      staffId?: string;
      departmentId?: string;
      password?: string;
    },
  ): Promise<void> {
    const u = await this.getUser(id);
    if (!u) throw new BusinessError("User not found");
    const taken = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users WHERE LOWER(email) = LOWER(?) AND id != ?",
      [input.email, id],
    );
    if (taken && taken.c > 0) throw new BusinessError("Email already in use");
    // Omitted fields keep their existing values (partial updates must not
    // wipe data); an explicit "" department means "unassigned" → NULL.
    await this.run("UPDATE users SET name=?, email=?, staff_id=?, department_id=? WHERE id=?", [
      input.name,
      input.email,
      input.staffId ?? u.staffId ?? null,
      input.departmentId === undefined ? (u.departmentId ?? null) : input.departmentId || null,
      id,
    ]);
    if (input.password) {
      await this.run("UPDATE users SET password_hash=? WHERE id=?", [
        await hashPassword(input.password),
        id,
      ]);
    }
  }

  async updateAdmin(
    id: string,
    input: { name: string; email: string; password?: string },
  ): Promise<void> {
    const u = await this.getUser(id);
    if (!u) throw new BusinessError("User not found");
    const taken = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM users WHERE LOWER(email) = LOWER(?) AND id != ?",
      [input.email, id],
    );
    if (taken && taken.c > 0) throw new BusinessError("Email already in use");
    await this.run("UPDATE users SET name=?, email=? WHERE id=?", [input.name, input.email, id]);
    if (input.password) {
      await this.run("UPDATE users SET password_hash=? WHERE id=?", [
        await hashPassword(input.password),
        id,
      ]);
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const r = await this.first<Row>("SELECT password_hash FROM users WHERE id=?", [userId]);
    if (!r) throw new BusinessError("User not found");
    const ok = await verifyPassword(currentPassword, str(r.password_hash));
    if (!ok) throw new BusinessError("Current password is incorrect");
    if (newPassword.length < 8)
      throw new BusinessError("New password must be at least 8 characters");
    await this.run("UPDATE users SET password_hash=? WHERE id=?", [
      await hashPassword(newPassword),
      userId,
    ]);
  }

  /** Cascades: enrollments, attendance records, and (for lecturers) their sessions. */
  async deleteUser(id: string): Promise<void> {
    const u = await this.getUser(id);
    if (!u) throw new BusinessError("User not found");
    if (u.role === "admin" && (await this.countAdmins()) <= 1) {
      throw new BusinessError("Cannot delete the last administrator");
    }
    await this.run("DELETE FROM course_enrollments WHERE student_id = ?", [id]);
    await this.run("DELETE FROM attendance_records WHERE student_id = ?", [id]);
    // Lecturer sessions go away too — and so must every sign-in recorded
    // against them, otherwise course percentages (records ÷ sessions) inflate
    // past 100% and reports reference sessions that no longer exist.
    await this.run(
      "DELETE FROM attendance_records WHERE session_id IN (SELECT id FROM sessions WHERE lecturer_id = ?)",
      [id],
    );
    await this.run("DELETE FROM sessions WHERE lecturer_id = ?", [id]);
    await this.run("UPDATE courses SET lecturer_id = NULL WHERE lecturer_id = ?", [id]);
    await this.run("DELETE FROM users WHERE id = ?", [id]);
  }

  // ── Departments ──

  async listDepartments(): Promise<Department[]> {
    return (await this.all<Row>("SELECT * FROM departments ORDER BY name ASC")).map((r) => ({
      id: str(r.id),
      name: str(r.name),
      code: str(r.code),
      icon: optStr(r.icon),
      color: optStr(r.color),
    }));
  }

  async createDepartment(
    name: string,
    code: string,
    icon?: string,
    color?: string,
  ): Promise<Department> {
    const dup = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM departments WHERE LOWER(code) = LOWER(?)",
      [code],
    );
    if (dup && dup.c > 0) throw new BusinessError("A department with this code already exists");
    const d: Department = { id: nanoid(8), name, code: code.toUpperCase(), icon, color };
    await this.run("INSERT INTO departments (id, name, code, icon, color) VALUES (?, ?, ?, ?, ?)", [
      d.id,
      d.name,
      d.code,
      icon ?? null,
      color ?? null,
    ]);
    return d;
  }

  async updateDepartment(
    id: string,
    name: string,
    code: string,
    icon?: string,
    color?: string,
  ): Promise<void> {
    const dup = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM departments WHERE LOWER(code) = LOWER(?) AND id != ?",
      [code, id],
    );
    if (dup && dup.c > 0) throw new BusinessError("A department with this code already exists");
    await this.run("UPDATE departments SET name=?, code=?, icon=?, color=? WHERE id=?", [
      name,
      code.toUpperCase(),
      icon ?? null,
      color ?? null,
      id,
    ]);
  }

  async deleteDepartment(id: string): Promise<void> {
    const courses = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM courses WHERE department_id = ?",
      [id],
    );
    if (courses && courses.c > 0) {
      throw new BusinessError(
        `Cannot delete department: ${courses.c} course(s) still belong to it. Reassign or delete them first.`,
      );
    }
    await this.run("UPDATE users SET department_id = NULL WHERE department_id = ?", [id]);
    await this.run("DELETE FROM departments WHERE id = ?", [id]);
  }

  // ── Courses ─

  async listCourses(): Promise<Course[]> {
    const rows = await this.all<Row>("SELECT * FROM courses ORDER BY code ASC");
    const byCourse = await this.enrollmentsForCourses(rows.map((r) => str(r.id)));
    return rows.map((r) => this.rowToCourse(r, byCourse.get(str(r.id)) ?? []));
  }

  async getCourse(id: string): Promise<Course | undefined> {
    const r = await this.first<Row>("SELECT * FROM courses WHERE id = ?", [id]);
    if (!r) return undefined;
    const byCourse = await this.enrollmentsForCourses([id]);
    return this.rowToCourse(r, byCourse.get(id) ?? []);
  }

  async getCourseByCode(code: string): Promise<Course | undefined> {
    const r = await this.first<Row>("SELECT * FROM courses WHERE LOWER(code) = LOWER(?)", [code]);
    if (!r) return undefined;
    const byCourse = await this.enrollmentsForCourses([str(r.id)]);
    return this.rowToCourse(r, byCourse.get(str(r.id)) ?? []);
  }

  async createCourse(input: {
    code: string;
    title: string;
    departmentId: string;
    level: string;
    units: number;
    icon?: string;
    color?: string;
    category?: string;
    description?: string;
  }): Promise<Course> {
    const code = input.code.toUpperCase().trim();
    const dup = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM courses WHERE LOWER(code) = LOWER(?)",
      [code],
    );
    if (dup && dup.c > 0) throw new BusinessError("A course with this code already exists");
    const dept = await this.first<Row>("SELECT id FROM departments WHERE id = ?", [
      input.departmentId,
    ]);
    if (!dept) throw new BusinessError("Department not found");
    const c: Course = {
      id: nanoid(8),
      code,
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
      [
        c.id,
        c.code,
        c.title,
        c.departmentId,
        c.level,
        c.units,
        null,
        c.icon ?? null,
        c.color ?? null,
        c.category ?? null,
        c.description ?? null,
      ],
    );
    return c;
  }

  async updateCourse(
    id: string,
    input: {
      code: string;
      title: string;
      departmentId: string;
      level: string;
      units: number;
      icon?: string;
      color?: string;
      category?: string;
      description?: string;
    },
  ): Promise<void> {
    const c = await this.getCourse(id);
    if (!c) throw new BusinessError("Course not found");
    const code = input.code.toUpperCase().trim();
    const dup = await this.first<{ c2: number }>(
      "SELECT COUNT(*) AS c2 FROM courses WHERE LOWER(code) = LOWER(?) AND id != ?",
      [code, id],
    );
    if (dup && dup.c2 > 0) throw new BusinessError("A course with this code already exists");
    const dept = await this.first<Row>("SELECT id FROM departments WHERE id = ?", [
      input.departmentId,
    ]);
    if (!dept) throw new BusinessError("Department not found");
    await this.run(
      "UPDATE courses SET code=?, title=?, department_id=?, level=?, units=?, icon=?, color=?, category=?, description=? WHERE id=?",
      [
        code,
        input.title,
        input.departmentId,
        input.level,
        input.units,
        input.icon ?? null,
        input.color ?? null,
        input.category ?? null,
        input.description ?? null,
        id,
      ],
    );
  }

  /** Cascades sessions and attendance records for the course. */
  async deleteCourse(id: string): Promise<void> {
    const c = await this.getCourse(id);
    if (!c) throw new BusinessError("Course not found");
    await this.run("DELETE FROM attendance_records WHERE course_id = ?", [id]);
    await this.run("DELETE FROM sessions WHERE course_id = ?", [id]);
    await this.run("DELETE FROM course_enrollments WHERE course_id = ?", [id]);
    await this.run("DELETE FROM courses WHERE id = ?", [id]);
  }

  async assignLecturer(courseId: string, lecturerId: string | null): Promise<void> {
    const c = await this.getCourse(courseId);
    if (!c) throw new BusinessError("Course not found");
    if (lecturerId) {
      const l = await this.first<Row>("SELECT id, role FROM users WHERE id = ?", [lecturerId]);
      if (!l || l.role !== "lecturer") throw new BusinessError("Lecturer not found");
    }
    await this.run("UPDATE courses SET lecturer_id = ? WHERE id = ?", [lecturerId, courseId]);
  }

  async setEnrollments(courseId: string, studentIds: string[]): Promise<void> {
    const c = await this.getCourse(courseId);
    if (!c) throw new BusinessError("Course not found");
    const ids = Array.from(new Set(studentIds));
    if (ids.length > 0) {
      const marks = ids.map(() => "?").join(",");
      const ok = await this.first<{ c: number }>(
        `SELECT COUNT(*) AS c FROM users WHERE role = 'student' AND id IN (${marks})`,
        ids,
      );
      if (!ok || ok.c !== ids.length)
        throw new BusinessError("One or more enrolled students do not exist");
    }
    await this.run("DELETE FROM course_enrollments WHERE course_id = ?", [courseId]);
    for (const sid of ids) {
      await this.run(
        "INSERT OR IGNORE INTO course_enrollments (course_id, student_id) VALUES (?, ?)",
        [courseId, sid],
      );
    }
  }

  // ── Course views ──

  async lecturerCourses(lecturerId: string): Promise<Course[]> {
    const rows = await this.all<Row>(
      "SELECT * FROM courses WHERE lecturer_id = ? ORDER BY code ASC",
      [lecturerId],
    );
    const byCourse = await this.enrollmentsForCourses(rows.map((r) => str(r.id)));
    return rows.map((r) => this.rowToCourse(r, byCourse.get(str(r.id)) ?? []));
  }

  async studentCourses(studentId: string): Promise<StudentCourseView[]> {
    const rows = await this.all<Row>(
      `SELECT c.*, l.name AS lecturer_name,
        (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id) AS total_sessions,
        (SELECT COUNT(DISTINCT ar.session_id) FROM attendance_records ar
          WHERE ar.course_id = c.id AND ar.student_id = ?) AS attended_sessions
       FROM courses c
       LEFT JOIN users l ON l.id = c.lecturer_id
       WHERE c.id IN (SELECT course_id FROM course_enrollments WHERE student_id = ?)
       ORDER BY c.code ASC`,
      [studentId, studentId],
    );
    const byCourse = await this.enrollmentsForCourses(rows.map((r) => str(r.id)));
    return rows.map((r) => {
      const total = num(r.total_sessions);
      const attended = num(r.attended_sessions);
      return {
        ...this.rowToCourse(r, byCourse.get(str(r.id)) ?? []),
        lecturerName: optStr(r.lecturer_name) ?? "Unassigned",
        totalSessions: total,
        attendedSessions: attended,
        percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
      };
    });
  }

  // ── Sessions ──

  async startSession(input: {
    courseId: string;
    lecturerId: string;
    durationMinutes: number;
    topic?: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
  }): Promise<AttendanceSession> {
    const now = Date.now();
    // A code must be unique among currently open sessions, otherwise
    // submitAttendance's `WHERE code = ?` lookup would be ambiguous.
    let code = generateCode();
    for (let i = 0; i < 5; i++) {
      const clash = await this.first<{ c: number }>(
        "SELECT COUNT(*) AS c FROM sessions WHERE code = ? AND ended_at IS NULL",
        [code],
      );
      if (!clash || clash.c === 0) break;
      code = generateCode();
    }
    const s: AttendanceSession = {
      id: nanoid(10),
      courseId: input.courseId,
      lecturerId: input.lecturerId,
      code,
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

  async endSession(sessionId: string): Promise<void> {
    const s = await this.getSession(sessionId);
    if (!s) throw new BusinessError("Session not found");
    if (s.endedAt) return; // idempotent
    await this.run("UPDATE sessions SET ended_at = ? WHERE id = ?", [Date.now(), sessionId]);
  }

  async getSession(sessionId: string): Promise<AttendanceSession | undefined> {
    const r = await this.first<Row>("SELECT * FROM sessions WHERE id = ?", [sessionId]);
    return r ? this.rowToSession(r) : undefined;
  }

  async listSessionsForCourse(courseId: string): Promise<AttendanceSession[]> {
    const rows = await this.all<Row>(
      "SELECT * FROM sessions WHERE course_id = ? ORDER BY started_at DESC",
      [courseId],
    );
    return rows.map((r) => this.rowToSession(r));
  }

  async sessionDetail(sessionId: string): Promise<SessionDetail | undefined> {
    const s = await this.getSession(sessionId);
    if (!s) return undefined;
    const course = await this.getCourse(s.courseId);
    if (!course) return undefined;
    const rows = await this.all<Row>(
      `SELECT ar.id, ar.student_id, ar.timestamp, u.name AS student_name, u.matric_no
       FROM attendance_records ar JOIN users u ON u.id = ar.student_id
       WHERE ar.session_id = ? ORDER BY ar.timestamp ASC`,
      [sessionId],
    );
    return {
      session: s,
      course,
      totalEnrolled: course.enrolledStudentIds.length,
      attendance: rows.map((r) => ({
        id: str(r.id),
        studentId: str(r.student_id),
        name: optStr(r.student_name) ?? "Unknown",
        matricNo: optStr(r.matric_no) ?? "—",
        timestamp: num(r.timestamp),
      })),
    };
  }

  async getAttendanceRecord(recordId: string): Promise<AttendanceRecord | undefined> {
    const r = await this.first<Row>("SELECT * FROM attendance_records WHERE id = ?", [recordId]);
    if (!r) return undefined;
    return {
      id: str(r.id),
      sessionId: str(r.session_id),
      studentId: str(r.student_id),
      courseId: str(r.course_id),
      timestamp: num(r.timestamp),
      latitude: optNum(r.latitude),
      longitude: optNum(r.longitude),
    };
  }

  async deleteAttendanceRecord(recordId: string): Promise<void> {
    await this.run("DELETE FROM attendance_records WHERE id = ?", [recordId]);
  }

  async submitAttendance(input: {
    code: string;
    studentId: string;
    latitude?: number;
    longitude?: number;
  }): Promise<{ course: { code: string; title: string }; timestamp: number }> {
    const now = Date.now();
    const r = await this.first<Row>(
      "SELECT * FROM sessions WHERE code = ? AND ended_at IS NULL AND expires_at > ? LIMIT 1",
      [input.code, now],
    );
    if (!r) throw new BusinessError("Invalid or expired attendance code");
    const s = this.rowToSession(r);
    const course = await this.getCourse(s.courseId);
    if (!course) throw new BusinessError("Course not found");
    if (!course.enrolledStudentIds.includes(input.studentId)) {
      throw new BusinessError("You are not enrolled in this course");
    }
    if (s.latitude != null && s.longitude != null && s.radiusMeters != null) {
      if (input.latitude == null || input.longitude == null) {
        throw new BusinessError("Location required for this session");
      }
      const dist = haversineMeters(
        { lat: s.latitude, lng: s.longitude },
        { lat: input.latitude, lng: input.longitude },
      );
      if (dist > s.radiusMeters) {
        throw new BusinessError(
          `You are ${Math.round(dist)}m from the venue (max ${s.radiusMeters}m)`,
        );
      }
    }
    try {
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
    } catch (e) {
      // The UNIQUE(session_id, student_id) index is the final duplicate guard
      // (two requests can pass the "first" check concurrently).
      if (isUniqueViolation(e))
        throw new BusinessError("Attendance already submitted for this session");
      throw e;
    }
    return { course: { code: course.code, title: course.title }, timestamp: now };
  }

  // ── Student views ──

  async studentHistory(studentId: string, limit = 1000): Promise<StudentHistoryItem[]> {
    const rows = await this.all<Row>(
      `SELECT ar.id, ar.timestamp, c.code AS course_code, c.title AS course_title
       FROM attendance_records ar JOIN courses c ON c.id = ar.course_id
       WHERE ar.student_id = ? ORDER BY ar.timestamp DESC, ar.id DESC LIMIT ?`,
      [studentId, limit],
    );
    return rows.map((r) => ({
      id: str(r.id),
      timestamp: num(r.timestamp),
      courseCode: optStr(r.course_code) ?? "—",
      courseTitle: optStr(r.course_title) ?? "—",
    }));
  }

  async studentCourseSessions(
    studentId: string,
    courseId: string,
  ): Promise<StudentCourseSession[]> {
    const enrolled = await this.first<Row>(
      "SELECT 1 AS x FROM course_enrollments WHERE course_id = ? AND student_id = ?",
      [courseId, studentId],
    );
    if (!enrolled) throw new BusinessError("Not enrolled in this course");
    const sessions = await this.listSessionsForCourse(courseId);
    const rows = await this.all<Row>(
      "SELECT session_id, timestamp FROM attendance_records WHERE course_id = ? AND student_id = ?",
      [courseId, studentId],
    );
    const tsBySession = new Map(rows.map((r) => [str(r.session_id), num(r.timestamp)]));
    return sessions.map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      expiresAt: s.expiresAt,
      topic: s.topic,
      attended: tsBySession.has(s.id),
      attendedAt: tsBySession.get(s.id),
    }));
  }

  async listOpenSessionsForStudent(studentId: string): Promise<OpenSession[]> {
    const now = Date.now();
    const enroll = await this.all<{ course_id: string }>(
      "SELECT course_id FROM course_enrollments WHERE student_id = ?",
      [studentId],
    );
    const courseIds = enroll.map((e) => e.course_id);
    if (courseIds.length === 0) return [];
    const marks = courseIds.map(() => "?").join(",");
    // NOTE: the sign-in code is deliberately NOT returned here. This feed is
    // visible to every enrolled student wherever they are — handing them the
    // code would let anyone sign in remotely without attending. Students
    // must scan the QR or read the code displayed in the venue.
    const rows = await this.all<Row>(
      `SELECT s.id AS session_id, s.course_id, s.expires_at, c.code AS course_code, c.title AS course_title
       FROM sessions s JOIN courses c ON c.id = s.course_id
       WHERE s.ended_at IS NULL AND s.expires_at > ? AND s.course_id IN (${marks})
       ORDER BY s.expires_at ASC`,
      [now, ...courseIds],
    );
    return rows.map((r) => ({
      sessionId: str(r.session_id),
      courseId: str(r.course_id),
      courseCode: str(r.course_code),
      courseTitle: str(r.course_title),
      expiresAt: num(r.expires_at),
    }));
  }

  // ── Reports / analytics ──

  async courseReport(courseId: string): Promise<CourseReport | undefined> {
    const course = await this.getCourse(courseId);
    if (!course) return undefined;
    const sessions = await this.listSessionsForCourse(courseId);
    const total = sessions.length;
    const rows = await this.all<Row>(
      `SELECT u.id, u.name, u.matric_no,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.course_id = ? AND ar.student_id = u.id) AS attended
       FROM course_enrollments ce
       JOIN users u ON u.id = ce.student_id
       WHERE ce.course_id = ?
       ORDER BY u.name ASC`,
      [courseId, courseId],
    );
    const students = rows.map((r) => {
      const attended = num(r.attended);
      return {
        id: str(r.id),
        name: str(r.name),
        matricNo: optStr(r.matric_no) ?? "—",
        attended,
        percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
      };
    });
    students.sort((a, b) => b.percentage - a.percentage || a.name.localeCompare(b.name));
    return {
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        level: course.level,
        units: course.units,
      },
      totalSessions: total,
      sessions: [...sessions].sort((a, b) => a.startedAt - b.startedAt),
      students,
    };
  }

  async facultyReport(): Promise<FacultyReport> {
    const courseRows = await this.all<Row>(
      `SELECT c.id, c.code, c.title,
        (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id) AS sessions,
        (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id) AS enrolled,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.course_id = c.id) AS attended
       FROM courses c ORDER BY c.code ASC`,
    );
    const courses = courseRows.map((r) => {
      const enrolled = num(r.enrolled);
      const sessions = num(r.sessions);
      const attended = num(r.attended);
      const denom = sessions * Math.max(1, enrolled);
      return {
        id: str(r.id),
        code: str(r.code),
        title: str(r.title),
        enrolled,
        sessions,
        avg: denom === 0 ? 0 : Math.round((attended / denom) * 100),
      };
    });
    const studentRows = await this.all<Row>(
      `SELECT u.id, u.name, u.matric_no,
        (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.student_id = u.id) AS courses,
        (SELECT COUNT(DISTINCT s.id) FROM sessions s
           JOIN course_enrollments ce ON ce.course_id = s.course_id AND ce.student_id = u.id) AS total,
        (SELECT COUNT(DISTINCT ar.session_id) FROM attendance_records ar
           JOIN course_enrollments ce ON ce.student_id = ar.student_id AND ce.course_id = ar.course_id
           WHERE ar.student_id = u.id) AS attended
       FROM users u
       WHERE u.role = 'student'
         AND EXISTS (SELECT 1 FROM course_enrollments ce WHERE ce.student_id = u.id)
       ORDER BY u.name ASC`,
    );
    const students = studentRows.map((r) => {
      const total = num(r.total);
      const attended = num(r.attended);
      return {
        id: str(r.id),
        name: str(r.name),
        matricNo: optStr(r.matric_no) ?? "—",
        courses: num(r.courses),
        attended,
        total,
        percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
      };
    });
    students.sort((a, b) => b.percentage - a.percentage || a.name.localeCompare(b.name));
    return { courses, students };
  }

  async adminOverview(): Promise<AdminOverview> {
    const roleRows = await this.all<{ role: string; c: number }>(
      "SELECT role, COUNT(*) AS c FROM users GROUP BY role",
    );
    const counts: Record<string, number> = {};
    for (const r of roleRows) counts[r.role] = r.c;
    const courseCount =
      (await this.first<{ c: number }>("SELECT COUNT(*) AS c FROM courses"))?.c ?? 0;
    const deptCount =
      (await this.first<{ c: number }>("SELECT COUNT(*) AS c FROM departments"))?.c ?? 0;
    const sessionCount =
      (await this.first<{ c: number }>("SELECT COUNT(*) AS c FROM sessions"))?.c ?? 0;
    const attendanceCount =
      (await this.first<{ c: number }>("SELECT COUNT(*) AS c FROM attendance_records"))?.c ?? 0;

    const recentRows = await this.all<Row>(
      `SELECT s.id, c.code AS course_code, s.started_at, s.ended_at,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id) AS attended,
        (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = s.course_id) AS enrolled
       FROM sessions s JOIN courses c ON c.id = s.course_id
       ORDER BY s.started_at DESC LIMIT 8`,
    );

    // Non-overlapping 24h buckets ending at "now" (UTC day boundaries).
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const labels: Array<{ key: string; label: string }> = [];
    for (let i = 6; i >= 0; i--) {
      const t = todayStart.getTime() - i * dayMs;
      labels.push({
        key: new Date(t).toISOString().slice(0, 10),
        label: new Date(t).toLocaleDateString("en", { weekday: "short", timeZone: "UTC" }),
      });
    }
    const weekRows = await this.all<{ d: string; c: number }>(
      "SELECT date(timestamp / 1000, 'unixepoch') AS d, COUNT(*) AS c FROM attendance_records WHERE timestamp >= ? GROUP BY d",
      [todayStart.getTime() - 6 * dayMs],
    );
    const countByDay = new Map(weekRows.map((r) => [r.d, r.c]));

    return {
      counts: {
        students: counts["student"] ?? 0,
        lecturers: counts["lecturer"] ?? 0,
        courses: courseCount,
        departments: deptCount,
        sessions: sessionCount,
        attendance: attendanceCount,
      },
      recentSessions: recentRows.map((r) => ({
        id: str(r.id),
        courseCode: str(r.course_code),
        startedAt: num(r.started_at),
        endedAt: optNum(r.ended_at),
        attended: num(r.attended),
        enrolled: num(r.enrolled),
      })),
      weeklyAttendance: labels.map((l) => ({ label: l.label, count: countByDay.get(l.key) ?? 0 })),
    };
  }

  // ── Site settings ──

  private async readSettings(): Promise<SiteSettings | null> {
    const r = await this.first<Row>("SELECT * FROM site_settings WHERE id = ?", ["site"]);
    return r ? this.rowToSettings(r) : null;
  }

  async getSiteSettings(): Promise<SiteSettings> {
    const existing = await this.readSettings();
    if (existing) return existing;
    // First run: upsert the defaults (race-safe — concurrent inserts collapse
    // onto the same row).
    return this.saveSiteSettings({});
  }

  async saveSiteSettings(partial: Partial<SiteSettings>): Promise<SiteSettings> {
    const current = (await this.readSettings()) ?? defaultSiteSettings();
    const merged: SiteSettings = { ...current, ...partial, id: "site" };
    const next: SiteSettings = {
      ...merged,
      // Nullable columns must be bound as null, never undefined.
      primaryColor: merged.primaryColor ?? null,
      contactEmail: merged.contactEmail ?? null,
    };
    await this.run(
      `INSERT INTO site_settings (id, institution_name, at_risk_threshold, marquee_items, testimonials,
        demo_accounts_enabled, demo_password, demo_email_domain, show_fake_stats, primary_color, contact_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        institution_name = excluded.institution_name,
        at_risk_threshold = excluded.at_risk_threshold,
        marquee_items = excluded.marquee_items,
        testimonials = excluded.testimonials,
        demo_accounts_enabled = excluded.demo_accounts_enabled,
        demo_password = excluded.demo_password,
        demo_email_domain = excluded.demo_email_domain,
        show_fake_stats = excluded.show_fake_stats,
        primary_color = excluded.primary_color,
        contact_email = excluded.contact_email`,
      [
        next.id,
        next.institutionName,
        next.atRiskThreshold,
        JSON.stringify(next.marqueeItems),
        JSON.stringify(next.testimonials),
        next.demoAccountsEnabled ? 1 : 0,
        next.demoPassword,
        next.demoEmailDomain,
        next.showFakeStats ? 1 : 0,
        next.primaryColor,
        next.contactEmail,
      ],
    );
    return next;
  }

  async publicSettings(): Promise<PublicSettings> {
    return toPublicSettings(await this.getSiteSettings());
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

export function friendlyUniqueError(e: unknown, message: string): Error {
  if (isUniqueViolation(e)) return new Error(message);
  return e as Error;
}

/** Convenience wrapper: create a repo and make sure demo data exists. */
export async function getRepo(db: D1Database): Promise<Repo> {
  const repo = new Repo(db);
  await repo.ensureSeeded();
  return repo;
}
