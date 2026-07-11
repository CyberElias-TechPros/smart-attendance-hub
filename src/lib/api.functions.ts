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
    const { getRepo } = await import("./db.server");
    const { signSession, buildSessionCookie } = await import("./auth.server");
    const repo = await getRepo();
    const user = await repo.verifyCredentials(data.email, data.password);
    if (!user) throw new Error("Invalid email or password");
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
  const { getRepo } = await import("./db.server");
  const repo = await getRepo();
  const sess = await currentSession();
  if (!sess) return null;
  const u = await repo.getUser(sess.sub);
  if (!u) return null;
  return u;
});

// ─── ADMIN: users ────────────────────────────────────────────────────────

export const listUsers = createServerFn({ method: "GET" })
  .inputValidator((d: { role?: Role } | undefined) =>
    z.object({ role: z.enum(["admin", "lecturer", "student"]).optional() }).optional().parse(d) ?? {},
  )
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    return repo.listUsers(data?.role);
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
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    if (await repo.emailExists(data.email)) throw new Error("Email already in use");
    const id = await repo.createUser({ ...data, role: "student" });
    return { id };
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
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    if (await repo.emailExists(data.email)) throw new Error("Email already in use");
    const id = await repo.createUser({ ...data, role: "lecturer" });
    return { id };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    await repo.deleteUser(data.id);
    return { ok: true };
  });

const updateStudentSchema = z.object({
  id: z.string(),
  name: z.string().min(2).max(120),
  email: z.string().email(),
  matricNo: z.string().min(2).max(40),
  departmentId: z.string().min(1),
  level: z.string().min(1),
  password: z.string().min(6).optional(),
});
export const updateStudent = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof updateStudentSchema>) => updateStudentSchema.parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    const { id, ...rest } = data;
    await repo.updateStudent(id, rest);
    return { ok: true };
  });

const updateLecturerSchema = z.object({
  id: z.string(),
  name: z.string().min(2).max(120),
  email: z.string().email(),
  staffId: z.string().min(2).max(40),
  departmentId: z.string().min(1),
  password: z.string().min(6).optional(),
});
export const updateLecturer = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof updateLecturerSchema>) => updateLecturerSchema.parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    const { id, ...rest } = data;
    await repo.updateLecturer(id, rest);
    return { ok: true };
  });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
});
export const changePassword = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof changePasswordSchema>) => changePasswordSchema.parse(d))
  .handler(async ({ data }) => {
    const sess = await requireUser();
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    await repo.changePassword(sess.sub, data.currentPassword, data.newPassword);
    return { ok: true };
  });

// ─── DEPARTMENTS ──────────────────────────────────────────────────────────

export const listDepartments = createServerFn({ method: "GET" }).handler(async () => {
  const { getRepo } = await import("./db.server");
  const repo = await getRepo();
  return repo.listDepartments();
});

export const createDepartment = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string; code: string; icon?: string; color?: string }) =>
    z.object({ name: z.string().min(2), code: z.string().min(2).max(10), icon: z.string().optional(), color: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    return repo.createDepartment(data.name, data.code, data.icon, data.color);
  });

export const deleteDepartment = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    await repo.deleteDepartment(data.id);
    return { ok: true };
  });

export const updateDepartment = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; name: string; code: string; icon?: string; color?: string }) =>
    z.object({ id: z.string(), name: z.string().min(2), code: z.string().min(2).max(10), icon: z.string().optional(), color: z.string().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    await repo.updateDepartment(data.id, data.name, data.code, data.icon, data.color);
    return { ok: true };
  });

// ─── COURSES ──────────────────────────────────────────────────────────────

export const listCourses = createServerFn({ method: "GET" }).handler(async () => {
  const { getRepo } = await import("./db.server");
  const repo = await getRepo();
  return repo.listCourses();
});

