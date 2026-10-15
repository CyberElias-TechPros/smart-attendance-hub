// Phase 5.2 — extra capabilities, and more than one administrator (plan §9).
//
// The brief's §9 asks for scoped access: "lecturers limited to their courses
// unless granted more", exports that respect permissions, and a trail for every
// change. These tests hold the three promises that make that safe:
//
//   * a grant widens what somebody may READ and never what they may CHANGE;
//   * the scope a grant resolves to is applied *after* the caller's own filters,
//     so no query string can widen it;
//   * promoting and demoting is audited, and the institution can never end up
//     with no administrator at all.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import { getRepo, type Repo } from "../src/db";
import worker from "../src/index";
import type { Env } from "../src/index";
import type { CourseReportRow, User } from "../src/types";

const SECRET = "access-test-secret-0123456789";
const BASE = "https://api.test";

let shim: D1Shim;
let repo: Repo;
let env: Env;
let adminToken = "";
let lecturerToken = "";
let lecturer: User;
let otherLecturer: User;

beforeAll(async () => {
  shim = createD1Shim();
  applyMigrations(shim.raw);
  repo = await getRepo(shim.db);
  env = { DB: shim.db, SLAMS_JWT_SECRET: SECRET, ALLOWED_ORIGINS: "" } as unknown as Env;
  const login = async (email: string) => {
    const res = await worker.fetch(
      new Request(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "password123" }),
      }),
      env,
    );
    return ((await res.json()) as { token: string }).token;
  };
  adminToken = await login("admin@slams.edu");
  lecturerToken = await login("lecturer@slams.edu");
  lecturer = (await repo.getUserByEmail("lecturer@slams.edu"))!;
  otherLecturer = (await repo.getUserByEmail("adeyemi@slams.edu"))!;
});
afterAll(() => shim.close());

async function call(
  method: string,
  path: string,
  opts?: { token?: string; body?: unknown },
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts?.token) headers.authorization = `Bearer ${opts.token}`;
  return await worker.fetch(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    env,
  );
}

const grant = (permission: string, token = adminToken, userId = lecturer.id) =>
  call("POST", `/api/access/${userId}/grants`, { token, body: { permission } });

const revoke = (permission: string, token = adminToken, userId = lecturer.id) =>
  call("DELETE", `/api/access/${userId}/grants/${encodeURIComponent(permission)}`, { token });

async function reportRows(token: string, query = ""): Promise<CourseReportRow[]> {
  const res = await call("GET", `/api/reports/courses${query}`, { token });
  expect(res.status).toBe(200);
  return ((await res.json()) as { rows: CourseReportRow[] }).rows;
}

const auditActions = (): string[] =>
  (
    shim.raw.prepare("SELECT action FROM audit_log ORDER BY created_at ASC").all() as Array<{
      action: string;
    }>
  ).map((r) => r.action);

describe("the access screen's data", () => {
  it("lists the catalogue and every staff account with its grants", async () => {
    const res = await call("GET", "/api/access", { token: adminToken });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      permissions: Array<{ key: string; label: string; description: string }>;
      staff: Array<{ id: string; role: string; permissions: string[] }>;
      admins: number;
    };
    expect(body.permissions.map((p) => p.key)).toContain("reports.department");
    expect(body.permissions.every((p) => p.description.length > 20)).toBe(true);
    expect(body.staff.some((s) => s.id === lecturer.id && s.permissions.length === 0)).toBe(true);
    expect(body.staff.every((s) => s.role !== "student")).toBe(true);
    expect(body.admins).toBeGreaterThanOrEqual(1);
  });

  it("tells a person what they can do, without giving them the catalogue", async () => {
    const res = await call("GET", "/api/access/me", { token: lecturerToken });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string; permissions: string[]; effective: string[] };
    expect(body.role).toBe("lecturer");
    expect(body.permissions).toEqual([]);

    const adminRes = await call("GET", "/api/access/me", { token: adminToken });
    const adminBody = (await adminRes.json()) as {
      effective: string[];
      catalogue: Array<{ key: string; label: string }>;
    };
    expect(adminBody.effective).toContain("reports.institution");
    expect(adminBody.catalogue.map((c) => c.key)).toEqual(adminBody.effective);
  });
});

