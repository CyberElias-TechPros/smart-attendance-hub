// SLAMS API — every server function lives here (createServerFn).
// Handler bodies use dynamic imports of *.server.ts modules for auth/db —
// this keeps server-only code out of the client bundle even though *.functions.ts
// module scope is client-reachable.

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";

type Role = "admin" | "lecturer" | "student";

async function currentSession() {
  const { verifySession, SESSION_COOKIE, parseCookie } = await import("./auth.server");
  const cookie = getRequestHeader("cookie") || null;
  const token = parseCookie(cookie, SESSION_COOKIE);
  if (!token) return null;
  return await verifySession(token);
}

async function requireUser(roles?: Role[]) {
  const sess = await currentSession();
  if (!sess) throw new Error("UNAUTHENTICATED");
  if (roles && !roles.includes(sess.role)) throw new Error("FORBIDDEN");
  return sess;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────

export const login = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; password: string }) =>
    z.object({ email: z.string().email(), password: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { ensureSeeded, db } = await import("./db.server");
    const { verifyPassword, signSession, buildSessionCookie } = await import("./auth.server");
    await ensureSeeded();
    const user = [...db().users.values()].find(
      (u) => u.email.toLowerCase() === data.email.toLowerCase(),
    );
    if (!user) throw new Error("Invalid email or password");
    const ok = await verifyPassword(data.password, user.passwordHash);
    if (!ok) throw new Error("Invalid email or password");
    const token = await signSession({ sub: user.id, role: user.role, name: user.name });
    setResponseHeader("set-cookie", buildSessionCookie(token));
    return { id: user.id, name: user.name, role: user.role, email: user.email };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { buildClearCookie } = await import("./auth.server");
  setResponseHeader("set-cookie", buildClearCookie());
  return { ok: true };
});

export const me = createServerFn({ method: "GET" }).handler(async () => {
  const { ensureSeeded, db } = await import("./db.server");
  await ensureSeeded();
  const sess = await currentSession();
  if (!sess) return null;
  const u = db().users.get(sess.sub);
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  void passwordHash;
  return rest;
});

// ─── ADMIN: users ────────────────────────────────────────────────────────

export const listUsers = createServerFn({ method: "GET" })
  .inputValidator((d: { role?: Role } | undefined) =>
    z.object({ role: z.enum(["admin", "lecturer", "student"]).optional() }).optional().parse(d) ?? {},
  )
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { db } = await import("./db.server");
    return [...db().users.values()]
      .filter((u) => (data?.role ? u.role === data.role : true))
      .map(({ passwordHash: _p, ...u }) => u)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

const createStudentSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  matricNo: z.string().min(2).max(40),
  departmentId: z.string().min(1),
  level: z.string().min(1),
  password: z.string().min(6),
});
export const createStudent = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof createStudentSchema>) => createStudentSchema.parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { db } = await import("./db.server");
    const { hashPassword } = await import("./auth.server");
    if ([...db().users.values()].some((u) => u.email.toLowerCase() === data.email.toLowerCase()))
      throw new Error("Email already in use");
    const { nanoid } = await import("nanoid");
    const u = {
      id: nanoid(10),
      email: data.email,
      passwordHash: await hashPassword(data.password),
      name: data.name,
      role: "student" as const,
      matricNo: data.matricNo,
      departmentId: data.departmentId,
      level: data.level,
      createdAt: Date.now(),
    };
    db().users.set(u.id, u);
    return { id: u.id };
  });

const createLecturerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  staffId: z.string().min(2).max(40),
  departmentId: z.string().min(1),
  password: z.string().min(6),
});
export const createLecturer = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof createLecturerSchema>) => createLecturerSchema.parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { db } = await import("./db.server");
    const { hashPassword } = await import("./auth.server");
    if ([...db().users.values()].some((u) => u.email.toLowerCase() === data.email.toLowerCase()))
      throw new Error("Email already in use");
    const { nanoid } = await import("nanoid");
    const u = {
      id: nanoid(10),
      email: data.email,
      passwordHash: await hashPassword(data.password),
      name: data.name,
      role: "lecturer" as const,
      staffId: data.staffId,
      departmentId: data.departmentId,
      createdAt: Date.now(),
    };
    db().users.set(u.id, u);
    return { id: u.id };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { db } = await import("./db.server");
    db().users.delete(data.id);
    // remove from course enrollments
    for (const c of db().courses.values()) {
      c.enrolledStudentIds = c.enrolledStudentIds.filter((s) => s !== data.id);
      if (c.lecturerId === data.id) c.lecturerId = undefined;
    }
    return { ok: true };
  });

// ─── DEPARTMENTS ──────────────────────────────────────────────────────────

export const listDepartments = createServerFn({ method: "GET" }).handler(async () => {
  const { ensureSeeded, db } = await import("./db.server");
  await ensureSeeded();
  return [...db().departments.values()].sort((a, b) => a.name.localeCompare(b.name));
});

export const createDepartment = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string; code: string }) =>
    z.object({ name: z.string().min(2), code: z.string().min(2).max(10) }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { db } = await import("./db.server");
    const { nanoid } = await import("nanoid");
    const dept = { id: nanoid(8), name: data.name, code: data.code.toUpperCase() };
    db().departments.set(dept.id, dept);
    return dept;
  });

export const deleteDepartment = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { db } = await import("./db.server");
    db().departments.delete(data.id);
    return { ok: true };
  });

// ─── COURSES ──────────────────────────────────────────────────────────────

export const listCourses = createServerFn({ method: "GET" }).handler(async () => {
  const { ensureSeeded, db } = await import("./db.server");
  await ensureSeeded();
  return [...db().courses.values()].sort((a, b) => a.code.localeCompare(b.code));
});

const createCourseSchema = z.object({
  code: z.string().min(2),
  title: z.string().min(2),
  departmentId: z.string().min(1),
  level: z.string().min(1),
  units: z.number().min(1).max(12),
});
export const createCourse = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof createCourseSchema>) => createCourseSchema.parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { db } = await import("./db.server");
    const { nanoid } = await import("nanoid");
    const c = {
      id: nanoid(8),
      code: data.code.toUpperCase(),
      title: data.title,
      departmentId: data.departmentId,
      level: data.level,
      units: data.units,
      enrolledStudentIds: [] as string[],
    };
    db().courses.set(c.id, c);
    return c;
  });

export const assignLecturer = createServerFn({ method: "POST" })
  .inputValidator((d: { courseId: string; lecturerId: string | null }) =>
    z.object({ courseId: z.string(), lecturerId: z.string().nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { db } = await import("./db.server");
    const c = db().courses.get(data.courseId);
    if (!c) throw new Error("Course not found");
    c.lecturerId = data.lecturerId ?? undefined;
    return { ok: true };
  });

export const enrollStudents = createServerFn({ method: "POST" })
  .inputValidator((d: { courseId: string; studentIds: string[] }) =>
    z.object({ courseId: z.string(), studentIds: z.array(z.string()) }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { db } = await import("./db.server");
    const c = db().courses.get(data.courseId);
    if (!c) throw new Error("Course not found");
    c.enrolledStudentIds = Array.from(new Set(data.studentIds));
    return { ok: true };
  });

export const deleteCourse = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { db } = await import("./db.server");
    db().courses.delete(data.id);
    return { ok: true };
  });

// ─── LECTURER ─────────────────────────────────────────────────────────────

export const lecturerCourses = createServerFn({ method: "GET" }).handler(async () => {
  const sess = await requireUser(["lecturer"]);
  const { db } = await import("./db.server");
  return [...db().courses.values()].filter((c) => c.lecturerId === sess.sub);
});

