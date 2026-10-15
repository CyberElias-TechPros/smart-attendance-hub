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
import { recordAudit, type AppendAuditInput, type AuditContext } from "./audit-log";
import {
  attendedCount,
  emptyCounts,
  expectedCount,
  health,
  meanOfPercentages,
  percentage,
  percentageInt,
  tallyStatuses,
  weightedPercentage,
  type StatusCounts,
} from "./stats";
import { dayWindow, recentDayWindows } from "./time";
import type {
  Absentee,
  AdminOverview,
  AttendanceCounts,
  AttendanceRecord,
  AttendanceSession,
  AttendanceStatus,
  Course,
  CourseReport,
  AcademicPeriod,
  AcademicSession,
  CourseReportStudent,
  CourseReportTotals,
  CourseSessionStat,
  CourseReportRow,
  CoursesReport,
  Department,
  Faculty,
  ReportFilters,
  Semester,
  AuditEntry,
  AuditQuery,
  Paginated,
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
    timezone: "Africa/Lagos",
    lateCountsAsAttended: true,
    excusedCountsAsAbsent: true,
    currentAcademicSessionId: null,
    currentSemesterId: null,
    logoUrl: null,
    reportFooterNote: null,
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

/** Who changed a record, why, and from where — threaded into every audited
 *  mutation so an audit row can never be missing its actor (plan §9). */
export interface AttendanceMutationOptions extends AuditContext {
  /** Justification shown in the audit trail. The API requires it for
   *  corrections; the repo keeps it optional so internal/system paths (absence
   *  materialisation, imports) can still write a row. */
  reason?: string;
  /** Permit changing records that belong to a finalised period. */
  allowLocked?: boolean;
  /** Set false only for bookkeeping that should stay out of the trail. */
  audit?: boolean;
}

/** An all-zero totals row (empty filters, or a filtered set with no matches). */
function emptyTotals(): CourseReportTotals {
  return {
    courses: 0,
    enrolled: 0,
    classesHeld: 0,
    classesAttended: 0,
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    attended: 0,
    expected: 0,
    rate: null,
  };
}

/** Turn a lecture's recorded rows plus its expected-roster size into the four
 *  independent tallies the UI and every report are built from (plan §8). */
function sessionCounts(
  rows: ReadonlyArray<{ status?: string | null }>,
  expected: number,
): AttendanceCounts {
  const counts = tallyStatuses(rows);
  const attended = attendedCount(counts);
  const denom = Math.max(expected, counts.present + counts.late + counts.excused + counts.absent);
  return {
    ...counts,
    attended,
    expected: denom,
    rate: percentage(attended, denom, 1),
  };
}

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
      semesterId: optStr(r.semester_id),
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
      timezone: optStr(r.timezone) ?? "Africa/Lagos",
      lateCountsAsAttended:
        r.late_counts_as_attended == null ? true : !!num(r.late_counts_as_attended),
      excusedCountsAsAbsent:
        r.excused_counts_as_absent == null ? true : !!num(r.excused_counts_as_absent),
      marqueeItems: safeJsonArray<string>(r.marquee_items, []),
      testimonials: safeJsonArray<Testimonial>(r.testimonials, []),
      demoAccountsEnabled: !!r.demo_accounts_enabled,
      demoPassword: str(r.demo_password),
      demoEmailDomain: str(r.demo_email_domain),
      showFakeStats: !!r.show_fake_stats,
      primaryColor: r.primary_color == null ? null : String(r.primary_color),
      contactEmail: r.contact_email == null ? null : String(r.contact_email),
      currentAcademicSessionId: optStr(r.current_academic_session_id) ?? null,
      currentSemesterId: optStr(r.current_semester_id) ?? null,
      logoUrl: optStr(r.logo_url) ?? null,
      reportFooterNote: optStr(r.report_footer_note) ?? null,
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
    // Preserve each student's original enrolment date: the UI "save roster"
    // action re-writes the whole list, and a student's history must not be
    // reset (nor their old absences re-attributed) just because someone added a
    // classmate. Only genuinely new enrolments get `now`.
    const existing = await this.all<{ student_id: string; enrolled_at: number }>(
      "SELECT student_id, enrolled_at FROM course_enrollments WHERE course_id = ?",
      [courseId],
    );
    const enrolledAt = new Map(existing.map((e) => [e.student_id, num(e.enrolled_at)]));
    const now = Date.now();

    await this.run("DELETE FROM course_enrollments WHERE course_id = ?", [courseId]);
    for (const sid of ids) {
      await this.run(
        "INSERT OR IGNORE INTO course_enrollments (course_id, student_id, enrolled_at) VALUES (?, ?, ?)",
        [courseId, sid, enrolledAt.get(sid) ?? now],
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
    // A lecture belongs to the period its course is scoped to; when the course
    // has no period yet, it belongs to the institution's active semester. This
    // is what makes "filter by semester", per-semester reports, and period
    // freezing work without a later repair pass (plan §4.1).
    const course = await this.getCourse(input.courseId);
    const period = course?.semesterId ? null : await this.academicPeriod();
    const semesterId = course?.semesterId ?? period?.semester?.id;
    const s: AttendanceSession = {
      id: nanoid(10),
      courseId: input.courseId,
      lecturerId: input.lecturerId,
      semesterId,
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
        code_interval_seconds, code_updated_at, prev_code, auto_end_enabled, seats, semester_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        s.semesterId ?? null,
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
    if (s.endedAt) {
      // Idempotent, but still heal the roster tally in case an older close
      // happened before absence materialisation existed (or was interrupted).
      await this.materializeAbsences(sessionId);
      return;
    }
    await this.run("UPDATE sessions SET ended_at = ? WHERE id = ?", [Date.now(), sessionId]);
    await this.materializeAbsences(sessionId);
  }

  /**
   * Write the roster's unmet expectations for a closed lecture.
   *
   * Why: until this existed, "absent" was only ever implied by the absence of a
   * row, so Present/Absent/Late could not be totalled independently and an
   * approved excuse was indistinguishable from truancy. Every closed session
   * now carries one row per expected student (plan §4.3).
   *
   * Properties:
   *  - Only closed sessions (an open lecture has no absences yet — students can
   *    still walk in).
   *  - Idempotent: the UNIQUE(session_id, student_id) index (migration 0003)
   *    plus the NOT EXISTS filter make re-runs no-ops.
   *  - Respects enrolment dates: a student who enrolled after the lecture is not
   *    retroactively marked absent.
   *  - Timestamped at the lecture start, so a day-based report files the absence
   *    under the lecture, not under whenever the session happened to auto-close.
   *  - Batched inserts (40 rows/statement) so closing a 600-student lecture is a
   *    handful of D1 round-trips rather than 600.
   */
  async materializeAbsences(sessionId: string): Promise<number> {
    const s = await this.getSession(sessionId);
    if (!s || !s.endedAt) return 0;

    const rows = await this.all<{ student_id: string }>(
      `SELECT ce.student_id FROM course_enrollments ce
       WHERE ce.course_id = ?
         AND ce.enrolled_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM attendance_records ar
           WHERE ar.session_id = ? AND ar.student_id = ce.student_id
         )
       ORDER BY ce.student_id`,
      [s.courseId, s.startedAt, sessionId],
    );
    if (rows.length === 0) return 0;

    const created = s.endedAt ?? s.startedAt;
    const BATCH = 40;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const values = slice.map(() => "(?, ?, ?, ?, ?, 'absent', 'auto_absent', ?, ?)").join(", ");
      const params: unknown[] = [];
      for (const r of slice) {
        params.push(
          nanoid(12),
          sessionId,
          r.student_id,
          s.courseId,
          s.startedAt,
          s.semesterId ?? null,
          created,
        );
      }
      const res = await this.db
        .prepare(
          `INSERT OR IGNORE INTO attendance_records
             (id, session_id, student_id, course_id, timestamp, status, source, semester_id, created_at)
           VALUES ${values}`,
        )
        .bind(...params)
        .run();
      inserted += Number((res.meta as { changes?: number } | undefined)?.changes ?? 0);
    }
    return inserted;
  }

  /**
   * Catch-up pass for lectures that closed before their absences were written
   * (deploy of this feature, an interrupted close, or a cron that fired while a
   * migration was still rolling out). Bounded so a single tick can never turn
   * into an unbounded backfill.
   */
  async backfillAbsences(limit = 10, sinceMs = 14 * 24 * 60 * 60 * 1000): Promise<number> {
    const rows = await this.all<{ id: string }>(
      `SELECT s.id FROM sessions s
       WHERE s.ended_at IS NOT NULL
         AND s.ended_at >= ?
         AND EXISTS (SELECT 1 FROM course_enrollments ce WHERE ce.course_id = s.course_id)
         AND NOT EXISTS (
           SELECT 1 FROM attendance_records ar
           WHERE ar.session_id = s.id AND ar.source = 'auto_absent'
         )
       ORDER BY s.ended_at DESC LIMIT ?`,
      [Date.now() - sinceMs, limit],
    );
    let total = 0;
    for (const r of rows) total += await this.materializeAbsences(str(r.id));
    return total;
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
    // Select first so we know *which* lectures to tally afterwards — closing a
    // session is what turns "hasn't signed in yet" into "was absent".
    const due = await this.all<{ id: string }>(
      `SELECT id FROM sessions
       WHERE ended_at IS NULL AND expires_at <= ? AND auto_end_enabled = 1`,
      [now],
    );
    if (due.length === 0) return 0;
    const ids = due.map((r) => str(r.id));
    const marks = ids.map(() => "?").join(",");
    const res = await this.db
      .prepare(`UPDATE sessions SET ended_at = ? WHERE id IN (${marks}) AND ended_at IS NULL`)
      .bind(now, ...ids)
      .run();
    const closed = Number((res.meta as { changes?: number } | undefined)?.changes ?? 0);
    for (const id of ids) {
      try {
        await this.materializeAbsences(id);
      } catch (e) {
        // A tally failure must never abort housekeeping for the other lectures.
        console.error(JSON.stringify({ msg: "materialize_absences_error", sessionId: id }), e);
      }
    }
    return closed;
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
       WHERE ar.session_id = ? AND ar.source <> 'auto_absent'
       ORDER BY ar.timestamp ASC`,
      [sessionId],
    );
    // The roster's unmet expectations. While a lecture is still open this is
    // empty on purpose (nobody is late until the door closes); the moment it
    // closes, materializeAbsences has written one row per expected student.
    const absenteeRows = await this.all<Row>(
      `SELECT ar.id, ar.student_id, ar.status, ar.reason, u.name AS student_name, u.matric_no
       FROM attendance_records ar JOIN users u ON u.id = ar.student_id
       WHERE ar.session_id = ? AND ar.status IN ('absent','excused')
       ORDER BY u.name ASC`,
      [sessionId],
    );
    const attendance = rows.map((r) => ({
      id: str(r.id),
      studentId: str(r.student_id),
      name: optStr(r.student_name) ?? "Unknown",
      matricNo: optStr(r.matric_no) ?? "—",
      timestamp: num(r.timestamp),
      deviceId: optStr(r.device_id),
      distanceMeters: optNum(r.distance_meters),
      status: (str(r.status) as AttendanceStatus) || "present",
      evidence: signInEvidenceFromRow(r),
    }));
    const absentees: Absentee[] = absenteeRows.map((r) => ({
      studentId: str(r.student_id),
      name: optStr(r.student_name) ?? "Unknown",
      matricNo: optStr(r.matric_no) ?? "—",
      status: (str(r.status) as AttendanceStatus) || "absent",
      reason: optStr(r.reason),
    }));
    // Expectations for this lecture = students on the roster when it started.
    // (For an open lecture that is also the honest denominator: the students who
    // are not on the sign-in list yet simply haven't arrived.)
    const roster = await this.first<{ c: number }>(
      `SELECT COUNT(*) AS c FROM course_enrollments
       WHERE course_id = ? AND enrolled_at <= ?`,
      [s.courseId, s.startedAt],
    );
    const counts = sessionCounts(
      [...attendance, ...absentees],
      Math.max(num(roster?.c), attendance.length + absentees.length),
    );
    return {
      session: s,
      course,
      totalEnrolled: course.enrolledStudentIds.length,
      codeExpiresAt:
        s.codeIntervalSeconds && !s.endedAt
          ? (s.codeUpdatedAt ?? s.startedAt) + s.codeIntervalSeconds * 1000
          : undefined,
      attendance,
      absentees,
      counts,
    };
  }

  private rowToAttendanceRecord(r: Row): AttendanceRecord {
    return {
      id: str(r.id),
      sessionId: str(r.session_id),
      studentId: str(r.student_id),
      courseId: str(r.course_id),
      timestamp: num(r.timestamp),
      latitude: optNum(r.latitude),
      longitude: optNum(r.longitude),
      status: (str(r.status) as AttendanceStatus) || "present",
      source: (str(r.source) as AttendanceRecord["source"]) || "scan",
      reason: optStr(r.reason),
      markedBy: optStr(r.marked_by),
      locked: num(r.locked) === 1,
    };
  }

  async getAttendanceRecord(recordId: string): Promise<AttendanceRecord | undefined> {
    const r = await this.first<Row>("SELECT * FROM attendance_records WHERE id = ?", [recordId]);
    return r ? this.rowToAttendanceRecord(r) : undefined;
  }

  /** Remove a record. Audited: an institution must be able to answer "who
   *  deleted this sign-in, and why?" (brief §9). */
  async deleteAttendanceRecord(
    recordId: string,
    options: AttendanceMutationOptions = {},
  ): Promise<AttendanceRecord> {
    const before = await this.getAttendanceRecord(recordId);
    if (!before) throw new BusinessError("Attendance record not found");
    if (before.locked && !options.allowLocked) {
      throw new BusinessError(
        "This record belongs to a finalised period and cannot be deleted. Ask an administrator for an override.",
      );
    }
    await this.run("DELETE FROM attendance_records WHERE id = ?", [recordId]);
    if (options.audit !== false) {
      await recordAudit(
        this,
        {
          action: "attendance.void",
          entityType: "attendance_record",
          entityId: recordId,
          courseId: before.courseId,
          before,
          after: null,
          reason: options.reason ?? null,
        },
        options,
      );
    }
    return before;
  }

  /** Flip an existing record to excused/late/absent/present. 'late' still
   *  counts as attended in percentage math; excused/absent do not.
   *
   *  Every change is attributed and auditable: the operator, the reason, and
   *  the before/after values are written to the append-only audit log in the
   *  same request (brief §9). Materialised absences can be flipped too — that is
   *  how a lecturer approves an excuse. */
  async setAttendanceStatus(
    recordId: string,
    status: AttendanceStatus,
    options: AttendanceMutationOptions = {},
  ): Promise<AttendanceRecord> {
    const before = await this.getAttendanceRecord(recordId);
    if (!before) throw new BusinessError("Attestation record not found");
    if (before.locked && !options.allowLocked) {
      throw new BusinessError(
        "This record belongs to a finalised period and cannot be changed. Ask an administrator for an override.",
      );
    }
    const now = Date.now();
    // A human touched it: provenance flips to 'manual' so nobody later mistakes
    // a correction for a scan.
    await this.run(
      `UPDATE attendance_records
       SET status = ?, source = CASE WHEN source = 'auto_absent' THEN 'manual' ELSE source END,
           marked_by = ?, reason = ?, updated_at = ?
       WHERE id = ?`,
      [status, options.actorId ?? null, options.reason ?? null, now, recordId],
    );
    const after = (await this.getAttendanceRecord(recordId))!;
    if (options.audit !== false) {
      await recordAudit(
        this,
        {
          action: "attendance.update",
          entityType: "attendance_record",
          entityId: recordId,
          courseId: before.courseId,
          before,
          after,
          reason: options.reason ?? null,
        },
        options,
      );
    }
    return after;
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
      // Only real sign-ins occupy a seat (auto-absent rows are written after the
      // lecture closes, so they can never block a seat mid-lecture).
      const taken = await this.first<{ c: number }>(
        "SELECT COUNT(*) AS c FROM attendance_records WHERE session_id = ? AND source <> 'auto_absent'",
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
        `INSERT INTO attendance_records (id, session_id, student_id, course_id, timestamp, latitude, longitude, device_id, distance_meters, status, source, semester_id, created_at, evidence, ip, ua, colo, net_distance_meters, net_lat, net_lng)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          "scan", // provenance: the student signed in themselves
          s.semesterId ?? null,
          now,
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
    // This feed answers "when did I sign in?", so materialised absences are
    // excluded: an absence is not a sign-in and must not be presented as one.
    const rows = await this.all<Row>(
      `SELECT ar.id, ar.timestamp, c.code AS course_code, c.title AS course_title
       FROM attendance_records ar JOIN courses c ON c.id = ar.course_id
       WHERE ar.student_id = ? AND ar.source <> 'auto_absent'
       ORDER BY ar.timestamp DESC, ar.id DESC LIMIT ?`,
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
      `SELECT session_id, timestamp, status, source
       FROM attendance_records WHERE course_id = ? AND student_id = ?`,
      [courseId, studentId],
    );
    const bySession = new Map<
      string,
      { timestamp: number; status: AttendanceStatus; source: string }
    >(
      rows.map((r) => [
        str(r.session_id),
        {
          timestamp: num(r.timestamp),
          status: (str(r.status) as AttendanceStatus) || "present",
          source: str(r.source) || "scan",
        },
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
        // Only a real sign-in has a "signed in at" time; a materialised absence
        // carries the lecture's timestamp for reporting but was not an action.
        attendedAt: rec && rec.source !== "auto_absent" ? rec.timestamp : undefined,
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

  async courseReport(
    courseId: string,
    filters: ReportFilters = {},
  ): Promise<CourseReport | undefined> {
    const course = await this.getCourse(courseId);
    if (!course) return undefined;
    const semesterId = filters.semesterId ?? (await this.academicPeriod()).semester?.id;

    // Period scoping: the detail page must agree with the row the All Courses
    // table shows for this course, so both read the same window (brief §5/§6).
    const sessionWhere = ["course_id = ?"];
    const sessionParams: unknown[] = [courseId];
    if (semesterId) {
      sessionWhere.push("(semester_id = ? OR semester_id IS NULL)");
      sessionParams.push(semesterId);
    }
    if (filters.from != null) {
      sessionWhere.push("started_at >= ?");
      sessionParams.push(filters.from);
    }
    if (filters.to != null) {
      sessionWhere.push("started_at <= ?");
      sessionParams.push(filters.to);
    }
    const meta = await this.first<Row>(
      `SELECT d.id AS department_id, d.name AS department_name, d.code AS department_code,
              f.name AS faculty_name, u.name AS lecturer_name
       FROM courses c
       LEFT JOIN departments d ON d.id = c.department_id
       LEFT JOIN faculties   f ON f.id = d.faculty_id
       LEFT JOIN users       u ON u.id = c.lecturer_id
       WHERE c.id = ?`,
      [courseId],
    );
    const sessionRows = await this.all<Row>(
      `SELECT * FROM sessions WHERE ${sessionWhere.join(" AND ")} ORDER BY started_at DESC`,
      sessionParams,
    );
    const sessions = sessionRows.map((r) => this.rowToSession(r));
    const total = sessions.length;
    const sessionIds = sessions.map((s) => s.id);
    const marks = sessionIds.map(() => "?").join(",");
    // Everything the student table counts is restricted to the lectures in
    // scope, so per-student tallies always reconcile with the per-lecture table.
    const inScope = sessionIds.length ? `ar.session_id IN (${marks})` : "1 = 0";
    const inScope2 = sessionIds.length ? `ar2.session_id IN (${marks})` : "1 = 0";
    const expectedWhere = ["s.course_id = ce.course_id", "s.started_at >= ce.enrolled_at"];
    const expectedParams: unknown[] = [];
    if (semesterId) {
      expectedWhere.push("(s.semester_id = ? OR s.semester_id IS NULL)");
      expectedParams.push(semesterId);
    }
    if (filters.from != null) {
      expectedWhere.push("s.started_at >= ?");
      expectedParams.push(filters.from);
    }
    if (filters.to != null) {
      expectedWhere.push("s.started_at <= ?");
      expectedParams.push(filters.to);
    }

    // One row per enrolled student with the four independent tallies.
    //
    // "Expected" is per-student, not the course-wide session count: a student
    // who enrolled in week 8 was never expected at the week-1 lecture, and a
    // lecture that ran before they joined must not appear as their absence.
    const rows = await this.all<Row>(
      `SELECT u.id, u.name, u.matric_no, u.role,
        (SELECT COUNT(*) FROM attendance_records ar
           WHERE ar.course_id = ? AND ar.student_id = u.id AND ar.status = 'present' AND ${inScope}) AS present,
        (SELECT COUNT(*) FROM attendance_records ar
           WHERE ar.course_id = ? AND ar.student_id = u.id AND ar.status = 'late' AND ${inScope}) AS late,
        (SELECT COUNT(*) FROM attendance_records ar
           WHERE ar.course_id = ? AND ar.student_id = u.id AND ar.status = 'excused' AND ${inScope}) AS excused,
        (SELECT COUNT(*) FROM attendance_records ar
           WHERE ar.course_id = ? AND ar.student_id = u.id AND ar.status = 'absent' AND ${inScope}) AS absent,
        (SELECT COUNT(DISTINCT ar2.device_id) FROM attendance_records ar2
           WHERE ar2.course_id = ? AND ar2.student_id = u.id AND ${inScope2}) AS devices,
        (SELECT COUNT(*) FROM sessions s
           WHERE ${expectedWhere.join(" AND ")}) AS expected_sessions
       FROM course_enrollments ce
       JOIN users u ON u.id = ce.student_id
       WHERE ce.course_id = ?
       ORDER BY u.name ASC`,
      [
        courseId,
        ...sessionIds,
        courseId,
        ...sessionIds,
        courseId,
        ...sessionIds,
        courseId,
        ...sessionIds,
        courseId,
        ...sessionIds,
        ...expectedParams,
        courseId,
      ],
    );

    const students: CourseReportStudent[] = rows.map((r) => {
      const counts = {
        present: num(r.present),
        late: num(r.late),
        excused: num(r.excused),
        absent: num(r.absent),
      };
      const attended = attendedCount(counts);
      const expected = Math.max(expectedCount(counts), 0);
      // Fall back to the sessions that ran since enrolment when nothing was
      // recorded (e.g. a brand-new course with no sessions yet, or a deploy
      // before absences were materialised): the denominator must reflect the
      // lectures the student was actually expected at.
      const expectedSessions = Math.max(expected, num(r.expected_sessions));
      return {
        id: str(r.id),
        name: str(r.name),
        matricNo: optStr(r.matric_no) ?? "—",
        attended,
        percentage: percentageInt(attended, expectedSessions) ?? 0,
        devices: num(r.devices),
        present: counts.present,
        late: counts.late,
        excused: counts.excused,
        absent: Math.max(counts.absent, expectedSessions - attended - counts.excused),
        expected: expectedSessions,
      };
    });
    students.sort((a, b) => b.percentage - a.percentage || a.name.localeCompare(b.name));

    // Course-wide tallies and the opportunity-weighted rate (brief §8).
    const totals = students.reduce(
      (acc, s) => {
        acc.present += s.present;
        acc.late += s.late;
        acc.excused += s.excused;
        acc.absent += s.absent;
        acc.expected += s.expected;
        return acc;
      },
      { present: 0, late: 0, excused: 0, absent: 0, expected: 0 },
    );
    const attended = attendedCount(totals);
    const counts: AttendanceCounts = {
      ...totals,
      attended,
      rate: percentage(attended, totals.expected, 1),
    };

    return {
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        level: course.level,
        units: course.units,
        category: course.category,
        departmentId: optStr(meta?.department_id),
        departmentName: optStr(meta?.department_name),
        departmentCode: optStr(meta?.department_code),
        facultyName: optStr(meta?.faculty_name),
        lecturerId: course.lecturerId,
        lecturerName: optStr(meta?.lecturer_name),
        semesterId: course.semesterId,
      },
      term: semesterId ? ((await this.academicPeriod()).semester ?? null) : null,
      totalSessions: total,
      sessions: [...sessions].sort((a, b) => a.startedAt - b.startedAt),
      students,
      counts,
      // Weighted, NOT the mean of per-student percentages: with unequal
      // attendance patterns those two answers differ, and the brief (§8)
      // requires this one.
      weightedRate: weightedPercentage(
        students.map((s) => ({ attended: s.attended, expected: s.expected })),
        1,
      ),
      meanOfStudents: meanOfPercentages(students.map((s) => s.percentage)) ?? null,
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

    // Non-overlapping local days anchored to the institution's clock, not the
    // server's UTC day (plan §3.2 / P0.4).
    const settings = await this.getSiteSettings();
    const tz = settings.timezone;
    const now = Date.now();
    const windows = recentDayWindows(now, tz, 7);
    const today = windows[windows.length - 1];

    // The weekly chart counts real sign-ins per local day. `timestamp` is stored
    // in UTC, so convert each bucket boundary algorithmically rather than
    // trusting SQLite's UTC-only date() function.
    const weekRows = await this.all<{ ts: number }>(
      "SELECT timestamp AS ts FROM attendance_records WHERE timestamp >= ? AND source <> 'auto_absent'",
      [windows[0].start],
    );
    const countByDay = new Map<string, number>();
    for (const w of windows) countByDay.set(w.key, 0);
    for (const r of weekRows) {
      const key = dayWindow(num(r.ts), tz).key;
      if (countByDay.has(key)) countByDay.set(key, (countByDay.get(key) ?? 0) + 1);
    }

    // Today's tallies: present / late / excused / absent, plus the lectures that
    // ran and the opportunity-weighted rate for the day.
    // "Ran today" = the lecture started inside the local day (an absence belongs
    // to the lecture that was missed, not to whenever the session was closed).
    const todayRows = await this.all<{ status: string; c: number }>(
      `SELECT status, COUNT(*) AS c FROM attendance_records
       WHERE timestamp >= ? AND timestamp < ? GROUP BY status`,
      [today.start, today.end],
    );
    const todayCounts = emptyCounts();
    for (const r of todayRows) {
      const status = str(r.status) as keyof typeof todayCounts;
      if (status in todayCounts) todayCounts[status] += num(r.c);
    }
    const classesHeld =
      (
        await this.first<{ c: number }>(
          "SELECT COUNT(*) AS c FROM sessions WHERE started_at >= ? AND started_at < ?",
          [today.start, today.end],
        )
      )?.c ?? 0;
    const todayExpected = attendedCount(todayCounts) + todayCounts.excused + todayCounts.absent;

    return {
      today: {
        date: today.key,
        label: today.label,
        present: todayCounts.present,
        late: todayCounts.late,
        excused: todayCounts.excused,
        absent: todayCounts.absent,
        classesHeld,
        rate: percentage(attendedCount(todayCounts), todayExpected, 1),
        expected: todayExpected,
      },
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
      weeklyAttendance: windows.map((w) => ({
        label: w.label,
        key: w.key,
        count: countByDay.get(w.key) ?? 0,
      })),
    };
  }

  // ── Audit trail (append-only — plan §4.6) ──

  /** Insert one audit row. There is deliberately no update/delete counterpart. */
  async appendAudit(input: AppendAuditInput): Promise<string> {
    const id = nanoid(14);
    const encode = (v: unknown): string | null => {
      if (v === undefined || v === null) return null;
      try {
        return JSON.stringify(v);
      } catch {
        return JSON.stringify({ unserializable: String(v) });
      }
    };
    await this.run(
      `INSERT INTO audit_log (id, actor_id, actor_role, actor_email, action, entity_type, entity_id,
         course_id, semester_id, before_json, after_json, reason, ip_pointer, ua_pointer, req_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.actorId ?? null,
        input.actorRole ?? null,
        input.actorEmail ?? null,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.courseId ?? null,
        input.semesterId ?? null,
        encode(input.before),
        encode(input.after),
        input.reason ?? null,
        input.ipPointer ?? null,
        input.uaPointer ?? null,
        input.reqId ?? null,
        Date.now(),
      ],
    );
    return id;
  }

  /** Read the trail (newest first). Read-only by design. */
  async listAudit(query: AuditQuery = {}): Promise<Paginated<AuditEntry>> {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(query.pageSize ?? 50)));
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.action) {
      where.push("action = ?");
      params.push(query.action);
    }
    if (query.actorId) {
      where.push("actor_id = ?");
      params.push(query.actorId);
    }
    if (query.entityType) {
      where.push("entity_type = ?");
      params.push(query.entityType);
    }
    if (query.entityId) {
      where.push("entity_id = ?");
      params.push(query.entityId);
    }
    if (query.courseId) {
      where.push("course_id = ?");
      params.push(query.courseId);
    }
    if (query.from != null) {
      where.push("created_at >= ?");
      params.push(query.from);
    }
    if (query.to != null) {
      where.push("created_at <= ?");
      params.push(query.to);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total =
      (await this.first<{ c: number }>(`SELECT COUNT(*) AS c FROM audit_log ${clause}`, params))
        ?.c ?? 0;
    const rows = await this.all<Row>(
      `SELECT * FROM audit_log ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    const parse = (v: unknown): unknown => {
      const s = optStr(v);
      if (s == null) return undefined;
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    };
    return {
      items: rows.map((r) => ({
        id: str(r.id),
        actorId: optStr(r.actor_id),
        actorRole: optStr(r.actor_role),
        actorEmail: optStr(r.actor_email),
        action: str(r.action),
        entityType: str(r.entity_type),
        entityId: optStr(r.entity_id),
        courseId: optStr(r.course_id),
        semesterId: optStr(r.semester_id),
        before: parse(r.before_json),
        after: parse(r.after_json),
        reason: optStr(r.reason),
        reqId: optStr(r.req_id),
        createdAt: num(r.created_at),
      })),
      total,
      page,
      pageSize,
    };
  }

  // ── Academic structure: faculties, sessions, semesters (plan §4.1) ──
  //
  // The brief's sidebar and filter bar need the institution hierarchy
  // (Faculty → Department → Course) and the period model (Session → Semester).
  // Everything here is CRUD plus one resolver (`academicPeriod`) that the top bar,
  // the filters, and the exports all read from.

  private rowToFaculty(r: Row): Faculty {
    return {
      id: str(r.id),
      name: str(r.name),
      code: str(r.code),
      deanUserId: optStr(r.dean_user_id),
      icon: optStr(r.icon),
      color: optStr(r.color),
      createdAt: num(r.created_at),
    };
  }

  private rowToAcademicSession(r: Row): AcademicSession {
    return {
      id: str(r.id),
      name: str(r.name),
      code: str(r.code),
      startsOn: optNum(r.starts_on),
      endsOn: optNum(r.ends_on),
      isCurrent: num(r.is_current) === 1,
      createdAt: num(r.created_at),
    };
  }

  private rowToSemester(r: Row): Semester {
    return {
      id: str(r.id),
      academicSessionId: str(r.academic_session_id),
      name: str(r.name),
      sequence: num(r.sequence),
      startsOn: optNum(r.starts_on),
      endsOn: optNum(r.ends_on),
      isCurrent: num(r.is_current) === 1,
      finalizedAt: optNum(r.finalized_at),
      createdAt: num(r.created_at),
    };
  }

  async listFaculties(): Promise<Faculty[]> {
    const rows = await this.all<Row>("SELECT * FROM faculties ORDER BY name ASC");
    return rows.map((r) => this.rowToFaculty(r));
  }

  async createFaculty(input: {
    name: string;
    code: string;
    deanUserId?: string;
    icon?: string;
    color?: string;
  }): Promise<Faculty> {
    const code = input.code.toUpperCase().trim();
    const dup = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM faculties WHERE LOWER(code) = LOWER(?)",
      [code],
    );
    if (dup && dup.c > 0) throw new BusinessError("A faculty with this code already exists");
    const f: Faculty = {
      id: nanoid(8),
      name: input.name.trim(),
      code,
      deanUserId: input.deanUserId,
      icon: input.icon,
      color: input.color,
      createdAt: Date.now(),
    };
    await this.run(
      "INSERT INTO faculties (id, name, code, dean_user_id, icon, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [f.id, f.name, f.code, f.deanUserId ?? null, f.icon ?? null, f.color ?? null, f.createdAt],
    );
    return f;
  }

  async updateFaculty(
    id: string,
    patch: Partial<Pick<Faculty, "name" | "code" | "deanUserId" | "icon" | "color">>,
  ): Promise<Faculty> {
    const current = await this.first<Row>("SELECT * FROM faculties WHERE id = ?", [id]);
    if (!current) throw new BusinessError("Faculty not found");
    const next = { ...this.rowToFaculty(current), ...patch };
    if (patch.code) {
      const code = patch.code.toUpperCase().trim();
      const dup = await this.first<{ c: number }>(
        "SELECT COUNT(*) AS c FROM faculties WHERE LOWER(code) = LOWER(?) AND id <> ?",
        [code, id],
      );
      if (dup && dup.c > 0) throw new BusinessError("A faculty with this code already exists");
      next.code = code;
    }
    await this.run(
      "UPDATE faculties SET name = ?, code = ?, dean_user_id = ?, icon = ?, color = ? WHERE id = ?",
      [next.name, next.code, next.deanUserId ?? null, next.icon ?? null, next.color ?? null, id],
    );
    return next;
  }

  async deleteFaculty(id: string): Promise<void> {
    const inUse = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM departments WHERE faculty_id = ?",
      [id],
    );
    if (inUse && inUse.c > 0) {
      throw new BusinessError("Move this faculty's departments elsewhere before deleting it");
    }
    await this.run("DELETE FROM faculties WHERE id = ?", [id]);
  }

  async setDepartmentFaculty(departmentId: string, facultyId: string | null): Promise<void> {
    const d = await this.first<Row>("SELECT id FROM departments WHERE id = ?", [departmentId]);
    if (!d) throw new BusinessError("Department not found");
    if (facultyId) {
      const f = await this.first<Row>("SELECT id FROM faculties WHERE id = ?", [facultyId]);
      if (!f) throw new BusinessError("Faculty not found");
    }
    await this.run("UPDATE departments SET faculty_id = ? WHERE id = ?", [facultyId, departmentId]);
  }

  async listAcademicSessions(): Promise<AcademicSession[]> {
    const rows = await this.all<Row>(
      "SELECT * FROM academic_sessions ORDER BY is_current DESC, code DESC",
    );
    return rows.map((r) => this.rowToAcademicSession(r));
  }

  async createAcademicSession(input: {
    name: string;
    code: string;
    startsOn?: number;
    endsOn?: number;
    makeCurrent?: boolean;
  }): Promise<AcademicSession> {
    const code = input.code.trim();
    const dup = await this.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM academic_sessions WHERE LOWER(code) = LOWER(?)",
      [code],
    );
    if (dup && dup.c > 0) throw new BusinessError("That academic session already exists");
    const s: AcademicSession = {
      id: nanoid(8),
      name: input.name.trim(),
      code,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      isCurrent: Boolean(input.makeCurrent),
      createdAt: Date.now(),
    };
    await this.run(
      "INSERT INTO academic_sessions (id, name, code, starts_on, ends_on, is_current, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        s.id,
        s.name,
        s.code,
        s.startsOn ?? null,
        s.endsOn ?? null,
        s.isCurrent ? 1 : 0,
        s.createdAt,
      ],
    );
    // A single current session keeps the top-bar selector unambiguous.
    if (s.isCurrent) await this.setCurrentAcademicSession(s.id);
    return s;
  }

  async setCurrentAcademicSession(id: string): Promise<void> {
    const s = await this.first<Row>("SELECT id FROM academic_sessions WHERE id = ?", [id]);
    if (!s) throw new BusinessError("Academic session not found");
    const before = await this.getSiteSettings();
    await this.run("UPDATE academic_sessions SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END", [
      id,
    ]);
    await this.run("UPDATE semesters SET is_current = 0 WHERE academic_session_id <> ?", [id]);
    // The institution's active session is the one the dashboard reports on.
    const semesters = await this.listSemesters(id);
    const current = semesters.find((x) => x.isCurrent) ?? semesters[0];
    await this.run(
      "UPDATE site_settings SET current_academic_session_id = ?, current_semester_id = ? WHERE id = 'site'",
      [id, current ? current.id : null],
    );
    if (current && !current.isCurrent) await this.setCurrentSemester(current.id);
    void before;
  }

  async listSemesters(academicSessionId?: string): Promise<Semester[]> {
    const rows = academicSessionId
      ? await this.all<Row>(
          "SELECT * FROM semesters WHERE academic_session_id = ? ORDER BY sequence ASC",
          [academicSessionId],
        )
      : await this.all<Row>("SELECT * FROM semesters ORDER BY created_at DESC");
    return rows.map((r) => this.rowToSemester(r));
  }

  async createSemester(input: {
    academicSessionId: string;
    name: string;
    sequence?: number;
    startsOn?: number;
    endsOn?: number;
    makeCurrent?: boolean;
  }): Promise<Semester> {
    const parent = await this.first<Row>("SELECT id FROM academic_sessions WHERE id = ?", [
      input.academicSessionId,
    ]);
    if (!parent) throw new BusinessError("Academic session not found");
    const existing = await this.listSemesters(input.academicSessionId);
    const sequence = input.sequence ?? existing.length + 1;
    if (existing.some((s) => s.sequence === sequence)) {
      throw new BusinessError(`This academic session already has a semester ${sequence}`);
    }
    const s: Semester = {
      id: nanoid(8),
      academicSessionId: input.academicSessionId,
      name: input.name.trim(),
      sequence,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      isCurrent: Boolean(input.makeCurrent),
      createdAt: Date.now(),
    };
    await this.run(
      `INSERT INTO semesters (id, academic_session_id, name, sequence, starts_on, ends_on, is_current, finalized_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        s.id,
        s.academicSessionId,
        s.name,
        s.sequence,
        s.startsOn ?? null,
        s.endsOn ?? null,
        s.isCurrent ? 1 : 0,
        s.createdAt,
      ],
    );
    if (s.isCurrent) await this.setCurrentSemester(s.id);
    return s;
  }

  async updateSemester(
    id: string,
    patch: Partial<Pick<Semester, "name" | "startsOn" | "endsOn">>,
  ): Promise<Semester> {
    const row = await this.first<Row>("SELECT * FROM semesters WHERE id = ?", [id]);
    if (!row) throw new BusinessError("Semester not found");
    const next = { ...this.rowToSemester(row), ...patch };
    await this.run("UPDATE semesters SET name = ?, starts_on = ?, ends_on = ? WHERE id = ?", [
      next.name,
      next.startsOn ?? null,
      next.endsOn ?? null,
      id,
    ]);
    return next;
  }

  async setCurrentSemester(id: string): Promise<void> {
    const s = await this.first<Row>("SELECT * FROM semesters WHERE id = ?", [id]);
    if (!s) throw new BusinessError("Semester not found");
    await this.run("UPDATE semesters SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END", [id]);
    await this.run(
      "UPDATE site_settings SET current_semester_id = ?, current_academic_session_id = ? WHERE id = 'site'",
      [id, str(s.academic_session_id)],
    );
    // Courses scoped to another semester keep their history; the active period
    // is what the dashboard and the default filter resolve to.
    await this.run("UPDATE academic_sessions SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END", [
      str(s.academic_session_id),
    ]);
  }

  /** Publish/freeze a period: no new lectures, no corrections without override. */
  async finalizeSemester(id: string): Promise<Semester> {
    const row = await this.first<Row>("SELECT * FROM semesters WHERE id = ?", [id]);
    if (!row) throw new BusinessError("Semester not found");
    if (num(row.finalized_at) > 0) return this.rowToSemester(row);
    const now = Date.now();
    await this.run("UPDATE semesters SET finalized_at = ? WHERE id = ?", [now, id]);
    // Lock every record in this period so the audit rule ("nobody edits a
    // published period without an override") is enforced at the data layer too.
    await this.run("UPDATE attendance_records SET locked = 1 WHERE semester_id = ?", [id]);
    return (await this.first<Row>("SELECT * FROM semesters WHERE id = ?", [id]))!.id
      ? this.rowToSemester((await this.first<Row>("SELECT * FROM semesters WHERE id = ?", [id]))!)
      : this.rowToSemester(row);
  }

  async reopenSemester(id: string): Promise<Semester> {
    const row = await this.first<Row>("SELECT * FROM semesters WHERE id = ?", [id]);
    if (!row) throw new BusinessError("Semester not found");
    await this.run("UPDATE semesters SET finalized_at = NULL WHERE id = ?", [id]);
    await this.run("UPDATE attendance_records SET locked = 0 WHERE semester_id = ?", [id]);
    return this.rowToSemester({ ...row, finalized_at: null });
  }

  /** The institution's active period plus everything the selector needs. */
  async academicPeriod(): Promise<AcademicPeriod> {
    const settings = await this.getSiteSettings();
    const sessions = await this.listAcademicSessions();
    const academicSession =
      sessions.find((s) => s.id === settings.currentAcademicSessionId) ??
      sessions.find((s) => s.isCurrent) ??
      sessions[0] ??
      null;
    const semesters = academicSession ? await this.listSemesters(academicSession.id) : [];
    const semester =
      semesters.find((s) => s.id === settings.currentSemesterId) ??
      semesters.find((s) => s.isCurrent) ??
      semesters[semesters.length - 1] ??
      null;
    return { academicSession, semester, academicSessions: sessions, semesters };
  }

  // ── The All-Courses attendance report (brief §4 + §6) ──
  //
  // One pass over the catalogue with three aggregate queries (courses, lecture
  // counts, status tallies) — never a query per course, so a 500-course
  // institution stays fast. Every rate is opportunity-weighted (plan §8).
  //
  //   classesHeld      lectures that actually ran in the window
  //   expected         Σ (registered students × lectures they were expected at);
  //                    computed from the roster join, so it is correct even for
  //                    lectures recorded before absences were materialised
  //   attended         present + late
  //   classesAttended  opportunity-weighted average lectures attended per student
  //                    (the brief's "Classes Attended" column: rate × classesHeld)
  async coursesReport(filters: ReportFilters = {}): Promise<CoursesReport> {
    const settings = await this.getSiteSettings();
    const period = await this.academicPeriod();
    const semesterId = filters.semesterId ?? period.semester?.id;
    const threshold = settings.atRiskThreshold;
    const now = Date.now();

    // ── 1. Catalogue rows (with the filters that apply to a course itself) ──
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.courseId) {
      where.push("c.id = ?");
      params.push(filters.courseId);
    }
    const selectedIds = (filters.courseIds ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 500);
    if (selectedIds.length > 0) {
      where.push(`c.id IN (${selectedIds.map(() => "?").join(",")})`);
      params.push(...selectedIds);
    }
    if (filters.departmentId) {
      where.push("c.department_id = ?");
      params.push(filters.departmentId);
    }
    if (filters.facultyId) {
      where.push("d.faculty_id = ?");
      params.push(filters.facultyId);
    }
    if (filters.lecturerId) {
      where.push("c.lecturer_id = ?");
      params.push(filters.lecturerId);
    }
    if (filters.category) {
      where.push("c.category = ?");
      params.push(filters.category);
    }
    if (semesterId) {
      where.push("(c.semester_id = ? OR c.semester_id IS NULL)");
      params.push(semesterId);
    }
    if (filters.search) {
      const like = `%${filters.search.trim().toLowerCase()}%`;
      where.push(
        `(LOWER(c.code) LIKE ? OR LOWER(c.title) LIKE ? OR LOWER(COALESCE(d.name, '')) LIKE ?
          OR LOWER(COALESCE(u.name, '')) LIKE ? OR LOWER(COALESCE(d.code, '')) LIKE ?)`,
      );
      params.push(like, like, like, like, like);
    }
    const courseRows = await this.all<Row>(
      `SELECT c.id, c.code, c.title, c.department_id, c.lecturer_id, c.semester_id, c.level, c.units,
              c.category,
              d.name AS department_name, d.code AS department_code, d.faculty_id,
              f.name AS faculty_name, u.name AS lecturer_name,
              (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id) AS enrolled
       FROM courses c
       LEFT JOIN departments d ON d.id = c.department_id
       LEFT JOIN faculties   f ON f.id = d.faculty_id
       LEFT JOIN users       u ON u.id = c.lecturer_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.code ASC`,
      params,
    );
    if (courseRows.length === 0) {
      return {
        rows: [],
        totals: emptyTotals(),
        meta: {
          generatedAt: now,
          filters: { ...filters, semesterId },
          period: {
            academicSession: period.academicSession ?? undefined,
            semester: period.semester ?? undefined,
          },
          calculation: "opportunity-weighted",
          threshold,
        },
        page: 1,
        pageSize: filters.pageSize ?? 25,
        total: 0,
      };
    }
    const ids = courseRows.map((r) => str(r.id));
    const marks = ids.map(() => "?").join(",");

    // ── 2. Lectures that ran in the window ──
    // A lecture counts as held once it has started (a scheduled future leg is
    // not yet a class the administrator should be reporting on).
    const sessionWhere: string[] = [`s.course_id IN (${marks})`, "s.started_at <= ?"];
    const sessionParams: unknown[] = [...ids, now];
    if (semesterId) {
      sessionWhere.push("(s.semester_id = ? OR s.semester_id IS NULL)");
      sessionParams.push(semesterId);
    }
    if (filters.from != null) {
      sessionWhere.push("s.started_at >= ?");
      sessionParams.push(filters.from);
    }
    if (filters.to != null) {
      sessionWhere.push("s.started_at <= ?");
      sessionParams.push(filters.to);
    }
    const sessionRows = await this.all<Row>(
      `SELECT s.course_id, COUNT(*) AS held
       FROM sessions s
       WHERE ${sessionWhere.join(" AND ")}
       GROUP BY s.course_id`,
      sessionParams,
    );
    const heldBy = new Map(sessionRows.map((r) => [str(r.course_id), num(r.held)]));

    // ── 3. Opportunities (the denominator) and tallies (the numerators) ──
    // Opportunities are joined from the roster, so a student who enrolled after a
    // lecture never inflates that course's denominator.
    const opportunityRows = await this.all<Row>(
      `SELECT s.course_id, COUNT(*) AS opportunities
       FROM sessions s
       JOIN course_enrollments ce ON ce.course_id = s.course_id AND ce.enrolled_at <= s.started_at
       WHERE ${sessionWhere.join(" AND ")}
       GROUP BY s.course_id`,
      sessionParams,
    );
    const expectedBy = new Map(
      opportunityRows.map((r) => [str(r.course_id), num(r.opportunities)]),
    );

    const recordWhere: string[] = [`ar.course_id IN (${marks})`, "ar.timestamp <= ?"];
    const recordParams: unknown[] = [...ids, now];
    if (semesterId) {
      recordWhere.push("(ar.semester_id = ? OR ar.semester_id IS NULL)");
      recordParams.push(semesterId);
    }
    if (filters.from != null) {
      recordWhere.push("ar.timestamp >= ?");
      recordParams.push(filters.from);
    }
    if (filters.to != null) {
      recordWhere.push("ar.timestamp <= ?");
      recordParams.push(filters.to);
    }
    if (filters.status) {
      recordWhere.push("ar.status = ?");
      recordParams.push(filters.status);
    }
    const statusRows = await this.all<Row>(
      `SELECT ar.course_id, ar.status, COUNT(*) AS c
       FROM attendance_records ar
       WHERE ${recordWhere.join(" AND ")}
       GROUP BY ar.course_id, ar.status`,
      recordParams,
    );
    const tallyBy = new Map<string, StatusCounts>();
    for (const r of statusRows) {
      const key = str(r.course_id);
      const tally = tallyBy.get(key) ?? emptyCounts();
      const status = str(r.status) as keyof StatusCounts;
      if (status in tally) tally[status] += num(r.c);
      tallyBy.set(key, tally);
    }

    // ── 4. Assemble the brief's twelve columns ──
    let rows: CourseReportRow[] = courseRows.map((r) => {
      const id = str(r.id);
      const tally = tallyBy.get(id) ?? emptyCounts();
      const classesHeld = heldBy.get(id) ?? 0;
      const attended = attendedCount(tally);
      // Expected: the roster-join total when lectures exist, otherwise the
      // recorded opportunities (a course whose absences were never materialised
      // must not report 100%).
      const recorded = tally.present + tally.late + tally.excused + tally.absent;
      const expected = Math.max(expectedBy.get(id) ?? 0, recorded);
      const rate = percentage(attended, expected, 1);
      const absent = Math.max(tally.absent, expected - attended - tally.excused);
      return {
        id,
        code: str(r.code),
        title: str(r.title),
        departmentId: str(r.department_id),
        departmentName: optStr(r.department_name),
        departmentCode: optStr(r.department_code),
        facultyId: optStr(r.faculty_id),
        facultyName: optStr(r.faculty_name),
        lecturerId: optStr(r.lecturer_id),
        lecturerName: optStr(r.lecturer_name),
        semesterId: optStr(r.semester_id),
        level: str(r.level),
        units: num(r.units),
        category: optStr(r.category),
        enrolled: num(r.enrolled),
        classesHeld,
        // Average lectures attended per student (matches the brief's worked
        // example: 14 of 16 lectures → 87.5%).
        classesAttended: rate === null ? 0 : Math.round(classesHeld * (rate / 100) * 10) / 10,
        present: tally.present,
        absent,
        late: tally.late,
        excused: tally.excused,
        attended,
        expected,
        rate,
        health: health(rate, threshold),
      };
    });

    // ── 5. Sorting (server-side, so pagination is stable) ──
    const sort = filters.sort ?? "code";
    const dir = filters.dir === "desc" ? -1 : 1;
    const numeric = (v: number | null): number => (v === null ? -1 : v);
    rows = rows.sort((a, b) => {
      let cmp: number;
      switch (sort) {
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "department":
          cmp = (a.departmentCode ?? "").localeCompare(b.departmentCode ?? "");
          break;
        case "enrolled":
          cmp = a.enrolled - b.enrolled;
          break;
        case "classesHeld":
          cmp = a.classesHeld - b.classesHeld;
          break;
        case "classesAttended":
          cmp = a.classesAttended - b.classesAttended;
          break;
        case "rate":
          cmp = numeric(a.rate) - numeric(b.rate);
          break;
        case "present":
          cmp = a.present - b.present;
          break;
        case "absent":
          cmp = a.absent - b.absent;
          break;
        case "late":
          cmp = a.late - b.late;
          break;
        default:
          cmp = a.code.localeCompare(b.code);
      }
      return cmp * dir || a.code.localeCompare(b.code);
    });

    const totals: CourseReportTotals = rows.reduce((acc, r) => {
      acc.courses += 1;
      acc.enrolled += r.enrolled;
      acc.classesHeld += r.classesHeld;
      // Summed here, then replaced below by the opportunity-weighted mean of
      // the same column: adding up per-course averages would let a 4-student
      // elective weigh as much as a 428-student core course (brief §8).
      acc.classesAttended = Math.round((acc.classesAttended + r.classesAttended) * 10) / 10;
      acc.present += r.present;
      acc.absent += r.absent;
      acc.late += r.late;
      acc.excused += r.excused;
      acc.attended += r.attended;
      acc.expected += r.expected;
      return acc;
    }, emptyTotals());
    totals.rate = weightedPercentage(
      rows.map((r) => ({ attended: r.attended, expected: r.expected })),
      1,
    );
    if (totals.expected > 0 && totals.enrolled > 0) {
      totals.classesAttended = Math.round((totals.attended / totals.enrolled) * 10) / 10;
    }

    // ── 6. Pagination (the totals describe the *filtered* set, not the page) ──
    const total = rows.length;
    const pageSize = Math.min(500, Math.max(1, filters.pageSize ?? 25));
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const start = (page - 1) * pageSize;
    const paged = rows.slice(start, start + pageSize);

    return {
      rows: paged,
      totals,
      meta: {
        generatedAt: now,
        filters: { ...filters, semesterId, sort, dir: filters.dir ?? "asc" },
        period: {
          academicSession: period.academicSession ?? undefined,
          semester: period.semester ?? undefined,
        },
        calculation: "opportunity-weighted",
        threshold,
      },
      page,
      pageSize,
      total,
    };
  }

  /** Per-lecture breakdown for the course detail page (brief §5). */
  async courseSessionStats(
    courseId: string,
    filters: ReportFilters = {},
  ): Promise<CourseSessionStat[]> {
    const where = ["s.course_id = ?"];
    const params: unknown[] = [courseId];
    if (filters.semesterId) {
      where.push("(s.semester_id = ? OR s.semester_id IS NULL)");
      params.push(filters.semesterId);
    }
    if (filters.from != null) {
      where.push("s.started_at >= ?");
      params.push(filters.from);
    }
    if (filters.to != null) {
      where.push("s.started_at <= ?");
      params.push(filters.to);
    }
    const sessions = await this.all<Row>(
      `SELECT s.id, s.started_at, s.ended_at, s.topic FROM sessions s
       WHERE ${where.join(" AND ")} ORDER BY s.started_at ASC`,
      params,
    );
    if (sessions.length === 0) return [];
    const ids = sessions.map((r) => str(r.id));
    const marks = ids.map(() => "?").join(",");
    const rows = await this.all<Row>(
      `SELECT session_id, status, COUNT(*) AS c FROM attendance_records
       WHERE session_id IN (${marks}) GROUP BY session_id, status`,
      ids,
    );
    const tally = new Map<string, StatusCounts>();
    for (const r of rows) {
      const key = str(r.session_id);
      const t = tally.get(key) ?? emptyCounts();
      const status = str(r.status) as keyof StatusCounts;
      if (status in t) t[status] += num(r.c);
      tally.set(key, t);
    }
    // Expected per lecture = students on the roster when it started.
    const rosterRows = await this.all<Row>(
      `SELECT s.id AS session_id, COUNT(*) AS expected
       FROM sessions s
       JOIN course_enrollments ce ON ce.course_id = s.course_id AND ce.enrolled_at <= s.started_at
       WHERE s.id IN (${marks})
       GROUP BY s.id`,
      ids,
    );
    const expectedBy = new Map(rosterRows.map((r) => [str(r.session_id), num(r.expected)]));
    return sessions.map((s) => {
      const id = str(s.id);
      const t = tally.get(id) ?? emptyCounts();
      const attended = attendedCount(t);
      const recorded = t.present + t.late + t.excused + t.absent;
      const expected = Math.max(expectedBy.get(id) ?? 0, recorded);
      return {
        sessionId: id,
        startedAt: num(s.started_at),
        endedAt: optNum(s.ended_at),
        topic: optStr(s.topic),
        present: t.present,
        late: t.late,
        excused: t.excused,
        absent: Math.max(t.absent, expected - attended - t.excused),
        expected,
        rate: percentage(attended, expected, 1),
      };
    });
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
      currentAcademicSessionId: merged.currentAcademicSessionId ?? null,
      currentSemesterId: merged.currentSemesterId ?? null,
      logoUrl: merged.logoUrl ?? null,
      reportFooterNote: merged.reportFooterNote ?? null,
    };
    await this.run(
      `INSERT INTO site_settings (id, institution_name, at_risk_threshold, timezone, late_counts_as_attended,
        excused_counts_as_absent, marquee_items, testimonials,
        demo_accounts_enabled, demo_password, demo_email_domain, show_fake_stats, primary_color, contact_email,
        current_academic_session_id, current_semester_id, logo_url, report_footer_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        institution_name = excluded.institution_name,
        at_risk_threshold = excluded.at_risk_threshold,
        timezone = excluded.timezone,
        late_counts_as_attended = excluded.late_counts_as_attended,
        excused_counts_as_absent = excluded.excused_counts_as_absent,
        marquee_items = excluded.marquee_items,
        testimonials = excluded.testimonials,
        demo_accounts_enabled = excluded.demo_accounts_enabled,
        demo_password = excluded.demo_password,
        demo_email_domain = excluded.demo_email_domain,
        show_fake_stats = excluded.show_fake_stats,
        primary_color = excluded.primary_color,
        contact_email = excluded.contact_email,
        current_academic_session_id = COALESCE(excluded.current_academic_session_id, site_settings.current_academic_session_id),
        current_semester_id = COALESCE(excluded.current_semester_id, site_settings.current_semester_id),
        logo_url = excluded.logo_url,
        report_footer_note = excluded.report_footer_note`,
      [
        next.id,
        next.institutionName,
        next.atRiskThreshold,
        next.timezone,
        next.lateCountsAsAttended ? 1 : 0,
        next.excusedCountsAsAbsent ? 1 : 0,
        JSON.stringify(next.marqueeItems),
        JSON.stringify(next.testimonials),
        next.demoAccountsEnabled ? 1 : 0,
        next.demoPassword,
        next.demoEmailDomain,
        next.showFakeStats ? 1 : 0,
        next.primaryColor,
        next.contactEmail,
        next.currentAcademicSessionId,
        next.currentSemesterId,
        next.logoUrl,
        next.reportFooterNote,
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
