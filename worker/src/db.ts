// SLAMS data layer: a single D1-backed repository.
//
// Local development uses `wrangler dev` (Miniflare emulates D1 locally — no
// Cloudflare account needed), so there is no in-memory fallback to keep in
// sync. The narrow `D1Database` interface below is what the repo depends on,
// which also lets unit tests inject a shim (see worker/tests).

import { nanoid } from "nanoid";
import { BusinessError } from "./errors";
import { dummyVerify, hashPassword, verifyPassword, type SessionPayload } from "./auth";
import { buildLocationEvidence } from "./evidence";
import type {
  AdminOverview,
  AttendanceRecord,
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
  SignInEvidence,
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

// Single-flight seed keyed by the D1 binding. Concurrent requests (and, with
// an idempotent seed, concurrent isolates) collapse onto one seed pass.
const seeding = new WeakMap<D1Database, Promise<void>>();

// ─── Pure helpers ──────────────────────────────────────────────────────────

export function generateCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000));
}

/** How long a retired (rotated) code stays valid, so a student mid-sign-in
 *  isn't rejected by a rotation boundary. */
export const PREV_CODE_GRACE_MS = 60_000;

/** Client device ids are opaque tokens; keep only a safe alphabet (anything
 *  else -> NULL, never a validation failure that could strand a student). */
export function sanitizeDeviceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64);
  return clean ? clean : null;
}

/** Keep only a well-formed IP literal (v4 or v6); anything else → null so we
 *  never store a spoofed or malformed value that would break analytics. */
export function sanitizeIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length > 45) return null;
  if (/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(v)) return v; // IPv4
  if (/^[0-9a-fA-F:]+$/.test(v) && v.includes(":")) return v; // IPv6
  return null;
}

export function sanitizeUserAgent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 256) || null;
}

export function sanitizeColo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return /^[A-Z0-9]{2,5}$/.test(v) ? v : null;
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