const createCourseSchema = z.object({
  code: z.string().min(2),
  title: z.string().min(2),
  departmentId: z.string().min(1),
  level: z.string().min(1),
  units: z.number().min(1).max(12),
  icon: z.string().optional(),
  color: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
});
export const createCourse = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof createCourseSchema>) => createCourseSchema.parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    return repo.createCourse(data);
  });

export const assignLecturer = createServerFn({ method: "POST" })
  .inputValidator((d: { courseId: string; lecturerId: string | null }) =>
    z.object({ courseId: z.string(), lecturerId: z.string().nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    await repo.assignLecturer(data.courseId, data.lecturerId);
    return { ok: true };
  });

export const enrollStudents = createServerFn({ method: "POST" })
  .inputValidator((d: { courseId: string; studentIds: string[] }) =>
    z.object({ courseId: z.string(), studentIds: z.array(z.string()) }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    await repo.setEnrollments(data.courseId, data.studentIds);
    return { ok: true };
  });

export const deleteCourse = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    await repo.deleteCourse(data.id);
    return { ok: true };
  });

const updateCourseSchema = z.object({
  id: z.string(),
  code: z.string().min(2),
  title: z.string().min(2),
  departmentId: z.string().min(1),
  level: z.string().min(1),
  units: z.number().min(1).max(12),
  icon: z.string().optional(),
  color: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
});
export const updateCourse = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof updateCourseSchema>) => updateCourseSchema.parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    const { id, ...rest } = data;
    await repo.updateCourse(id, rest);
    return { ok: true };
  });

// ─── LECTURER ─────────────────────────────────────────────────────────────

export const lecturerCourses = createServerFn({ method: "GET" }).handler(async () => {
  const sess = await requireUser(["lecturer"]);
  const { getRepo } = await import("./db.server");
  const repo = await getRepo();
  return repo.lecturerCourses(sess.sub);
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
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    const c = await repo.getCourse(data.courseId);
    if (!c) throw new Error("Course not found");
    if (c.lecturerId !== sess.sub) throw new Error("Not your course");
    return repo.startSession({ ...data, lecturerId: sess.sub });
  });