describe("granting", () => {
  it("refuses a grant from anybody who is not an administrator", async () => {
    const res = await grant("reports.department", lecturerToken);
    expect(res.status).toBe(403);
    expect(await repo.hasPermission(lecturer.id, "reports.department")).toBe(false);
  });

  it("refuses an unknown capability, and one aimed at a student", async () => {
    const unknown = await grant("reports.everything");
    expect(unknown.status).toBe(400);

    const student = (await repo.getUserByEmail("student@slams.edu"))!;
    const res = await grant("reports.institution", adminToken, student.id);
    expect(res.status).toBe(400);
    expect(await repo.hasPermission(student.id, "reports.institution")).toBe(false);
  });

  it("is audited once and is idempotent", async () => {
    const first = await grant("reports.department");
    expect(first.status).toBe(200);
    expect(((await first.json()) as { created: boolean }).created).toBe(true);

    const second = await grant("reports.department");
    expect(((await second.json()) as { created: boolean }).created).toBe(false);

    // Scoped to this person: the seed ships two grants of its own, and those are
    // separate acts by a separate decision — they must not be counted here.
    const grants = shim.raw
      .prepare(
        "SELECT actor_email, reason FROM audit_log WHERE action = 'permission.grant' AND entity_id = ?",
      )
      .all(lecturer.id) as Array<{ actor_email: string; reason: string }>;
    expect(grants).toHaveLength(1);
    const row = grants[0];
    expect(row.actor_email).toBe("admin@slams.edu");
    expect(row.reason).toContain("Department reports");
  });
});

describe("what a grant widens", () => {
  it("keeps a lecturer to their own courses until they are granted more", async () => {
    await revoke("reports.department");
    const own = await reportRows(lecturerToken);
    expect(own.length).toBeGreaterThan(0);
    // Only courses where they are the assigned lecturer.
    const taught = await repo.listCourses();
    const mine = new Set(taught.filter((c) => c.lecturerId === lecturer.id).map((c) => c.id));
    expect(own.every((r) => mine.has(r.id))).toBe(true);

    // A grant is additive: the department's courses *plus* the ones they teach.
    // Service courses make that distinction real — a Computer Science lecturer
    // teaching a General Studies course keeps seeing it.
    await grant("reports.department");
    const department = await reportRows(lecturerToken);
    const inScope = (await repo.listCourses()).filter(
      (c) => c.departmentId === lecturer.departmentId || c.lecturerId === lecturer.id,
    );
    expect(department.length).toBe(inScope.length);
    expect(department.length).toBeGreaterThanOrEqual(own.length);
    expect(
      department.every(
        (r) => r.departmentId === lecturer.departmentId || r.lecturerId === lecturer.id,
      ),
    ).toBe(true);
  });

  it("cannot be widened by the request, only by the grant", async () => {
    // Asking for a faculty the lecturer has no grant over. The requested filter
    // is AND'ed *inside* the scope, so the answer can only be a subset of what
    // they may already see — never somebody else's faculty. This is the property
    // that makes a hand-written query string harmless.
    const departments = await repo.listDepartments();
    const mine = departments.find((d) => d.id === lecturer.departmentId)!;
    const taughtDepartments = new Set(
      (await repo.listCourses())
        .filter((c) => c.lecturerId === lecturer.id)
        .map((c) => c.departmentId),
    );
    // A faculty the lecturer neither belongs to nor teaches into: asking for it
    // yields nothing at all.
    const outside = (await repo.listFaculties()).find(
      (f) =>
        f.id !== mine.facultyId &&
        !departments.some((d) => d.facultyId === f.id && taughtDepartments.has(d.id)),
    )!;
    const rows = await reportRows(lecturerToken, `?facultyId=${encodeURIComponent(outside.id)}`);
    expect(rows.length).toBe(0);

    // A department a lecturer has no business in, with the department grant in
    // hand: still nothing outside their own scope.
    const otherDept = departments.find(
      (d) => d.id !== lecturer.departmentId && d.facultyId !== mine.facultyId,
    )!;
    const foreign = await reportRows(
      lecturerToken,
      `?departmentId=${encodeURIComponent(otherDept.id)}`,
    );
    expect(foreign.every((r) => r.departmentId === otherDept.id)).toBe(true);
    expect(foreign.every((r) => r.lecturerId === lecturer.id)).toBe(true);
    expect(foreign.length).toBe(0); // nothing they teach lives there

    // And the same grant still refuses a course-level report outside the scope.
    const course = (await repo.listCourses()).find(
      (c) => c.departmentId !== lecturer.departmentId && c.lecturerId !== lecturer.id,
    )!;
    const res = await call("GET", `/api/reports/course/${course.id}`, { token: lecturerToken });
    expect(res.status).toBe(403);
  });

  it("resolves a faculty grant to the whole faculty", async () => {
    await revoke("reports.department");
    await grant("reports.faculty");
    const rows = await reportRows(lecturerToken);
    expect(rows.length).toBeGreaterThan(0);
    const departments = await repo.listDepartments();
    const mine = departments.find((d) => d.id === lecturer.departmentId)!;
    const facultyDepartments = new Set(
      departments.filter((d) => d.facultyId === mine.facultyId).map((d) => d.id),
    );
    expect(
      rows.every(
        (r) =>
          (r.departmentId && facultyDepartments.has(r.departmentId)) ||
          r.lecturerId === lecturer.id,
      ),
    ).toBe(true);
    // The faculty's courses plus the ones they teach — a faculty grant is wider
    // than a department grant, and still additive.
    const scoped = await repo.coursesReport({ facultyId: mine.facultyId, pageSize: 100 });
    const taught = (await repo.listCourses()).filter((c) => c.lecturerId === lecturer.id);
    const expected = new Set([...scoped.rows.map((r) => r.id), ...taught.map((c) => c.id)]);
    expect(new Set(rows.map((r) => r.id))).toEqual(expected);
  });

  it("resolves an institution grant to everything", async () => {
    await revoke("reports.faculty");
    await grant("reports.institution");
    const rows = await reportRows(lecturerToken);
    const all = await repo.coursesReport({ pageSize: 100 });
    expect(rows.length).toBe(all.rows.length);

    // The institution dashboard figures come with it.
    const overview = await call("GET", "/api/admin/overview", { token: lecturerToken });
    expect(overview.status).toBe(403); // still an admin-only *dashboard* screen
    await revoke("reports.institution");
  });
});