/** Derive the lecturer-facing forensic evidence for a stored sign-in row. */
function signInEvidenceFromRow(r: Row): SignInEvidence {
  const dist = optNum(r.distance_meters);
  const net = optNum(r.net_distance_meters);
  const hasHash = typeof r.evidence === "string" && str(r.evidence).length > 0;
  return {
    ip: optStr(r.ip),
    ua: optStr(r.ua),
    colo: optStr(r.colo),
    distanceMeters: dist,
    netMeters: net,
    hashPresent: hasHash,
    class: dist != null || net != null ? "verified" : hasHash ? "unverified" : "unlocated",
  };
}

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
      authVersion: num(r.auth_version ?? 1),
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
      venueLat: optNum(r.venue_lat),
      venueLng: optNum(r.venue_lng),
      venueRadius: optNum(r.venue_radius),
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
      codeIntervalSeconds: optNum(r.code_interval_seconds),
      codeUpdatedAt: optNum(r.code_updated_at),
      prevCode: optStr(r.prev_code),
      // Old rows created before 0005 keep their previous behavior when the
      // column is missing in-process (tests reuse the seed paths, which have
      // the column): auto-end defaults to ON only when it was already the
      // promised behavior. NULL is impossible (column is NOT NULL DEFAULT 1).
      autoEndEnabled: r.auto_end_enabled == null ? true : !!num(r.auto_end_enabled),
      seats: optNum(r.seats),
    };
  }

  private rowToSchedule(r: Row): Schedule {
    return {
      id: str(r.id),
      courseId: str(r.course_id),
      lecturerId: str(r.lecturer_id),
      durationMinutes: num(r.duration_minutes),
      topic: optStr(r.topic),
      latitude: optNum(r.latitude),
      longitude: optNum(r.longitude),
      radiusMeters: optNum(r.radius_meters),
      codeIntervalSeconds: optNum(r.code_interval_seconds),
      seats: optNum(r.seats),
      recurrence: str(r.recurrence),
      daysMask: str(r.days_mask ?? ""),
      minuteOfDay: num(r.minute_of_day),
      tzOffsetMinutes: num(r.tz_offset_minutes ?? 0),
      endsOn: optNum(r.ends_on),
      maxOccurrences: optNum(r.max_occurrences),
      occurrences: num(r.occurrences ?? 0),
      lastStartAt: num(r.last_start_at ?? 0),
      enabled: !!num(r.enabled ?? 1),
      createdAt: num(r.created_at),
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

  // Single-flight across concurrent first requests AND across isolates that
  // share a DB binding (seeding is idempotent below, so a duplicate pass can
  // never ERROR on the unique email index).
  async ensureSeeded(): Promise<void> {
    const depts = await this.first<{ c: number }>("SELECT COUNT(*) AS c FROM departments");
    if (depts && depts.c > 0) return;
    let inflight = seeding.get(this.db);
    if (!inflight) {
      inflight = (async () => {
        const { seedD1 } = await import("./seed");
        await seedD1(this.db);
      })();
      seeding.set(this.db, inflight);
    }
    await inflight;
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

  /** Revocable credentials: bump auth_version so every outstanding JWT goes
   *  stale. An explicit password reset is covered by the same mechanism (the
   *  attacker no longer knows the password, but the stolen session must die
   *  too). Bounded counter wraps back to 1 at 2^31 — irrelevant at any real
   *  call rate. */
  async revokeTokens(userId: string): Promise<void> {
    await this.run(
      "UPDATE users SET auth_version = ((auth_version + 1) % 2147483647) WHERE id = ?",
      [userId],
    );
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
    // Changing a password invalidates every other device's session — if the
    // account was compromised, the attacker's token dies with this write.
    await this.revokeTokens(userId);
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
    venueLat?: number;
    venueLng?: number;
    venueRadius?: number;
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
      venueLat: input.venueLat,
      venueLng: input.venueLng,
      venueRadius: input.venueRadius,
    };
    await this.run(
      "INSERT INTO courses (id, code, title, department_id, level, units, lecturer_id, icon, color, category, description, venue_lat, venue_lng, venue_radius) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        c.venueLat ?? null,
        c.venueLng ?? null,
        c.venueRadius ?? null,
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
      venueLat?: number;
      venueLng?: number;
      venueRadius?: number;
      /** Explicit clear of the course-level geofence (otherwise sticky). */
      clearVenue?: boolean;
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
    // Venue fields are sticky: absent = keep the current geofence (an edit
    // that doesn't touch the venue must not silently unlock the classroom).
    // An explicit `clearVenue: true` wipes it; partial lat/lng/radius sets all.
    const venueSet = input.venueLat != null && input.venueLng != null && input.venueRadius != null;
    const venueLat = venueSet ? input.venueLat : c.venueLat;
    const venueLng = venueSet ? input.venueLng : c.venueLng;
    const venueRadius = venueSet ? input.venueRadius : c.venueRadius;
    const cleared = input.clearVenue === true;
    await this.run(
      "UPDATE courses SET code=?, title=?, department_id=?, level=?, units=?, icon=?, color=?, category=?, description=?, venue_lat=?, venue_lng=?, venue_radius=? WHERE id=?",
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
        cleared ? null : (venueLat ?? null),
        cleared ? null : (venueLng ?? null),
        cleared ? null : (venueRadius ?? null),
        id,
      ],
    );
  }

  /** Pin the course-level venue geofence (or clear it). Sessions inherit it. */
  async setCourseVenue(
    id: string,
    patch: { latitude?: number; longitude?: number; radiusMeters?: number } | null,
  ): Promise<void> {
    const c = await this.getCourse(id);
    if (!c) throw new BusinessError("Course not found");
    if (patch == null) {
      await this.run(
        "UPDATE courses SET venue_lat=NULL, venue_lng=NULL, venue_radius=NULL WHERE id=?",
        [id],
      );
      return;
    }
    if (patch.latitude == null || patch.longitude == null || patch.radiusMeters == null) {
      throw new BusinessError("Venue requires latitude, longitude and radiusMeters together");
    }
    await this.run("UPDATE courses SET venue_lat=?, venue_lng=?, venue_radius=? WHERE id=?", [
      patch.latitude,
      patch.longitude,
      patch.radiusMeters,
      id,
    ]);
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

  /** Courses in this lecturer's department that no one has claimed yet —
   *  the "I was just hired and nothing is assigned to me" happy path. */
  async unassignedCoursesForLecturer(lecturerId: string): Promise<Course[]> {
    const me = await this.getUser(lecturerId);
    if (!me) return [];
    const rows = await this.all<Row>(
      `SELECT * FROM courses
       WHERE lecturer_id IS NULL AND department_id = ?
       ORDER BY code ASC`,
      [me.departmentId ?? ""],
    );
    if (rows.length === 0) return [];
    const byCourse = await this.enrollmentsForCourses(rows.map((r) => str(r.id)));
    return rows.map((r) => this.rowToCourse(r, byCourse.get(str(r.id)) ?? []));
  }

  /** Claim a course that has no lecturer (first-come). Refuses if already
   *  assigned, so lecturers can't steal each other's courses. */
  async claimCourse(courseId: string, lecturerId: string): Promise<Course> {
    const me = await this.getUser(lecturerId);
    if (!me) throw new BusinessError("Lecturer not found");
    const c = await this.getCourse(courseId);
    if (!c) throw new BusinessError("Course not found");
    if (c.lecturerId) {
      if (c.lecturerId === lecturerId) return c; // idempotent
      throw new BusinessError("This course is already assigned to another lecturer");
    }
    // Only allow claiming within your own department.
    if (me.departmentId && c.departmentId !== me.departmentId) {
      throw new BusinessError("This course belongs to a different department");
    }
    await this.run("UPDATE courses SET lecturer_id = ? WHERE id = ? AND lecturer_id IS NULL", [
      lecturerId,
      courseId,
    ]);
    return (await this.getCourse(courseId))!;
  }

  async studentCourses(studentId: string): Promise<StudentCourseView[]> {
    const rows = await this.all<Row>(
      `SELECT c.*, l.name AS lecturer_name,
        (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id) AS total_sessions,
        (SELECT COUNT(DISTINCT ar.session_id) FROM attendance_records ar
          WHERE ar.course_id = c.id AND ar.student_id = ? AND ar.status IN ('present','late')) AS attended_sessions
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

  /** A session code must be unique among currently open sessions, otherwise
   *  submitAttendance's code lookup would be ambiguous. */
  private async freshCode(): Promise<string> {
    let code = generateCode();
    for (let i = 0; i < 5; i++) {
      const clash = await this.first<{ c: number }>(
        "SELECT COUNT(*) AS c FROM sessions WHERE code = ? AND ended_at IS NULL",
        [code],
      );
      if (!clash || clash.c === 0) break;
      code = generateCode();
    }
    return code;
  }

  async startSession(input: {
    courseId: string;
    lecturerId: string;
    durationMinutes: number;
    topic?: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
    codeIntervalSeconds?: number;
    seats?: number;
    autoEndEnabled?: boolean;
  }): Promise<AttendanceSession> {
    const now = Date.now();
    const s: AttendanceSession = {
      id: nanoid(10),
      courseId: input.courseId,
      lecturerId: input.lecturerId,
      code: await this.freshCode(),
      startedAt: now,
      expiresAt: now + input.durationMinutes * 60 * 1000,
      topic: input.topic,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      codeIntervalSeconds: input.codeIntervalSeconds,
      codeUpdatedAt: input.codeIntervalSeconds ? now : undefined,
      autoEndEnabled: input.autoEndEnabled ?? true,
      seats: input.seats,
    };
    await this.run(
      `INSERT INTO sessions (id, course_id, lecturer_id, code, started_at, expires_at, ended_at, latitude, longitude, radius_meters, topic,
        code_interval_seconds, code_updated_at, prev_code, auto_end_enabled, seats)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        s.codeIntervalSeconds ?? null,
        s.codeUpdatedAt ?? null,
        null,
        s.autoEndEnabled ? 1 : 0,
        s.seats ?? null,
      ],
    );
    return s;
  }

  /**
   * Advances a rotating session's code when its slot has elapsed. Called
   * lazily on every lecturer poll AND every student submission, so rotation
   * keeps working even if the lecturer closes the live view.
   *
   * Rotation is atomic-ish: the UPDATE only applies if the row still carries
   * the code generation we read, so concurrent isolates can't strand a
   * student between two rotations (the loser re-reads the winner's code).
   * Returns the current (possibly rotated) session, or the input session when
   * no rotation was due.
   */
  async rotateSessionCodeIfNeeded(sessionId: string): Promise<AttendanceSession | undefined> {
    const s = await this.getSession(sessionId);
    if (!s || !s.codeIntervalSeconds || s.endedAt || s.expiresAt <= Date.now()) return s;
    const updatedAt = s.codeUpdatedAt ?? s.startedAt;
    if (Date.now() - updatedAt < s.codeIntervalSeconds * 1000) return s;
    const next = await this.freshCode();
    const now = Date.now();
    await this.run(
      `UPDATE sessions SET prev_code = code, code = ?, code_updated_at = ?
       WHERE id = ? AND code_updated_at IS ? AND code = ?`,
      [next, now, sessionId, s.codeUpdatedAt ?? null, s.code],
    );
    return (await this.getSession(sessionId)) ?? s;
  }

  async endSession(sessionId: string): Promise<void> {
    const s = await this.getSession(sessionId);
    if (!s) throw new BusinessError("Session not found");
    if (s.endedAt) return; // idempotent
    await this.run("UPDATE sessions SET ended_at = ? WHERE id = ?", [Date.now(), sessionId]);
  }

  /**
   * Close every open session whose window has elapsed and whose schedule is
   * configured to auto-close (NEVER-ending-session guard, 100%: every live
   * session always terminates). Runs as part of the Worker's scheduled tick
   * (cron) and on each node's first request of a minute (lazy catch-up), so
   * local dev and un-cron'd deployments behave identically.
   */
  async closeExpiredSessions(): Promise<number> {
    const now = Date.now();
    const res = await this.db
      .prepare(
        `UPDATE sessions SET ended_at = ?
         WHERE ended_at IS NULL AND expires_at <= ? AND auto_end_enabled = 1`,
      )
      .bind(now, now)
      .run();
    return Number((res.meta as { changes?: number } | undefined)?.changes ?? 0);
  }

  /**
   * Materialize every enabled schedule whose next occurrence is due. Returns
   * the number of sessions started. Idempotent: tracked by last_start_at
   * (hysteresis window avoids duplicate legs across overlapping ticks).
   */
  async materializeSchedules(now = Date.now()): Promise<number> {
    const rows = await this.all<Row>("SELECT * FROM schedules WHERE enabled = 1");
    let started = 0;
    for (const r of rows) {
      try {
        if (await this.materializeOneSchedule(r, now)) started++;
      } catch (e) {
        // A single bad series (e.g. course deleted out of band) must not stop
        // the rest of the fleet; surface it but keep going.
        console.error(
          JSON.stringify({ msg: "schedule_materialize_error", scheduleId: str(r.id) }),
          e,
        );
      }
    }
    return started;
  }

  private async materializeOneSchedule(r: Row, now: number): Promise<boolean> {
    const sch = this.rowToSchedule(r);

    // Latest eligible occurrence at-or-before `now`. Walking backward means we
    // never backfill a storm of missed lectures: after a long outage only the
    // most recent due slot starts, and history is simply left un-materialized.
    const due = this.latestOccurrenceOnOrBefore(sch, now);
    if (!due) return false;

    // Hysteresis: only materialize a slot we haven't already (idempotent under
    // concurrent/cron ticks — lastStartAt advances so every slot starts once).
    if (due <= sch.lastStartAt) return false;

    // Series window closed?
    if (sch.endsOn && due > sch.endsOn) return false;
    // Occurrence cap reached?
    if (sch.maxOccurrences && sch.occurrences >= sch.maxOccurrences) return false;

    const course = await this.getCourse(sch.courseId);
    if (!course) throw new BusinessError("Course not found for schedule");

    // Skip materializing a slot if one is already open for the same course —
    // recurring legs never overlap an already-running attendance window.
    const open = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM sessions WHERE course_id = ? AND ended_at IS NULL AND expires_at > ?",
      [sch.courseId, now],
    );
    if (open && open.c > 0) return false;

    await this.run(
      "UPDATE schedules SET last_start_at = ?, occurrences = occurrences + 1 WHERE id = ?",
      [due, sch.id],
    );
    await this.startSession({
      courseId: sch.courseId,
      lecturerId: sch.lecturerId,
      durationMinutes: sch.durationMinutes,
      topic: sch.topic,
      latitude: sch.latitude,
      longitude: sch.longitude,
      radiusMeters: sch.radiusMeters,
      codeIntervalSeconds: sch.codeIntervalSeconds,
      seats: sch.seats,
      autoEndEnabled: true,
    });
    return true;
  }

  /**
   * Latest occurrence at-or-before `nowMs`, in UTC ms, or null when the series
   * has no due slot yet in the last 45 days. Wall-clock minuteOfDay is in the
   * schedule's local zone (tz_offset_minutes), so "09:00 local" stays stable.
   * Composed of two pure pieces (allowedDays + walk) so both are unit-testable.
   */
  private latestOccurrenceOnOrBefore(sch: Schedule, nowMs: number): number | null {
    const allowedDays = this.allowedDaysFor(sch);
    if (allowedDays.size === 0) return null;
    const DAY = 24 * 60 * 60 * 1000;
    const MINUTE = 60 * 1000;
    const localNow = nowMs + sch.tzOffsetMinutes * MINUTE;
    const localDayStart = Math.floor(localNow / DAY) * DAY;

    for (let back = 0; back < 45; back++) {
      const dayLocal = localDayStart - back * DAY;
      const iso = new Date(dayLocal - sch.tzOffsetMinutes * MINUTE).getUTCDay() || 7; // Sun=0 → 7
      if (!allowedDays.has(iso)) continue;
      const tUtc = dayLocal + sch.minuteOfDay * MINUTE - sch.tzOffsetMinutes * MINUTE;
      if (tUtc > nowMs) continue; // today's slot is still ahead of us
      if (sch.endsOn && tUtc > sch.endsOn) continue;
      return tUtc;
    }
    return null;
  }

  private allowedDaysFor(sch: Schedule): Set<number> {
    const days = new Set<number>();
    if (sch.recurrence === "daily") {
      for (let i = 1; i <= 7; i++) days.add(i);
    } else if (sch.recurrence === "weekdays") {
      [1, 2, 3, 4, 5].forEach((d) => days.add(d));
    } else {
      (sch.daysMask || "")
        .split(",")
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7)
        .forEach((d) => days.add(d));
    }
    return days;
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

  // ── Recurring schedules ────────────────────────────────────────────────

  async listSchedules(lecturerId?: string, courseId?: string): Promise<Schedule[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (lecturerId) {
      clauses.push("lecturer_id = ?");
      params.push(lecturerId);
    }
    if (courseId) {
      clauses.push("course_id = ?");
      params.push(courseId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.all<Row>(
      `SELECT * FROM schedules ${where} ORDER BY minute_of_day ASC`,
      params,
    );
    return rows.map((r) => this.rowToSchedule(r));
  }

  async getSchedule(id: string): Promise<Schedule | undefined> {
    const r = await this.first<Row>("SELECT * FROM schedules WHERE id = ?", [id]);
    return r ? this.rowToSchedule(r) : undefined;
  }

  async createSchedule(input: {
    courseId: string;
    lecturerId: string;
    durationMinutes: number;
    topic?: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
    codeIntervalSeconds?: number;
    seats?: number;
    recurrence: string;
    daysMask?: string;
    minuteOfDay: number;
    tzOffsetMinutes?: number;
    endsOn?: number;
    maxOccurrences?: number;
  }): Promise<Schedule> {
    const course = await this.getCourse(input.courseId);
    if (!course) throw new BusinessError("Course not found");
    const lec = await this.first<Row>("SELECT id FROM users WHERE id = ? AND role = 'lecturer'", [
      input.lecturerId,
    ]);
    if (!lec) throw new BusinessError("Lecturer not found");
    const s: Schedule = {
      id: nanoid(10),
      courseId: input.courseId,
      lecturerId: input.lecturerId,
      durationMinutes: input.durationMinutes,
      topic: input.topic,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      codeIntervalSeconds: input.codeIntervalSeconds,
      seats: input.seats,
      recurrence: input.recurrence,
      daysMask: input.daysMask ?? "",
      minuteOfDay: input.minuteOfDay,
      tzOffsetMinutes: input.tzOffsetMinutes ?? 0,
      endsOn: input.endsOn,
      maxOccurrences: input.maxOccurrences,
      occurrences: 0,
      lastStartAt: 0,
      enabled: true,
      createdAt: Date.now(),
    };
    await this.run(
      `INSERT INTO schedules (id, course_id, lecturer_id, duration_minutes, topic, latitude, longitude,
        radius_meters, code_interval_seconds, seats, recurrence, days_mask, minute_of_day,
        tz_offset_minutes, ends_on, max_occurrences, occurrences, last_start_at, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 1, ?)`,
      [
        s.id,
        s.courseId,
        s.lecturerId,
        s.durationMinutes,
        s.topic ?? null,
        s.latitude ?? null,
        s.longitude ?? null,
        s.radiusMeters ?? null,
        s.codeIntervalSeconds ?? null,
        s.seats ?? null,
        s.recurrence,
        s.daysMask,
        s.minuteOfDay,
        s.tzOffsetMinutes,
        s.endsOn ?? null,
        s.maxOccurrences ?? null,
        s.createdAt,
      ],
    );
    return s;
  }

  async setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
    const s = await this.getSchedule(id);
    if (!s) throw new BusinessError("Schedule not found");
    await this.run("UPDATE schedules SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, id]);
  }

  async deleteSchedule(id: string): Promise<void> {
    const s = await this.getSchedule(id);
    if (!s) throw new BusinessError("Schedule not found");
    // Deleting a series leaves the sessions it already materialized intact
    // (a percentage never regresses); it only prevents future legs.
    await this.run("DELETE FROM schedules WHERE id = ?", [id]);
  }

  async sessionDetail(sessionId: string): Promise<SessionDetail | undefined> {
    // Rotation happens here (lecturer polls every few seconds)…
    const s = await this.rotateSessionCodeIfNeeded(sessionId);
    if (!s) return undefined;
    const course = await this.getCourse(s.courseId);
    if (!course) return undefined;
    const rows = await this.all<Row>(
      `SELECT ar.id, ar.student_id, ar.timestamp, ar.device_id, ar.distance_meters, ar.status,
              ar.evidence, ar.ip, ar.ua, ar.colo, ar.net_distance_meters, ar.net_lat, ar.net_lng,
              u.name AS student_name, u.matric_no
       FROM attendance_records ar JOIN users u ON u.id = ar.student_id
       WHERE ar.session_id = ? ORDER BY ar.timestamp ASC`,
      [sessionId],
    );
    return {
      session: s,
      course,
      totalEnrolled: course.enrolledStudentIds.length,
      codeExpiresAt:
        s.codeIntervalSeconds && !s.endedAt
          ? (s.codeUpdatedAt ?? s.startedAt) + s.codeIntervalSeconds * 1000
          : undefined,
      attendance: rows.map((r) => ({
        id: str(r.id),
        studentId: str(r.student_id),
        name: optStr(r.student_name) ?? "Unknown",
        matricNo: optStr(r.matric_no) ?? "—",
        timestamp: num(r.timestamp),
        deviceId: optStr(r.device_id),
        distanceMeters: optNum(r.distance_meters),
        status: (str(r.status) as AttendanceStatus) || "present",
        evidence: signInEvidenceFromRow(r),
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
      status: (str(r.status) as AttendanceStatus) || "present",
    };
  }

  async deleteAttendanceRecord(recordId: string): Promise<void> {
    await this.run("DELETE FROM attendance_records WHERE id = ?", [recordId]);
  }

  /** Flip an existing record to excused/late/absent/present. 'late' still
   *  counts as attended in percentage math; excused/absent do not. */
  async setAttendanceStatus(recordId: string, status: AttendanceStatus): Promise<void> {
    const r = await this.first<Row>("SELECT id FROM attendance_records WHERE id = ?", [recordId]);
    if (!r) throw new BusinessError("Attestation record not found");
    await this.run("UPDATE attendance_records SET status = ? WHERE id = ?", [status, recordId]);
  }

  async submitAttendance(input: {
    code: string;
    studentId: string;
    latitude?: number;
    longitude?: number;
    deviceId?: string;
    clientTime?: number;
    secret?: Uint8Array;
    network?: {
      latParse?: number | null;
      lngParse?: number | null;
      ip?: string | null;
      ua?: string | null;
      colo?: string | null;
    };
  }): Promise<{ course: { code: string; title: string }; timestamp: number }> {
    const now = Date.now();
    // Reject future-timestamped client clocks (anti-"backdated proof") and
    // allow at most 10 minutes of clock skew, then trust the server clock.
    const clientTime = input.clientTime ?? now;
    if (Number.isFinite(clientTime) && clientTime - now > 10 * 60 * 1000) {
      throw new BusinessError(
        "Your device clock appears to be ahead of the venue. Set it correctly and try again.",
      );
    }
    // Match the current code OR the previous one (rotation grace). Prefer a
    // current-code match: a retired code could theoretically equal another
    // session's live code, and the live one is the right session.
    const r = await this.first<Row>(
      `SELECT * FROM sessions
       WHERE (code = ? OR prev_code = ?) AND ended_at IS NULL AND expires_at > ?
       ORDER BY CASE WHEN code = ? THEN 0 ELSE 1 END LIMIT 1`,
      [input.code, input.code, now, input.code],
    );
    if (!r) throw new BusinessError("Invalid or expired attendance code");
    let s = this.rowToSession(r);
    // Rotation also happens here, so codes keep refreshing even if the
    // lecturer closed the live view. A student holding the pre-rotation code
    // still validates via the grace window below.
    s = (await this.rotateSessionCodeIfNeeded(s.id)) ?? s;
    if (s.code !== input.code) {
      const withinGrace =
        s.prevCode === input.code &&
        s.codeIntervalSeconds != null &&
        now - (s.codeUpdatedAt ?? 0) <= PREV_CODE_GRACE_MS;
      if (!withinGrace) {
        throw new BusinessError(
          s.prevCode === input.code
            ? "That code just expired — enter the code currently on screen"
            : "Invalid or expired attendance code",
        );
      }
    }
    const course = await this.getCourse(s.courseId);
    if (!course) throw new BusinessError("Course not found");
    if (!course.enrolledStudentIds.includes(input.studentId)) {
      throw new BusinessError("You are not enrolled in this course");
    }

    // Venue capacity: once the room is full, later sign-ins are turned away
    // with a human reason (checked after enrollment so the order of messages
    // matches the order of worry for the student).
    if (s.seats != null && s.seats > 0) {
      const taken = await this.first<{ c: number }>(
        "SELECT COUNT(*) AS c FROM attendance_records WHERE session_id = ?",
        [s.id],
      );
      if (taken && taken.c >= s.seats) {
        throw new BusinessError(
          "This session is full. Contact your lecturer if you believe this is a mistake.",
        );
      }
    }
    let distanceMeters: number | undefined;
    const deviceId = sanitizeDeviceId(input.deviceId);
    const net = input.network;
    const nx = net?.latParse;
    const ny = net?.lngParse;
    const hasNet =
      typeof nx === "number" &&
      Number.isFinite(nx) &&
      typeof ny === "number" &&
      Number.isFinite(ny);
    const hasGps = input.latitude != null && input.longitude != null;
    const vlat = s.latitude;
    const vlng = s.longitude;
    const vrad = s.radiusMeters;
    if (vlat != null && vlng != null && vrad != null) {
      if (hasGps) {
        const dist = haversineMeters(
          { lat: vlat, lng: vlng },
          { lat: input.latitude!, lng: input.longitude! },
        );
        if (dist > vrad) {
          throw new BusinessError(`You are ${Math.round(dist)}m from the venue (max ${vrad}m)`);
        }
        distanceMeters = Math.round(dist);
      }
    }

    // Bind the accepted sign-in claim into a tamper-evident HMAC digest so a
    // "I wasn't there" dispute can be answered with signed evidence later.
    // The digest covers the claim (device/code/time/location-if-any) — the
    // server is the authority on whether the claim was inside the fence.
    let evidence: string | null = null;
    if (input.secret && input.secret.length >= 16) {
      evidence = await buildLocationEvidence(input.secret, {
        studentId: input.studentId,
        code: s.code,
        latitude: input.latitude,
        longitude: input.longitude,
        clientTime,
        deviceId: deviceId ?? undefined,
      });
    }

    // IP-level forensics (Cloudflare Colo): an approximate network location
    // lets the report flag "same student, many cities" proxy rings and gives
    // the venue a coarse fallback check when the student's GPS is off.
    const ip = sanitizeIp(net?.ip);
    const ua = sanitizeUserAgent(net?.ua);
    const colo = sanitizeColo(net?.colo);

    // Network / GPS fallback for venue-locked sessions without a client fix:
    let netMeters: number | undefined;
    let netLat: number | undefined;
    let netLng: number | undefined;
    if (vlat != null && vlng != null && vrad != null && !hasGps) {
      if (hasNet) {
        const d = haversineMeters({ lat: vlat, lng: vlng }, { lat: nx!, lng: ny! });
        if (d > vrad) {
          throw new BusinessError(
            `You're about ${Math.round(d)}m from the venue. Return to the classroom (or enable GPS on this device) to sign in.`,
          );
        }
        netMeters = Math.round(d);
        netLat = nx!;
        netLng = ny!;
      } else {
        throw new BusinessError(
          "Location required: this session is venue-locked. Turn on GPS on this device and retry.",
        );
      }
    }

    try {
      await this.run(
        `INSERT INTO attendance_records (id, session_id, student_id, course_id, timestamp, latitude, longitude, device_id, distance_meters, status, evidence, ip, ua, colo, net_distance_meters, net_lat, net_lng)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nanoid(10),
          s.id,
          input.studentId,
          s.courseId,
          now,
          input.latitude ?? null,
          input.longitude ?? null,
          deviceId,
          distanceMeters ?? null,
          "present",
          evidence,
          ip,
          ua,
          colo,
          netMeters ?? null,
          netLat ?? null,
          netLng ?? null,
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
      "SELECT session_id, timestamp, status FROM attendance_records WHERE course_id = ? AND student_id = ?",
      [courseId, studentId],
    );
    const bySession = new Map<string, { timestamp: number; status: AttendanceStatus }>(
      rows.map((r) => [
        str(r.session_id),
        { timestamp: num(r.timestamp), status: (str(r.status) as AttendanceStatus) || "present" },
      ]),
    );
    return sessions.map((s) => {
      const rec = bySession.get(s.id);
      const attended = rec != null && (rec.status === "present" || rec.status === "late");
      return {
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        expiresAt: s.expiresAt,
        topic: s.topic,
        attended,
        attendedAt: rec?.timestamp,
        status: rec?.status ?? "absent",
      };
    });
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
      `SELECT u.id, u.name, u.matric_no, u.role,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.course_id = ? AND ar.student_id = u.id AND ar.status IN ('present','late')) AS attended,
        (SELECT COUNT(DISTINCT ar2.device_id) FROM attendance_records ar2 WHERE ar2.course_id = ? AND ar2.student_id = u.id) AS devices
       FROM course_enrollments ce
       JOIN users u ON u.id = ce.student_id
       WHERE ce.course_id = ?
       ORDER BY u.name ASC`,
      [courseId, courseId, courseId],
    );
    const students = rows.map((r) => {
      const attended = num(r.attended);
      return {
        id: str(r.id),
        name: str(r.name),
        matricNo: optStr(r.matric_no) ?? "—",
        attended,
        percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
        devices: num(r.devices),
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
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.course_id = c.id AND ar.status IN ('present','late')) AS attended
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
           WHERE ar.student_id = u.id AND ar.status IN ('present','late')) AS attended,
        (SELECT COUNT(DISTINCT ar2.device_id) FROM attendance_records ar2
           WHERE ar2.student_id = u.id) AS devices
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
        devices: num(r.devices),
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
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id AND ar.status IN ('present','late')) AS attended,
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