export const endSession = createServerFn({ method: "POST" })
  .inputValidator((d: { sessionId: string }) => z.object({ sessionId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const sess = await requireUser(["lecturer"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    const s = await repo.getSession(data.sessionId);
    if (!s) throw new Error("Session not found");
    if (s.lecturerId !== sess.sub) throw new Error("Not your session");
    await repo.endSession(data.sessionId);
    return { ok: true };
  });

export const deleteAttendanceRecord = createServerFn({ method: "POST" })
  .inputValidator((d: { recordId: string }) => z.object({ recordId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const sess = await requireUser(["lecturer", "admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    // Lecturers may only delete records from their own sessions.
    if (sess.role === "lecturer") {
      const rec = await repo.getAttendanceRecord(data.recordId);
      if (!rec) throw new Error("Record not found");
      const session = await repo.getSession(rec.sessionId);
      if (!session || session.lecturerId !== sess.sub) throw new Error("Not your session");
    }
    await repo.deleteAttendanceRecord(data.recordId);
    return { ok: true };
  });

export const sessionDetail = createServerFn({ method: "GET" })
  .inputValidator((d: { sessionId: string }) => z.object({ sessionId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser(["lecturer", "admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    const detail = await repo.sessionDetail(data.sessionId);
    if (!detail) throw new Error("Session not found");
    return detail;
  });

export const lecturerSessionsFor = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => z.object({ courseId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser(["lecturer", "admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    return repo.listSessionsForCourse(data.courseId);
  });

// ─── STUDENT ─────────────────────────────────────────────────────────────

export const studentCourses = createServerFn({ method: "GET" }).handler(async () => {
  const sess = await requireUser(["student"]);
  const { getRepo } = await import("./db.server");
  const repo = await getRepo();
  return repo.studentCourses(sess.sub);
});

export const studentCourseSessions = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => z.object({ courseId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const sess = await requireUser(["student"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    // Verify student is enrolled in this course
    const courses = await repo.studentCourses(sess.sub);
    if (!courses.find((c) => c.id === data.courseId)) {
      throw new Error("Not enrolled in this course");
    }
    return repo.listSessionsForCourse(data.courseId);
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
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    return repo.submitAttendance({ ...data, studentId: sess.sub });
  });

export const studentHistory = createServerFn({ method: "GET" }).handler(async () => {
  const sess = await requireUser(["student"]);
  const { getRepo } = await import("./db.server");
  const repo = await getRepo();
  return repo.studentHistory(sess.sub);
});

// ─── REPORTS / ANALYTICS ─────────────────────────────────────────────────

export const courseReport = createServerFn({ method: "GET" })
  .inputValidator((d: { courseId: string }) => z.object({ courseId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin", "lecturer"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    const r = await repo.courseReport(data.courseId);
    if (!r) throw new Error("Course not found");
    return r;
  });

export const facultyReport = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser(["admin"]);
  const { getRepo } = await import("./db.server");
  const repo = await getRepo();
  return repo.facultyReport();
});

export const adminOverview = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser(["admin"]);
  const { getRepo } = await import("./db.server");
  const repo = await getRepo();
  return repo.adminOverview();
});

// ─── SITE SETTINGS (branding) ───────────────────────────────────────────────

export const getSiteSettings = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const { getRepo } = await import("./db.server");
  const repo = await getRepo();
  return repo.getSiteSettings();
});

const siteSettingsSchema = z.object({
  institutionName: z.string().min(1).optional(),
  atRiskThreshold: z.number().min(0).max(100).optional(),
  marqueeItems: z.array(z.string()).optional(),
  testimonials: z
    .array(z.object({ name: z.string(), role: z.string(), text: z.string() }))
    .optional(),
  demoAccountsEnabled: z.boolean().optional(),
  demoPassword: z.string().optional(),
  demoEmailDomain: z.string().optional(),
  showFakeStats: z.boolean().optional(),
  primaryColor: z.string().nullable().optional(),
  contactEmail: z.string().nullable().optional(),
});
export const updateSiteSettings = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof siteSettingsSchema>) => siteSettingsSchema.parse(d))
  .handler(async ({ data }) => {
    await requireUser(["admin"]);
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    return repo.saveSiteSettings(data);
  });

// ─── STUDENT: open sessions ─────────────────────────────────────────────────

export const listOpenSessionsForStudent = createServerFn({ method: "GET" }).handler(async () => {
  const sess = await requireUser(["student"]);
  const { getRepo } = await import("./db.server");
  const repo = await getRepo();
  return repo.listOpenSessionsForStudent(sess.sub);
});

// ─── SELF PROFILE UPDATE (per-user settings) ───────────────────────────────

const updateProfileSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(6).optional(),
});
export const updateProfile = createServerFn({ method: "POST" })
  .inputValidator((d: z.input<typeof updateProfileSchema>) => updateProfileSchema.parse(d))
  .handler(async ({ data }) => {
    const sess = await requireUser();
    const { getRepo } = await import("./db.server");
    const repo = await getRepo();
    const u = await repo.getUser(sess.sub);
    if (!u) throw new Error("User not found");
    if (sess.role === "student") {
      await repo.updateStudent(sess.sub, {
        name: data.name,
        email: data.email,
        matricNo: u.matricNo ?? "",
        departmentId: u.departmentId ?? "",
        level: u.level ?? "",
        password: data.password ?? "",
      });
    } else if (sess.role === "lecturer") {
      await repo.updateLecturer(sess.sub, {
        name: data.name,
        email: data.email,
        staffId: u.staffId ?? "",
        departmentId: u.departmentId ?? "",
        password: data.password ?? "",
      });
    } else {
      throw new Error("Admins manage their account via the admin panel");
    }
    return { ok: true };
  });