describe("a grant widens reading, never writing", () => {
  it("does not let a department reader record marks on somebody else's course", async () => {
    await grant("reports.department");
    const course = await repo.createCourse({
      code: "ACC 101",
      title: "Access Control",
      departmentId: lecturer.departmentId!,
      level: "200",
      units: 2,
    });
    const exam = await repo.createExam({ courseId: course.id, title: "Access test" });
    const res = await call("POST", `/api/exams/${exam.id}/results`, {
      token: lecturerToken,
      body: { rows: [{ studentId: "whoever", score: 10 }] },
    });
    expect(res.status).toBe(403);
    expect(await repo.listResults(exam.id)).toHaveLength(0);
    await revoke("reports.department");
  });

  it("lets a trusted lecturer publish, and only for their own course", async () => {
    const own = await repo.createCourse({
      code: "ACC 102",
      title: "Owned Publishing",
      departmentId: lecturer.departmentId!,
      level: "200",
      units: 2,
    });
    await repo.assignLecturer(own.id, lecturer.id);
    const exam = await repo.createExam({ courseId: own.id, title: "Publish me" });

    const refused = await call("PATCH", `/api/exams/${exam.id}`, {
      token: lecturerToken,
      body: { published: true },
    });
    expect(refused.status).toBe(403);

    await grant("results.publish");
    const allowed = await call("PATCH", `/api/exams/${exam.id}`, {
      token: lecturerToken,
      body: { published: true },
    });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as { published: boolean }).published).toBe(true);
    await revoke("results.publish");

    // Somebody else's paper stays out of reach even with the grant.
    await grant("results.publish");
    const foreign = await repo.createExam({
      courseId: (await repo.listCourses())[0].id,
      title: "Somebody else's paper",
    });
    const foreignRes = await call("PATCH", `/api/exams/${foreign.id}`, {
      token: lecturerToken,
      body: { published: true },
    });
    expect(foreignRes.status).toBe(403);
    await revoke("results.publish");
  });

  it("gates the audit trail and people imports behind their capabilities", async () => {
    expect((await call("GET", "/api/audit", { token: lecturerToken })).status).toBe(403);

    await grant("audit.view");
    const trail = await call("GET", "/api/audit", { token: lecturerToken });
    expect(trail.status).toBe(200);
    expect(((await trail.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
    await revoke("audit.view");
    expect((await call("GET", "/api/audit", { token: lecturerToken })).status).toBe(403);

    const csv =
      "name,email,matric no,department,level\nGranted Import,granted.import@slams.edu,CSC/22/9701,CSC,200";
    const refused = await call("POST", "/api/import/apply", {
      token: lecturerToken,
      body: { kind: "students", csv },
    });
    expect(refused.status).toBe(403);

    await grant("imports.people");
    const allowed = await call("POST", "/api/import/apply", {
      token: lecturerToken,
      body: { kind: "students", csv },
    });
    expect(allowed.status).toBe(200);
    await revoke("imports.people");
  });
});

describe("multiple administrators", () => {
  it("promotes a lecturer, and the promotion is a real one", async () => {
    const before = await call("GET", "/api/access", { token: lecturerToken });
    expect(before.status).toBe(403);

    const res = await call("POST", `/api/access/${lecturer.id}/role`, {
      token: adminToken,
      body: { role: "admin" },
    });
    expect(res.status).toBe(200);

    // A fresh sign-in carries the new role (the old token was revoked, which is
    // also why a promotion cannot be used to hijack a live session).
    const relogin = await call("POST", "/api/auth/login", {
      body: { email: "lecturer@slams.edu", password: "password123" },
    });
    const { token, user } = (await relogin.json()) as { token: string; user: { role: string } };
    expect(user.role).toBe("admin");
    expect((await call("GET", "/api/access", { token })).status).toBe(200);

    // The demotion goes back the same way.
    const down = await call("POST", `/api/access/${lecturer.id}/role`, {
      token: adminToken,
      body: { role: "lecturer" },
    });
    expect(down.status).toBe(200);
    expect(auditActions().filter((a) => a === "user.role_change")).toHaveLength(2); // promote + demote, and nothing else in this suite

    const row = shim.raw
      .prepare("SELECT reason FROM audit_log WHERE action = 'user.role_change' LIMIT 1")
      .get() as { reason: string };
    expect(row.reason).toContain("admin");
  });

  it("never leaves the institution without an administrator", async () => {
    const admin = (await repo.getUserByEmail("admin@slams.edu"))!;
    expect(await repo.countAdmins()).toBe(1);
    const res = await call("POST", `/api/access/${admin.id}/role`, {
      token: adminToken,
      body: { role: "lecturer" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/last administrator/i);
    expect((await repo.getUser(admin.id))!.role).toBe("admin");
  });
});

describe("revoking", () => {
  it("takes the capability away and records it", async () => {
    // The role-change suite above revoked the lecturer's outstanding tokens (a
    // role change must invalidate sessions signed with the old role), so this
    // suite signs in again rather than testing a dead token.
    const res0 = await call("POST", "/api/auth/login", {
      body: { email: "lecturer@slams.edu", password: "password123" },
    });
    lecturerToken = ((await res0.json()) as { token: string }).token;
    await grant("reports.institution");
    expect(await repo.hasPermission(lecturer.id, "reports.institution")).toBe(true);

    const res = await revoke("reports.institution");
    expect(((await res.json()) as { removed: boolean }).removed).toBe(true);
    expect(await repo.hasPermission(lecturer.id, "reports.institution")).toBe(false);

    // Back to their own courses.
    const rows = await reportRows(lecturerToken);
    const mine = new Set(
      (await repo.listCourses()).filter((c) => c.lecturerId === lecturer.id).map((c) => c.id),
    );
    expect(rows.every((r) => mine.has(r.id))).toBe(true);

    const revokeRow = shim.raw
      .prepare(
        "SELECT reason FROM audit_log WHERE action = 'permission.revoke' AND entity_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(lecturer.id) as { reason: string };
    expect(revokeRow.reason).toContain("Revoked");
  });
});
