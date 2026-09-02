// Single D1-backed data layer. The previous implementation carried two parallel
// repositories (in-memory + D1) that had already drifted apart in behaviour;
// production now has exactly one code path, and local development runs the same
// path against Miniflare's local D1.

import type {
  AdminOverview,
  AttendanceSession,
  Course,
  CourseReport,
  Department,
  FacultyReport,
  Page,
  Pagination,
  PublicUser,
  Role,
  SessionDetail,
  SiteSettings,
  StudentCourseView,
} from "../../shared/schemas";
import { ApiError, mapDbError } from "./errors";
import { generateAttendanceCode, hashPassword, randomId } from "./crypto";

type Row = Record<string, unknown>;

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

function safeJsonArray<T>(value: unknown, fallback: T[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function toUser(r: Row): PublicUser {
  return {
    id: r.id as string,
    email: r.email as string,
    name: r.name as string,
    role: r.role as Role,
    matricNo: (r.matric_no as string) ?? undefined,
    staffId: (r.staff_id as string) ?? undefined,
    departmentId: (r.department_id as string) ?? undefined,
    departmentName: (r.department_name as string) ?? undefined,
    level: (r.level as string) ?? undefined,
    createdAt: Number(r.created_at ?? 0),
    lastLoginAt: r.last_login_at == null ? undefined : Number(r.last_login_at),
  };
}

function toSession(r: Row): AttendanceSession {
  return {
    id: r.id as string,
    courseId: r.course_id as string,
    courseCode: (r.course_code as string) ?? undefined,
    courseTitle: (r.course_title as string) ?? undefined,
    lecturerId: r.lecturer_id as string,
    code: r.code as string,
    startedAt: Number(r.started_at),
    expiresAt: Number(r.expires_at),
    endedAt: r.ended_at == null ? undefined : Number(r.ended_at),
    latitude: r.latitude == null ? undefined : Number(r.latitude),
    longitude: r.longitude == null ? undefined : Number(r.longitude),
    radiusMeters: r.radius_meters == null ? undefined : Number(r.radius_meters),
    topic: (r.topic as string) ?? undefined,
    attendedCount: r.attended_count == null ? undefined : Number(r.attended_count),
    enrolledCount: r.enrolled_count == null ? undefined : Number(r.enrolled_count),
  };
}

function toCourse(r: Row, enrolledIds: string[] = []): Course {
  return {
    id: r.id as string,
    code: r.code as string,
    title: r.title as string,
    departmentId: r.department_id as string,
    departmentName: (r.department_name as string) ?? undefined,
    level: r.level as string,
    units: Number(r.units),
    lecturerId: (r.lecturer_id as string) ?? undefined,
    lecturerName: (r.lecturer_name as string) ?? undefined,
    enrolledStudentIds: enrolledIds,
    enrolledCount: Number(r.enrolled_count ?? enrolledIds.length),
    sessionCount: Number(r.session_count ?? 0),
    icon: (r.icon as string) ?? undefined,
    color: (r.color as string) ?? undefined,
    category: (r.category as string) ?? undefined,
    description: (r.description as string) ?? undefined,
    archivedAt: r.archived_at == null ? undefined : Number(r.archived_at),
  };
}

const COURSE_SELECT = `
  SELECT c.*, d.name AS department_name, u.name AS lecturer_name,
         (SELECT COUNT(*) FROM course_enrollments e WHERE e.course_id = c.id) AS enrolled_count,
         (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id) AS session_count
  FROM courses c
  LEFT JOIN departments d ON d.id = c.department_id
  LEFT JOIN users u ON u.id = c.lecturer_id AND u.deleted_at IS NULL`;

export class Repo {
  constructor(private db: D1Database) {}

  private async all<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.db
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return (res.results ?? []) as T[];
  }
  private async first<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.db
      .prepare(sql)
      .bind(...params)
      .first<T>()) as T | null;
  }
  private async run(sql: string, params: unknown[] = []) {
    return this.db
      .prepare(sql)
      .bind(...params)
      .run();
  }
  private async count(sql: string, params: unknown[] = []): Promise<number> {
    const r = await this.first<{ c: number }>(sql, params);
    return Number(r?.c ?? 0);
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async getUser(id: string): Promise<PublicUser | null> {
    const r = await this.first(
      `SELECT u.*, d.name AS department_name FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.id = ? AND u.deleted_at IS NULL`,
      [id],
    );
    return r ? toUser(r) : null;
  }

  async getAuthUser(email: string) {
    return this.first<{
      id: string;
      email: string;
      name: string;
      role: Role;
      password_hash: string;
      token_version: number;
      failed_logins: number;
      locked_until: number | null;
    }>(
      `SELECT id, email, name, role, password_hash, token_version, failed_logins, locked_until
       FROM users WHERE LOWER(email) = LOWER(?) AND deleted_at IS NULL`,
      [email],
    );
  }

  async recordLoginFailure(userId: string, failedLogins: number, lockUntil: number | null) {
    await this.run("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", [
      failedLogins,
      lockUntil,
      userId,
    ]);
  }

  async recordLoginSuccess(userId: string, rehashed?: string) {
    if (rehashed) {
      await this.run(
        "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ?, password_hash = ? WHERE id = ?",
        [Date.now(), rehashed, userId],
      );
      return;
    }
    await this.run(
      "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?",
      [Date.now(), userId],
    );
  }

  async listUsers(
    opts: Pagination & { role?: Role; departmentId?: string; level?: string },
  ): Promise<Page<PublicUser>> {
    const where: string[] = ["u.deleted_at IS NULL"];
    const params: unknown[] = [];
    if (opts.role) {
      where.push("u.role = ?");
      params.push(opts.role);
    }
    if (opts.departmentId) {
      where.push("u.department_id = ?");
      params.push(opts.departmentId);
    }
    if (opts.level) {
      where.push("u.level = ?");
      params.push(opts.level);
    }
    if (opts.search) {
      where.push(
        "(u.name LIKE ?1 OR u.email LIKE ?1 OR IFNULL(u.matric_no,'') LIKE ?1 OR IFNULL(u.staff_id,'') LIKE ?1)".replace(
          /\?1/g,
          "?",
        ),
      );
      const like = `%${opts.search}%`;
      params.push(like, like, like, like);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const sortable: Record<string, string> = {
      name: "u.name",
      email: "u.email",
      createdAt: "u.created_at",
      level: "u.level",
    };
    const orderBy = sortable[opts.sort ?? "name"] ?? "u.name";
    const dir = opts.dir === "desc" ? "DESC" : "ASC";
    const total = await this.count(`SELECT COUNT(*) AS c FROM users u ${whereSql}`, params);
    const rows = await this.all(
      `SELECT u.*, d.name AS department_name FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       ${whereSql} ORDER BY ${orderBy} ${dir} LIMIT ? OFFSET ?`,
      [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
    );
    return {
      items: rows.map(toUser),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
    };
  }

  /** All students, unpaginated — used by the enrollment picker. */
  async listAllStudents(): Promise<PublicUser[]> {
    const rows = await this.all(
      `SELECT u.*, d.name AS department_name FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.role = 'student' AND u.deleted_at IS NULL ORDER BY u.name ASC`,
    );
    return rows.map(toUser);
  }

  async listLecturers(): Promise<PublicUser[]> {
    const rows = await this.all(
      `SELECT u.*, d.name AS department_name FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.role = 'lecturer' AND u.deleted_at IS NULL ORDER BY u.name ASC`,
    );
    return rows.map(toUser);
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
    const id = randomId(10);
    const now = Date.now();
    try {
      await this.run(
        `INSERT INTO users (id, email, password_hash, name, role, matric_no, staff_id, department_id, level, created_at, updated_at, token_version, failed_logins)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
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
          now,
          now,
        ],
      );
    } catch (error) {
      mapDbError(error, {
        email: "That email address is already registered.",
        matric_no: "That matriculation number is already registered.",
        staff_id: "That staff ID is already registered.",
      });
    }
    return id;
  }

  async updateUser(
    id: string,
    input: {
      name: string;
      email: string;
      matricNo?: string;
      staffId?: string;
      departmentId?: string;
      level?: string;
      password?: string;
    },
  ): Promise<void> {
    const existing = await this.first<{ id: string }>(
      "SELECT id FROM users WHERE id = ? AND deleted_at IS NULL",
      [id],
    );
    if (!existing) throw ApiError.notFound("That user no longer exists.");
    const sets = [
      "name = ?",
      "email = ?",
      "matric_no = ?",
      "staff_id = ?",
      "department_id = ?",
      "level = ?",
      "updated_at = ?",
    ];
    const params: unknown[] = [
      input.name,
      input.email,
      input.matricNo ?? null,
      input.staffId ?? null,
      input.departmentId ?? null,
      input.level ?? null,
      Date.now(),
    ];
    if (input.password) {
      // Changing a password revokes every existing session for that user.
      sets.push("password_hash = ?", "token_version = token_version + 1");
      params.push(await hashPassword(input.password));
    }
    params.push(id);
    try {
      await this.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
    } catch (error) {
      mapDbError(error, {
        email: "That email address is already registered.",
        matric_no: "That matriculation number is already registered.",
        staff_id: "That staff ID is already registered.",
      });
    }
  }

  async updateOwnProfile(id: string, input: { name: string; email: string }): Promise<void> {
    try {
      await this.run("UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?", [
        input.name,
        input.email,
        Date.now(),
        id,
      ]);
    } catch (error) {
      mapDbError(error, { email: "That email address is already registered." });
    }
  }

  async setPassword(id: string, hash: string): Promise<void> {
    await this.run(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?",
      [hash, Date.now(), id],
    );
  }

  async getPasswordHash(id: string): Promise<string | null> {
    const r = await this.first<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL",
      [id],
    );
    return r?.password_hash ?? null;
  }

  /**
   * Soft delete. Attendance history must survive the removal of a student for
   * the reports to stay truthful, so rows are retained and the account is
   * deactivated, anonymised in listings, and its sessions revoked.
   */
  async softDeleteUser(id: string): Promise<void> {
    const now = Date.now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE users SET deleted_at = ?, updated_at = ?, token_version = token_version + 1,
             email = 'deleted+' || id || '@invalid.local' WHERE id = ?`,
        )
        .bind(now, now, id),
      this.db.prepare("DELETE FROM course_enrollments WHERE student_id = ?").bind(id),
      this.db.prepare("UPDATE courses SET lecturer_id = NULL WHERE lecturer_id = ?").bind(id),
    ]);
  }

  async countAdmins(): Promise<number> {
    return this.count("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND deleted_at IS NULL");
  }

  // ── Departments ───────────────────────────────────────────────────────────

  async listDepartments(): Promise<Department[]> {
    const rows = await this.all(
      `SELECT d.*,
         (SELECT COUNT(*) FROM courses c WHERE c.department_id = d.id) AS course_count,
         (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role = 'student' AND u.deleted_at IS NULL) AS student_count
       FROM departments d ORDER BY d.name ASC`,
    );
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      code: r.code as string,
      icon: (r.icon as string) ?? undefined,
      color: (r.color as string) ?? undefined,
      courseCount: Number(r.course_count ?? 0),
      studentCount: Number(r.student_count ?? 0),
    }));
  }

  async createDepartment(input: {
    name: string;
    code: string;
    icon?: string | null;
    color?: string | null;
  }): Promise<string> {
    const id = randomId(8);
    const now = Date.now();
    try {
      await this.run(
        "INSERT INTO departments (id, name, code, icon, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, input.name, input.code, input.icon ?? null, input.color ?? null, now, now],
      );
    } catch (error) {
      mapDbError(error, { code: "A department with that code already exists." });
    }
    return id;
  }

  async updateDepartment(
    id: string,
    input: { name: string; code: string; icon?: string | null; color?: string | null },
  ): Promise<void> {
    try {
      await this.run(
        "UPDATE departments SET name = ?, code = ?, icon = ?, color = ?, updated_at = ? WHERE id = ?",
        [input.name, input.code, input.icon ?? null, input.color ?? null, Date.now(), id],
      );
    } catch (error) {
      mapDbError(error, { code: "A department with that code already exists." });
    }
  }

  /** Refuses to delete a department that still has courses or people attached. */
  async deleteDepartment(id: string): Promise<void> {
    const courses = await this.count("SELECT COUNT(*) AS c FROM courses WHERE department_id = ?", [
      id,
    ]);
    if (courses > 0) {
      throw ApiError.conflict(
        `This department still has ${courses} course${courses === 1 ? "" : "s"}. Move or delete them first.`,
      );
    }
    const people = await this.count(
      "SELECT COUNT(*) AS c FROM users WHERE department_id = ? AND deleted_at IS NULL",
      [id],
    );
    if (people > 0) {
      throw ApiError.conflict(
        `This department still has ${people} member${people === 1 ? "" : "s"}. Reassign them first.`,
      );
    }
    await this.run("DELETE FROM departments WHERE id = ?", [id]);
  }

  // ── Courses ───────────────────────────────────────────────────────────────

  async listCourses(): Promise<Course[]> {
    const rows = await this.all(`${COURSE_SELECT} ORDER BY c.code ASC`);
    return rows.map((r) => toCourse(r));
  }

  async getCourse(id: string, withEnrollments = false): Promise<Course | null> {
    const r = await this.first(`${COURSE_SELECT} WHERE c.id = ?`, [id]);
    if (!r) return null;
    let ids: string[] = [];
    if (withEnrollments) {
      const rows = await this.all<{ student_id: string }>(
        "SELECT student_id FROM course_enrollments WHERE course_id = ?",
        [id],
      );
      ids = rows.map((e) => e.student_id);
    }
    return toCourse(r, ids);
  }

  async createCourse(input: {
    code: string;
    title: string;
    departmentId: string;
    level: string;
    units: number;
    icon?: string | null;
    color?: string | null;
    category?: string | null;
    description?: string | null;
  }): Promise<string> {
    const dept = await this.first("SELECT id FROM departments WHERE id = ?", [input.departmentId]);
    if (!dept) throw ApiError.validation("Choose a valid department.", { departmentId: "Unknown department" });
    const id = randomId(8);
    const now = Date.now();
    try {
      await this.run(
        `INSERT INTO courses (id, code, title, department_id, level, units, lecturer_id, icon, color, category, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.code,
          input.title,
          input.departmentId,
          input.level,
          input.units,
          input.icon ?? null,
          input.color ?? null,
          input.category ?? null,
          input.description ?? null,
          now,
          now,
        ],
      );
    } catch (error) {
      mapDbError(error, { code: "A course with that code already exists." });
    }
    return id;
  }

  async updateCourse(
    id: string,
    input: Parameters<Repo["createCourse"]>[0],
  ): Promise<void> {
    const existing = await this.first("SELECT id FROM courses WHERE id = ?", [id]);
    if (!existing) throw ApiError.notFound("That course no longer exists.");
    try {
      await this.run(
        `UPDATE courses SET code = ?, title = ?, department_id = ?, level = ?, units = ?,
           icon = ?, color = ?, category = ?, description = ?, updated_at = ? WHERE id = ?`,
        [
          input.code,
          input.title,
          input.departmentId,
          input.level,
          input.units,
          input.icon ?? null,
          input.color ?? null,
          input.category ?? null,
          input.description ?? null,
          Date.now(),
          id,
        ],
      );
    } catch (error) {
      mapDbError(error, { code: "A course with that code already exists." });
    }
  }

  /**
   * Deleting a course removes its attendance history, so it is refused once
   * sessions exist — the course can be archived instead.
   */
  async deleteCourse(id: string): Promise<void> {
    const sessions = await this.count("SELECT COUNT(*) AS c FROM sessions WHERE course_id = ?", [id]);
    if (sessions > 0) {
      throw ApiError.conflict(
        "This course has attendance history and cannot be deleted. Archive it instead.",
      );
    }
    await this.db.batch([
      this.db.prepare("DELETE FROM course_enrollments WHERE course_id = ?").bind(id),
      this.db.prepare("DELETE FROM courses WHERE id = ?").bind(id),
    ]);
  }

  async setCourseArchived(id: string, archived: boolean): Promise<void> {
    await this.run("UPDATE courses SET archived_at = ?, updated_at = ? WHERE id = ?", [
      archived ? Date.now() : null,
      Date.now(),
      id,
    ]);
  }

  async assignLecturer(courseId: string, lecturerId: string | null): Promise<void> {
    if (lecturerId) {
      const lec = await this.first(
        "SELECT id FROM users WHERE id = ? AND role = 'lecturer' AND deleted_at IS NULL",
        [lecturerId],
      );
      if (!lec) throw ApiError.validation("Choose a valid lecturer.", { lecturerId: "Unknown lecturer" });
    }
    const res = await this.run("UPDATE courses SET lecturer_id = ?, updated_at = ? WHERE id = ?", [
      lecturerId,
      Date.now(),
      courseId,
    ]);
    if (!res.meta.changes) throw ApiError.notFound("That course no longer exists.");
  }

  /** Replaces the enrollment set atomically so a partial failure cannot strand it. */
  async setEnrollments(courseId: string, studentIds: string[]): Promise<void> {
    const course = await this.first("SELECT id FROM courses WHERE id = ?", [courseId]);
    if (!course) throw ApiError.notFound("That course no longer exists.");
    const unique = [...new Set(studentIds)];
    if (unique.length) {
      const placeholders = unique.map(() => "?").join(",");
      const valid = await this.count(
        `SELECT COUNT(*) AS c FROM users WHERE role = 'student' AND deleted_at IS NULL AND id IN (${placeholders})`,
        unique,
      );
      if (valid !== unique.length) {
        throw ApiError.validation("One or more selected students no longer exist.");
      }
    }
    const now = Date.now();
    const statements: D1PreparedStatement[] = [
      this.db.prepare("DELETE FROM course_enrollments WHERE course_id = ?").bind(courseId),
    ];
    // Chunked multi-row inserts keep the batch small even for large cohorts.
    for (let i = 0; i < unique.length; i += 50) {
      const chunk = unique.slice(i, i + 50);
      const values = chunk.map(() => "(?, ?, ?)").join(",");
      const params = chunk.flatMap((sid) => [courseId, sid, now]);
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO course_enrollments (course_id, student_id, created_at) VALUES ${values}`,
          )
          .bind(...params),
      );
    }
    await this.db.batch(statements);
  }

  async lecturerCourses(lecturerId: string): Promise<Course[]> {
    const rows = await this.all(`${COURSE_SELECT} WHERE c.lecturer_id = ? ORDER BY c.code ASC`, [
      lecturerId,
    ]);
    return rows.map((r) => toCourse(r));
  }

  async isEnrolled(courseId: string, studentId: string): Promise<boolean> {
    const r = await this.first(
      "SELECT 1 AS x FROM course_enrollments WHERE course_id = ? AND student_id = ?",
      [courseId, studentId],
    );
    return !!r;
  }

  /**
   * A student's courses with attendance percentages, computed in SQL so the
   * cost is independent of how many sessions and records exist. The previous
   * implementation loaded every session and every attendance record in the
   * entire database into memory on each request.
   */
  async studentCourses(studentId: string): Promise<StudentCourseView[]> {
    const rows = await this.all(
      `SELECT c.*, d.name AS department_name, u.name AS lecturer_name,
              (SELECT COUNT(*) FROM course_enrollments e WHERE e.course_id = c.id) AS enrolled_count,
              (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id) AS session_count,
              (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id) AS total_sessions,
              (SELECT COUNT(*) FROM attendance_records ar
                 WHERE ar.course_id = c.id AND ar.student_id = ?) AS attended_sessions
       FROM course_enrollments ce
       JOIN courses c ON c.id = ce.course_id
       LEFT JOIN departments d ON d.id = c.department_id
       LEFT JOIN users u ON u.id = c.lecturer_id AND u.deleted_at IS NULL
       WHERE ce.student_id = ?
       ORDER BY c.code ASC`,
      [studentId, studentId],
    );
    return rows.map((r) => {
      const total = Number(r.total_sessions ?? 0);
      const attended = Number(r.attended_sessions ?? 0);
      return {
        ...toCourse(r),
        totalSessions: total,
        attendedSessions: attended,
        percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
      };
    });
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async getSession(sessionId: string): Promise<AttendanceSession | null> {
    const r = await this.first(
      `SELECT s.*, c.code AS course_code, c.title AS course_title FROM sessions s
       JOIN courses c ON c.id = s.course_id WHERE s.id = ?`,
      [sessionId],
    );
    return r ? toSession(r) : null;
  }

  async findLiveSessionForCourse(courseId: string): Promise<AttendanceSession | null> {
    const r = await this.first(
      `SELECT s.*, c.code AS course_code, c.title AS course_title FROM sessions s
       JOIN courses c ON c.id = s.course_id
       WHERE s.course_id = ? AND s.ended_at IS NULL AND s.expires_at > ?
       ORDER BY s.started_at DESC LIMIT 1`,
      [courseId, Date.now()],
    );
    return r ? toSession(r) : null;
  }

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
    const expiresAt = now + input.durationMinutes * 60_000;

    // Codes must be unique among concurrently-live sessions, otherwise a code
    // could check a student into the wrong lecture. Retry on collision.
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateAttendanceCode();
      const clash = await this.first(
        "SELECT 1 AS x FROM sessions WHERE code = ? AND ended_at IS NULL AND expires_at > ?",
        [code, now],
      );
      if (clash) continue;
      const id = randomId(10);
      await this.run(
        `INSERT INTO sessions (id, course_id, lecturer_id, code, started_at, expires_at, ended_at, latitude, longitude, radius_meters, topic)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [
          id,
          input.courseId,
          input.lecturerId,
          code,
          now,
          expiresAt,
          input.latitude ?? null,
          input.longitude ?? null,
          input.radiusMeters ?? null,
          input.topic ?? null,
        ],
      );
      const created = await this.getSession(id);
      if (!created) throw new Error("Session insert did not persist");
      return created;
    }
    throw ApiError.conflict("Could not allocate an attendance code. Please try again.");
  }

  async endSession(sessionId: string): Promise<void> {
    await this.run("UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL", [
      Date.now(),
      sessionId,
    ]);
  }

  async extendSession(sessionId: string, minutes: number): Promise<AttendanceSession | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    const base = Math.max(Date.now(), session.expiresAt);
    await this.run("UPDATE sessions SET expires_at = ? WHERE id = ?", [
      base + minutes * 60_000,
      sessionId,
    ]);
    return this.getSession(sessionId);
  }

  async listSessionsForCourse(courseId: string, limit = 200): Promise<AttendanceSession[]> {
    const rows = await this.all(
      `SELECT s.*, c.code AS course_code, c.title AS course_title,
              (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id) AS attended_count,
              (SELECT COUNT(*) FROM course_enrollments e WHERE e.course_id = s.course_id) AS enrolled_count
       FROM sessions s JOIN courses c ON c.id = s.course_id
       WHERE s.course_id = ? ORDER BY s.started_at DESC LIMIT ?`,
      [courseId, limit],
    );
    return rows.map(toSession);
  }

  async listSessionsForLecturer(lecturerId: string, limit = 100): Promise<AttendanceSession[]> {
    const rows = await this.all(
      `SELECT s.*, c.code AS course_code, c.title AS course_title,
              (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id) AS attended_count,
              (SELECT COUNT(*) FROM course_enrollments e WHERE e.course_id = s.course_id) AS enrolled_count
       FROM sessions s JOIN courses c ON c.id = s.course_id
       WHERE s.lecturer_id = ? ORDER BY s.started_at DESC LIMIT ?`,
      [lecturerId, limit],
    );
    return rows.map(toSession);
  }

  async sessionDetail(sessionId: string): Promise<SessionDetail | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    const course = await this.getCourse(session.courseId);
    if (!course) return null;
    const present = await this.all(
      `SELECT ar.id, ar.student_id, ar.timestamp, ar.method, u.name, u.matric_no
       FROM attendance_records ar JOIN users u ON u.id = ar.student_id
       WHERE ar.session_id = ? ORDER BY ar.timestamp ASC`,
      [sessionId],
    );
    const absent = await this.all(
      `SELECT u.id, u.name, u.matric_no FROM course_enrollments ce
       JOIN users u ON u.id = ce.student_id AND u.deleted_at IS NULL
       WHERE ce.course_id = ?
         AND u.id NOT IN (SELECT student_id FROM attendance_records WHERE session_id = ?)
       ORDER BY u.name ASC`,
      [session.courseId, sessionId],
    );
    return {
      session: {
        ...session,
        attendedCount: present.length,
        enrolledCount: course.enrolledCount,
      },
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        level: course.level,
        units: course.units,
      },
      totalEnrolled: course.enrolledCount,
      attendance: present.map((r) => ({
        id: r.id as string,
        studentId: r.student_id as string,
        name: (r.name as string) ?? "Unknown",
        matricNo: (r.matric_no as string) ?? "—",
        timestamp: Number(r.timestamp),
        method: (r.method as string) ?? "code",
      })),
      absentees: absent.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        matricNo: (r.matric_no as string) ?? "—",
      })),
    };
  }

  // ── Attendance ────────────────────────────────────────────────────────────

  async submitAttendance(input: {
    code: string;
    studentId: string;
    latitude?: number;
    longitude?: number;
    method?: string;
    recordedBy?: string;
  }): Promise<{ course: { code: string; title: string }; timestamp: number; sessionId: string }> {
    const now = Date.now();
    const row = await this.first(
      `SELECT s.*, c.code AS course_code, c.title AS course_title FROM sessions s
       JOIN courses c ON c.id = s.course_id
       WHERE s.code = ? AND s.ended_at IS NULL AND s.expires_at > ? LIMIT 1`,
      [input.code, now],
    );
    if (!row) throw ApiError.notFound("That code is invalid or has expired.");
    const session = toSession(row);

    if (!(await this.isEnrolled(session.courseId, input.studentId))) {
      throw ApiError.forbidden("You are not enrolled in this course.");
    }

    if (session.latitude != null && session.longitude != null && session.radiusMeters != null) {
      if (input.latitude == null || input.longitude == null) {
        throw ApiError.validation(
          "This lecture requires location sharing. Enable it and try again.",
        );
      }
      const distance = haversineMeters(
        { lat: session.latitude, lng: session.longitude },
        { lat: input.latitude, lng: input.longitude },
      );
      if (distance > session.radiusMeters) {
        throw ApiError.forbidden(
          `You appear to be ${Math.round(distance)}m from the venue (limit ${session.radiusMeters}m).`,
        );
      }
    }

    // Duplicate prevention relies on the UNIQUE(session_id, student_id) index
    // rather than a read-then-write check, which races under double submission.
    try {
      await this.run(
        `INSERT INTO attendance_records (id, session_id, student_id, course_id, timestamp, latitude, longitude, method, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomId(10),
          session.id,
          input.studentId,
          session.courseId,
          now,
          input.latitude ?? null,
          input.longitude ?? null,
          input.method ?? "code",
          input.recordedBy ?? null,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed/i.test(message)) {
        throw ApiError.conflict("You have already signed in to this lecture.");
      }
      throw error;
    }

    return {
      course: { code: row.course_code as string, title: row.course_title as string },
      timestamp: now,
      sessionId: session.id,
    };
  }

  /** Lecturer override: mark an enrolled student present for their own session. */
  async markAttendance(
    sessionId: string,
    studentId: string,
    recordedBy: string,
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw ApiError.notFound("That session no longer exists.");
    if (!(await this.isEnrolled(session.courseId, studentId))) {
      throw ApiError.validation("That student is not enrolled in this course.");
    }
    try {
      await this.run(
        `INSERT INTO attendance_records (id, session_id, student_id, course_id, timestamp, method, recorded_by)
         VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
        [randomId(10), sessionId, studentId, session.courseId, Date.now(), recordedBy],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed/i.test(message)) {
        throw ApiError.conflict("That student is already marked present.");
      }
      throw error;
    }
  }

  async getAttendanceRecord(recordId: string) {
    return this.first<{ id: string; session_id: string; student_id: string; course_id: string }>(
      "SELECT id, session_id, student_id, course_id FROM attendance_records WHERE id = ?",
      [recordId],
    );
  }

  async deleteAttendanceRecord(recordId: string): Promise<void> {
    const res = await this.run("DELETE FROM attendance_records WHERE id = ?", [recordId]);
    if (!res.meta.changes) throw ApiError.notFound("That attendance record no longer exists.");
  }

  async studentHistory(studentId: string, opts: Pagination) {
    const where = ["ar.student_id = ?"];
    const params: unknown[] = [studentId];
    if (opts.search) {
      where.push("(c.code LIKE ? OR c.title LIKE ?)");
      params.push(`%${opts.search}%`, `%${opts.search}%`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const total = await this.count(
      `SELECT COUNT(*) AS c FROM attendance_records ar JOIN courses c ON c.id = ar.course_id ${whereSql}`,
      params,
    );
    const rows = await this.all(
      `SELECT ar.id, ar.timestamp, ar.method, ar.session_id, c.id AS course_id, c.code AS course_code, c.title AS course_title,
              s.topic
       FROM attendance_records ar
       JOIN courses c ON c.id = ar.course_id
       LEFT JOIN sessions s ON s.id = ar.session_id
       ${whereSql} ORDER BY ar.timestamp ${opts.dir === "asc" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`,
      [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
    );
    return {
      items: rows.map((r) => ({
        id: r.id as string,
        timestamp: Number(r.timestamp),
        method: (r.method as string) ?? "code",
        sessionId: r.session_id as string,
        courseId: r.course_id as string,
        courseCode: r.course_code as string,
        courseTitle: r.course_title as string,
        topic: (r.topic as string) ?? undefined,
      })),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
    };
  }

  /** Per-session attendance for one student in one course. */
  async studentCourseSessions(studentId: string, courseId: string) {
    const rows = await this.all(
      `SELECT s.id, s.started_at, s.ended_at, s.expires_at, s.topic,
              ar.timestamp AS attended_at
       FROM sessions s
       LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.student_id = ?
       WHERE s.course_id = ? ORDER BY s.started_at DESC`,
      [studentId, courseId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      startedAt: Number(r.started_at),
      endedAt: r.ended_at == null ? undefined : Number(r.ended_at),
      expiresAt: Number(r.expires_at),
      topic: (r.topic as string) ?? undefined,
      attended: r.attended_at != null,
      timestamp: r.attended_at == null ? undefined : Number(r.attended_at),
    }));
  }

  async listOpenSessionsForStudent(studentId: string) {
    const rows = await this.all(
      `SELECT s.id AS session_id, s.course_id, s.expires_at, s.topic,
              c.code AS course_code, c.title AS course_title,
              (SELECT COUNT(*) FROM attendance_records ar
                WHERE ar.session_id = s.id AND ar.student_id = ?) AS already
       FROM sessions s
       JOIN course_enrollments ce ON ce.course_id = s.course_id AND ce.student_id = ?
       JOIN courses c ON c.id = s.course_id
       WHERE s.ended_at IS NULL AND s.expires_at > ?
       ORDER BY s.expires_at ASC`,
      [studentId, studentId, Date.now()],
    );
    // The attendance code itself is intentionally NOT returned: it must be read
    // from the lecturer's screen, otherwise a student could sign in remotely.
    return rows.map((r) => ({
      sessionId: r.session_id as string,
      courseId: r.course_id as string,
      courseCode: r.course_code as string,
      courseTitle: r.course_title as string,
      topic: (r.topic as string) ?? undefined,
      expiresAt: Number(r.expires_at),
      alreadySignedIn: Number(r.already ?? 0) > 0,
    }));
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  async courseReport(courseId: string): Promise<CourseReport | null> {
    const course = await this.getCourse(courseId);
    if (!course) return null;
    const sessions = await this.listSessionsForCourse(courseId);
    const total = sessions.length;
    const rows = await this.all(
      `SELECT u.id, u.name, u.matric_no,
              (SELECT COUNT(*) FROM attendance_records ar
                 WHERE ar.course_id = ? AND ar.student_id = u.id) AS attended
       FROM course_enrollments ce JOIN users u ON u.id = ce.student_id AND u.deleted_at IS NULL
       WHERE ce.course_id = ? ORDER BY u.name ASC`,
      [courseId, courseId],
    );
    const students = rows
      .map((r) => {
        const attended = Number(r.attended ?? 0);
        return {
          id: r.id as string,
          name: r.name as string,
          matricNo: (r.matric_no as string) ?? "—",
          attended,
          percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
        };
      })
      .sort((a, b) => b.percentage - a.percentage || a.name.localeCompare(b.name));
    return {
      course: {
        id: course.id,
        code: course.code,
        title: course.title,
        level: course.level,
        units: course.units,
      },
      totalSessions: total,
      sessions,
      students,
    };
  }

  async facultyReport(): Promise<FacultyReport> {
    const courseRows = await this.all(
      `SELECT c.id, c.code, c.title,
              (SELECT COUNT(*) FROM course_enrollments e WHERE e.course_id = c.id) AS enrolled,
              (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id) AS sessions,
              (SELECT COUNT(*) FROM attendance_records ar WHERE ar.course_id = c.id) AS attended
       FROM courses c ORDER BY c.code ASC`,
    );
    const courses = courseRows.map((r) => {
      const enrolled = Number(r.enrolled ?? 0);
      const sessions = Number(r.sessions ?? 0);
      const attended = Number(r.attended ?? 0);
      const denom = sessions * enrolled;
      return {
        id: r.id as string,
        code: r.code as string,
        title: r.title as string,
        enrolled,
        sessions,
        avg: denom === 0 ? 0 : Math.round((attended / denom) * 100),
      };
    });

    // Single aggregate query rather than N+1 lookups per student.
    const studentRows = await this.all(
      `SELECT u.id, u.name, u.matric_no,
              COUNT(DISTINCT ce.course_id) AS course_count,
              IFNULL(SUM((SELECT COUNT(*) FROM sessions s WHERE s.course_id = ce.course_id)), 0) AS total,
              IFNULL(SUM((SELECT COUNT(*) FROM attendance_records ar
                            WHERE ar.course_id = ce.course_id AND ar.student_id = u.id)), 0) AS attended
       FROM course_enrollments ce
       JOIN users u ON u.id = ce.student_id AND u.deleted_at IS NULL
       GROUP BY u.id ORDER BY u.name ASC`,
    );
    const students = studentRows
      .map((r) => {
        const total = Number(r.total ?? 0);
        const attended = Number(r.attended ?? 0);
        return {
          id: r.id as string,
          name: r.name as string,
          matricNo: (r.matric_no as string) ?? "—",
          courses: Number(r.course_count ?? 0),
          attended,
          total,
          percentage: total === 0 ? 0 : Math.round((attended / total) * 100),
        };
      })
      .sort((a, b) => b.percentage - a.percentage || a.name.localeCompare(b.name));

    return { courses, students };
  }

  async adminOverview(): Promise<AdminOverview> {
    const now = Date.now();
    const weekStart = now - 7 * 24 * 60 * 60 * 1000;
    const counts = await this.first<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role='student' AND deleted_at IS NULL) AS students,
         (SELECT COUNT(*) FROM users WHERE role='lecturer' AND deleted_at IS NULL) AS lecturers,
         (SELECT COUNT(*) FROM courses) AS courses,
         (SELECT COUNT(*) FROM departments) AS departments,
         (SELECT COUNT(*) FROM sessions) AS sessions,
         (SELECT COUNT(*) FROM attendance_records) AS attendance,
         (SELECT COUNT(*) FROM sessions WHERE ended_at IS NULL AND expires_at > ?) AS live`,
      [now],
    );

    const recent = await this.all(
      `SELECT s.id, s.started_at, s.ended_at, c.code AS course_code,
              (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id) AS attended,
              (SELECT COUNT(*) FROM course_enrollments e WHERE e.course_id = s.course_id) AS enrolled
       FROM sessions s JOIN courses c ON c.id = s.course_id
       ORDER BY s.started_at DESC LIMIT 8`,
    );

    // Bucket the last 7 calendar days in SQL; the old code scanned every record
    // in JS and used overlapping ±12h windows that double-counted attendance.
    const buckets = await this.all<{ day: string; count: number }>(
      `SELECT strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch') AS day, COUNT(*) AS count
       FROM attendance_records WHERE timestamp >= ?
       GROUP BY day`,
      [weekStart],
    );
    const byDay = new Map(buckets.map((b) => [b.day, Number(b.count)]));
    const weeklyAttendance: Array<{ label: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      weeklyAttendance.push({
        label: d.toLocaleDateString("en", { weekday: "short" }),
        count: byDay.get(key) ?? 0,
      });
    }

    return {
      counts: {
        students: Number(counts?.students ?? 0),
        lecturers: Number(counts?.lecturers ?? 0),
        courses: Number(counts?.courses ?? 0),
        departments: Number(counts?.departments ?? 0),
        sessions: Number(counts?.sessions ?? 0),
        attendance: Number(counts?.attendance ?? 0),
        liveSessions: Number(counts?.live ?? 0),
      },
      recentSessions: recent.map((r) => ({
        id: r.id as string,
        courseCode: (r.course_code as string) ?? "—",
        startedAt: Number(r.started_at),
        endedAt: r.ended_at == null ? undefined : Number(r.ended_at),
        attended: Number(r.attended ?? 0),
        enrolled: Number(r.enrolled ?? 0),
      })),
      weeklyAttendance,
    };
  }

  async lecturerOverview(lecturerId: string) {
    const counts = await this.first<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*) FROM courses WHERE lecturer_id = ?1) AS courses,
         (SELECT COUNT(*) FROM sessions WHERE lecturer_id = ?1) AS sessions,
         (SELECT COUNT(*) FROM sessions WHERE lecturer_id = ?1 AND ended_at IS NULL AND expires_at > ?2) AS live,
         (SELECT COUNT(*) FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id WHERE c.lecturer_id = ?1) AS enrollments,
         (SELECT COUNT(*) FROM attendance_records ar JOIN sessions s ON s.id = ar.session_id WHERE s.lecturer_id = ?1) AS attendance`,
      [lecturerId, Date.now()],
    );
    return {
      courses: Number(counts?.courses ?? 0),
      sessions: Number(counts?.sessions ?? 0),
      liveSessions: Number(counts?.live ?? 0),
      enrollments: Number(counts?.enrollments ?? 0),
      attendance: Number(counts?.attendance ?? 0),
    };
  }

  // ── Site settings ─────────────────────────────────────────────────────────

  async getSiteSettings(): Promise<SiteSettings> {
    const r = await this.first("SELECT * FROM site_settings WHERE id = 'site'");
    if (!r) return defaultSiteSettings();
    return {
      id: "site",
      institutionName: (r.institution_name as string) ?? "SLAMS",
      atRiskThreshold: Number(r.at_risk_threshold ?? 70),
      marqueeItems: safeJsonArray<string>(r.marquee_items, []),
      testimonials: safeJsonArray(r.testimonials, []),
      demoAccountsEnabled: !!r.demo_accounts_enabled,
      demoEmailDomain: (r.demo_email_domain as string) ?? "slams.edu",
      showFakeStats: !!r.show_fake_stats,
      primaryColor: (r.primary_color as string) ?? null,
      contactEmail: (r.contact_email as string) ?? null,
    };
  }

  async saveSiteSettings(partial: Partial<SiteSettings>): Promise<SiteSettings> {
    const current = await this.getSiteSettings();
    const next: SiteSettings = { ...current, ...partial, id: "site" };
    await this.run(
      `INSERT INTO site_settings (id, institution_name, at_risk_threshold, marquee_items, testimonials,
         demo_accounts_enabled, demo_password, demo_email_domain, show_fake_stats, primary_color, contact_email)
       VALUES ('site', ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         institution_name = excluded.institution_name,
         at_risk_threshold = excluded.at_risk_threshold,
         marquee_items = excluded.marquee_items,
         testimonials = excluded.testimonials,
         demo_accounts_enabled = excluded.demo_accounts_enabled,
         demo_email_domain = excluded.demo_email_domain,
         show_fake_stats = excluded.show_fake_stats,
         primary_color = excluded.primary_color,
         contact_email = excluded.contact_email`,
      [
        next.institutionName,
        next.atRiskThreshold,
        JSON.stringify(next.marqueeItems),
        JSON.stringify(next.testimonials),
        next.demoAccountsEnabled ? 1 : 0,
        next.demoEmailDomain,
        next.showFakeStats ? 1 : 0,
        next.primaryColor ?? null,
        next.contactEmail || null,
      ],
    );
    return next;
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  async listAudit(opts: Pagination & { action?: string; actorId?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.action) {
      where.push("a.action = ?");
      params.push(opts.action);
    }
    if (opts.actorId) {
      where.push("a.actor_id = ?");
      params.push(opts.actorId);
    }
    if (opts.search) {
      where.push("(a.action LIKE ? OR a.resource LIKE ? OR IFNULL(u.name,'') LIKE ?)");
      const like = `%${opts.search}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = await this.count(
      `SELECT COUNT(*) AS c FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ${whereSql}`,
      params,
    );
    const rows = await this.all(
      `SELECT a.*, u.name AS actor_name FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       ${whereSql} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
    );
    return {
      items: rows.map((r) => ({
        id: r.id as string,
        actorId: (r.actor_id as string) ?? undefined,
        actorRole: (r.actor_role as string) ?? undefined,
        actorName: (r.actor_name as string) ?? undefined,
        action: r.action as string,
        resource: r.resource as string,
        resourceId: (r.resource_id as string) ?? undefined,
        metadata: r.metadata ? (JSON.parse(r.metadata as string) as Record<string, unknown>) : undefined,
        createdAt: Number(r.created_at),
      })),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
    };
  }

  // ── Maintenance (cron) ────────────────────────────────────────────────────

  /** Closes sessions whose window elapsed but which were never ended. */
  async closeExpiredSessions(): Promise<number> {
    const res = await this.run(
      "UPDATE sessions SET ended_at = expires_at WHERE ended_at IS NULL AND expires_at < ?",
      [Date.now()],
    );
    return Number(res.meta.changes ?? 0);
  }

  /** Trims audit entries beyond the retention window. */
  async pruneAudit(retentionDays: number): Promise<number> {
    const res = await this.run("DELETE FROM audit_log WHERE created_at < ?", [
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    ]);
    return Number(res.meta.changes ?? 0);
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
    ],
    testimonials: [],
    demoAccountsEnabled: false,
    demoEmailDomain: "slams.edu",
    showFakeStats: false,
    primaryColor: null,
    contactEmail: null,
  };
}