const startSessionSchema = z.object({
  courseId: z.string(),
  durationMinutes: z.number().min(1).max(240).default(15),
  topic: z.string().max(160).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  radiusMeters: z.number().min(10).max(5000).optional(),
});
export const startSession = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof startSessionSchema>) => startSessionSchema.parse(d))
  .handler(async ({ data }) => {
    const sess = await requireUser(["lecturer"]);
    const { db, generateCode } = await import("./db.server");
    const c = db().courses.get(data.courseId);
    if (!c) throw new Error("Course not found");
    if (c.lecturerId !== sess.sub) throw new Error("Not your course");
    const { nanoid } = await import("nanoid");
    const now = Date.now();
    const s = {
      id: nanoid(10),
      courseId: c.id,
      lecturerId: sess.sub,
      code: generateCode(),
      startedAt: now,
      expiresAt: now + data.durationMinutes * 60 * 1000,
      topic: data.topic,
      latitude: data.latitude,
      longitude: data.longitude,
      radiusMeters: data.radiusMeters,
    };
    db().sessions.set(s.id, s);
    return s;
  });

export const endSession = createServerFn({ method: "POST" })
  .inputValidator((d: { sessionId: string }) => z.object({ sessionId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const sess = await requireUser(["lecturer"]);
    const { db } = await import("./db.server");
    const s = db().sessions.get(data.sessionId);
    if (!s) throw new Error("Session not found");
    if (s.lecturerId !== sess.sub) throw new Error("Not your session");
    s.endedAt = Date.now();
    return { ok: true };
  });

export const sessionDetail = createServerFn({ method: "GET" })
  .inputValidator((d: { sessionId: string }) => z.object({ sessionId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const sess = await requireUser(["lecturer", "admin"]);
    void sess;
    const { db } = await import("./db.server");
    const s = db().sessions.get(data.sessionId);
    if (!s) throw new Error("Session not found");
    const course = db().courses.get(s.courseId)!;
    const attended = db().records.filter((r) => r.sessionId === s.id);
    const studentMap = db().users;
    return {
      session: s,
      course,
      totalEnrolled: course.enrolledStudentIds.length,
      attendance: attended
        .map((r) => {
          const st = studentMap.get(r.studentId);
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
  });

export const lecturerSessionsFor = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => z.object({ courseId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const sess = await requireUser(["lecturer", "admin"]);
    void sess;
    const { db } = await import("./db.server");
    return [...db().sessions.values()]
      .filter((s) => s.courseId === data.courseId)
      .sort((a, b) => b.startedAt - a.startedAt);
  });

// ─── STUDENT ─────────────────────────────────────────────────────────────

export const studentCourses = createServerFn({ method: "GET" }).handler(async () => {
  const sess = await requireUser(["student"]);
  const { db } = await import("./db.server");
  const courses = [...db().courses.values()].filter((c) =>
    c.enrolledStudentIds.includes(sess.sub),
  );
  return courses.map((c) => {
    const lecturer = c.lecturerId ? db().users.get(c.lecturerId) : undefined;
    const sessions = [...db().sessions.values()].filter((s) => s.courseId === c.id);
    const total = sessions.length;
    const attended = db().records.filter(
      (r) => r.courseId === c.id && r.studentId === sess.sub,
    ).length;
    const percentage = total === 0 ? 0 : Math.round((attended / total) * 100);
    return {
      ...c,
      lecturerName: lecturer?.name ?? "Unassigned",
      totalSessions: total,
      attendedSessions: attended,
      percentage,
    };
  });
});

export const submitAttendance = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string; latitude?: number; longitude?: number }) =>
    z
      .object({
        code: z.string().min(4).max(10),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const sess = await requireUser(["student"]);
    const { db, haversineMeters } = await import("./db.server");
    const now = Date.now();
    const s = [...db().sessions.values()].find(
      (x) => x.code === data.code && !x.endedAt && x.expiresAt > now,
    );
    if (!s) throw new Error("Invalid or expired attendance code");
    const course = db().courses.get(s.courseId);
    if (!course) throw new Error("Course not found");
    if (!course.enrolledStudentIds.includes(sess.sub))
      throw new Error("You are not enrolled in this course");
    if (
      db().records.find((r) => r.sessionId === s.id && r.studentId === sess.sub)
    )
      throw new Error("Attendance already submitted for this session");
    if (
      s.latitude != null &&
      s.longitude != null &&
      s.radiusMeters != null
    ) {
      if (data.latitude == null || data.longitude == null)
        throw new Error("Location required for this session");
      const dist = haversineMeters(
        { lat: s.latitude, lng: s.longitude },
        { lat: data.latitude, lng: data.longitude },
      );
      if (dist > s.radiusMeters)
        throw new Error(
          `You are ${Math.round(dist)}m from the venue (max ${s.radiusMeters}m)`,
        );
    }
    const { nanoid } = await import("nanoid");
    const rec = {
      id: nanoid(10),
      sessionId: s.id,
      studentId: sess.sub,
      courseId: s.courseId,
      timestamp: now,
      latitude: data.latitude,
      longitude: data.longitude,
    };
    db().records.push(rec);
    return {
      ok: true,
      course: { code: course.code, title: course.title },
      timestamp: now,
    };
  });

export const studentHistory = createServerFn({ method: "GET" }).handler(async () => {
  const sess = await requireUser(["student"]);
  const { db } = await import("./db.server");
  const records = db()
    .records.filter((r) => r.studentId === sess.sub)
    .sort((a, b) => b.timestamp - a.timestamp);
  return records.map((r) => {
    const c = db().courses.get(r.courseId);
    return {
      id: r.id,
      timestamp: r.timestamp,
      courseCode: c?.code ?? "—",
      courseTitle: c?.title ?? "—",
    };
  });
});

// ─── REPORTS / ANALYTICS ─────────────────────────────────────────────────

export const courseReport = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => z.object({ courseId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin", "lecturer"]);
    const { db } = await import("./db.server");
    const c = db().courses.get(data.courseId);
    if (!c) throw new Error("Course not found");
    const sessions = [...db().sessions.values()].filter((s) => s.courseId === c.id);
    const total = sessions.length;
    const students = c.enrolledStudentIds.map((sid) => {
      const s = db().users.get(sid);
      const attended = db().records.filter((r) => r.courseId === c.id && r.studentId === sid).length;
      const pct = total === 0 ? 0 : Math.round((attended / total) * 100);
      return {
        id: sid,
        name: s?.name ?? "Unknown",
        matricNo: s?.matricNo ?? "—",
        attended,
        percentage: pct,
      };
    });
    return {
      course: { id: c.id, code: c.code, title: c.title, level: c.level, units: c.units },
      totalSessions: total,
      sessions: sessions.sort((a, b) => a.startedAt - b.startedAt),
      students: students.sort((a, b) => b.percentage - a.percentage),
    };
  });

export const adminOverview = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser(["admin"]);
  const { db } = await import("./db.server");
  const users = [...db().users.values()];
  const courses = [...db().courses.values()];
  const sessions = [...db().sessions.values()];
  const records = db().records;
  return {
    counts: {
      students: users.filter((u) => u.role === "student").length,
      lecturers: users.filter((u) => u.role === "lecturer").length,
      courses: courses.length,
      departments: db().departments.size,
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
    weeklyAttendance: (() => {
      const day = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const buckets: { label: string; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const start = now - i * day;
        const d = new Date(start);
        const label = d.toLocaleDateString("en", { weekday: "short" });
        const count = records.filter(
          (r) => r.timestamp >= start - day / 2 && r.timestamp <= start + day / 2,
        ).length;
        buckets.push({ label, count });
      }
      return buckets;
    })(),
  };
});
