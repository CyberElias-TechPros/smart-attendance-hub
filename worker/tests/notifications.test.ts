// Phase 4.5 — notifications (plan §4.5, brief §2 sidebar + §2B top-bar bell).
//
// The bell and the inbox both read one table through one `notify()` helper.
// What these tests pin down is the part that is easy to get subtly wrong:
//
//  1. an audience is resolved from the database, never trusted from the caller;
//  2. a broadcast chunks by D1's 100-parameter budget, so a 428-student course
//     still receives every row (the same class of bug as the seed's batch size);
//  3. one user can never read or mark read another user's row;
//  4. the wiring fires: a correction reaches the student, an export reaches the
//     requester.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import { getRepo, type Repo } from "../src/db";
import worker from "../src/index";
import type { Env } from "../src/index";

const SECRET = "notifications-test-secret-0123456789";
const BASE = "https://api.test";

let shim: D1Shim;
let repo: Repo;
let env: Env;

beforeAll(async () => {
  shim = createD1Shim();
  applyMigrations(shim.raw);
  repo = await getRepo(shim.db);
  env = {
    DB: shim.db,
    SLAMS_JWT_SECRET: SECRET,
    ALLOWED_ORIGINS: "",
  } as unknown as Env;
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

async function login(email: string, password = "password123") {
  const res = await call("POST", "/api/auth/login", { body: { email, password } });
  const json = (await res.json()) as { token?: string; user?: { id: string } };
  return { status: res.status, token: json.token ?? "", userId: json.user?.id ?? "" };
}

/** A course with `count` enrolled students, all in the acting department. */
async function courseWithStudents(code: string, count: number) {
  const dept = (await repo.listDepartments())[0];
  const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
  const course = await repo.createCourse({
    code,
    title: `${code} Notifications`,
    departmentId: dept.id,
    level: "200",
    units: 2,
  });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(
      await repo.createUser({
        name: `${code} Student ${i}`,
        email: `${code.replace(/\s/g, "").toLowerCase()}-${i}@slams.edu`,
        password: "password123",
        role: "student",
        matricNo: `${code.replace(/\s/g, "")}/${String(i).padStart(4, "0")}`,
        departmentId: dept.id,
        level: "200",
      }),
    );
  }
  await repo.setEnrollments(course.id, ids);
  return { course, studentIds: ids, lecturerId: lecturer!.id };
}

describe("notify() — audience resolution and chunking", () => {
  it("writes one row per enrolled student and skips the actor", async () => {
    const { course, studentIds } = await courseWithStudents("NTF 101", 4);
    const written = await repo.notify({
      audience: { kind: "course", courseId: course.id },
      kind: "session.started",
      title: "Lecture started",
      courseId: course.id,
      except: [studentIds[0]],
    });
    expect(written).toBe(3);
    for (const id of studentIds.slice(1)) {
      const page = await repo.notificationsFor(id);
      expect(page.total).toBe(1);
      expect(page.items[0].audience).toBe("course");
      expect(page.items[0].kind).toBe("session.started");
      expect(page.items[0].courseId).toBe(course.id);
      expect(page.unread).toBe(1);
    }
    // The excluded student is not told about their own action.
    expect((await repo.notificationsFor(studentIds[0])).total).toBe(0);
  });

  it("chunks a large course-wide broadcast so no statement exceeds D1's parameter ceiling", async () => {
    // 13 bound parameters per row means 6 rows per statement; 20 recipients is
    // four statements. A naive single INSERT would bind 260 parameters and D1
    // would reject it at runtime while node:sqlite stayed quiet.
    const { course, studentIds } = await courseWithStudents("NTF 102", 20);
    const written = await repo.notify({
      audience: { kind: "course", courseId: course.id },
      kind: "at_risk.course",
      title: "Attendance below target",
      body: "Two consecutive lectures missed.",
      courseId: course.id,
    });
    expect(written).toBe(20);
    for (const id of studentIds) {
      expect((await repo.notificationsFor(id)).total).toBe(1);
    }
    // Nothing landed in the acting admin's inbox.
    const admin = await repo.getUserByEmail("admin@slams.edu");
    expect((await repo.notificationsFor(admin!.id)).total).toBe(0);
  });

  it("addresses a role and de-duplicates recipients", async () => {
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const written = await repo.notify({
      audience: { kind: "users", userIds: [lecturer!.id, lecturer!.id] },
      kind: "export.ready",
      title: "Report ready",
    });
    expect(written).toBe(1);
    const page = await repo.notificationsFor(lecturer!.id);
    expect(page.items.filter((n) => n.kind === "export.ready")).toHaveLength(1);
    expect(page.items[0].audience).toBe("user");
  });

  it("orders newest first and pages predictably", async () => {
    const { studentIds } = await courseWithStudents("NTF 103", 1);
    const student = studentIds[0];
    for (let i = 0; i < 5; i++) {
      await repo.notify({
        audience: { kind: "user", userId: student },
        kind: "mention",
        title: `Notice ${i}`,
        createdAt: 1_000 + i,
      });
    }
    const first = await repo.notificationsFor(student, { pageSize: 2 });
    expect(first.total).toBe(5);
    expect(first.items.map((n) => n.title)).toEqual(["Notice 4", "Notice 3"]);
    const second = await repo.notificationsFor(student, { page: 2, pageSize: 2 });
    expect(second.items.map((n) => n.title)).toEqual(["Notice 2", "Notice 1"]);
  });
});

describe("read state is per user", () => {
  it("marks one row read and never touches anybody else's", async () => {
    const { course, studentIds } = await courseWithStudents("NTF 104", 2);
    await repo.notify({
      audience: { kind: "course", courseId: course.id },
      kind: "session.started",
      title: "Lecture started",
    });
    const [a, b] = studentIds;
    const aPage = await repo.notificationsFor(a);
    const rowId = aPage.items[0].id;

    expect(await repo.markNotificationRead(b, rowId)).toBe(false); // not b's row
    expect((await repo.notificationsFor(b)).unread).toBe(1);
    expect(await repo.markNotificationRead(a, rowId, 555)).toBe(true);
    expect((await repo.notificationsFor(a)).unread).toBe(0);
    const row = shim.raw.prepare("SELECT read_at FROM notifications WHERE id = ?").get(rowId) as {
      read_at: number;
    };
    expect(row.read_at).toBe(555);
    // Idempotent: marking the same row twice does not move the timestamp.
    expect(await repo.markNotificationRead(a, rowId, 999)).toBe(true);
    const again = shim.raw.prepare("SELECT read_at FROM notifications WHERE id = ?").get(rowId) as {
      read_at: number;
    };
    expect(again.read_at).toBe(555);
  });

  it("mark-all clears exactly the unread rows and reports how many", async () => {
    const { studentIds } = await courseWithStudents("NTF 105", 1);
    const student = studentIds[0];
    for (let i = 0; i < 4; i++) {
      await repo.notify({
        audience: { kind: "user", userId: student },
        kind: "mention",
        title: `Ping ${i}`,
      });
    }
    expect(await repo.markAllNotificationsRead(student, 7_777)).toBe(4);
    expect(await repo.markAllNotificationsRead(student, 7_778)).toBe(0);
    const page = await repo.notificationsFor(student);
    expect(page.unread).toBe(0);
    expect(page.items.every((n) => n.readAt === 7_777)).toBe(true);
  });

  it("supports an unread-only filter", async () => {
    const { studentIds } = await courseWithStudents("NTF 106", 1);
    const student = studentIds[0];
    for (let i = 0; i < 3; i++) {
      await repo.notify({
        audience: { kind: "user", userId: student },
        kind: "mention",
        title: `Item ${i}`,
      });
    }
    const page = await repo.notificationsFor(student);
    await repo.markNotificationRead(student, page.items[0].id);
    const unread = await repo.notificationsFor(student, { unreadOnly: true });
    expect(unread.total).toBe(2);
    expect(unread.unread).toBe(2);
  });
});

describe("HTTP surface", () => {
  it("scopes the inbox, the badge and both read routes to the caller", async () => {
    const { course, studentIds } = await courseWithStudents("NTF 107", 1);
    const student = studentIds[0];
    await repo.notify({
      audience: { kind: "course", courseId: course.id },
      kind: "session.started",
      title: "Lecture started",
      href: `/student/courses/${course.id}`,
    });

    const who = shim.raw.prepare("SELECT email FROM users WHERE id = ?").get(student) as {
      email: string;
    };
    const session = await login(who.email);
    expect(session.status).toBe(200);
    const admin = await login("admin@slams.edu");

    const summary = await call("GET", "/api/notifications/summary", { token: session.token });
    expect(summary.status).toBe(200);
    expect(((await summary.json()) as { unread: number }).unread).toBe(1);

    const inbox = await call("GET", "/api/notifications", { token: session.token });
    const body = (await inbox.json()) as {
      items: Array<{ id: string; href?: string }>;
      unread: number;
    };
    expect(body.unread).toBe(1);
    expect(body.items[0].href).toBe(`/student/courses/${course.id}`);

    // Somebody else's token cannot clear this row.
    const foreign = await call("POST", `/api/notifications/${body.items[0].id}/read`, {
      token: admin.token,
    });
    expect(foreign.status).toBe(404);

    const own = await call("POST", `/api/notifications/${body.items[0].id}/read`, {
      token: session.token,
    });
    expect(own.status).toBe(200);
    const after = await call("GET", "/api/notifications/summary", { token: session.token });
    expect(((await after.json()) as { unread: number }).unread).toBe(0);

    // read-all is a no-op the second time and says so.
    const all = await call("POST", "/api/notifications/read-all", { token: session.token });
    expect(((await all.json()) as { marked: number }).marked).toBe(0);
  });

  it("tells the student when an administrator corrects their attendance", async () => {
    const { course, studentIds } = await courseWithStudents("NTF 108", 1);
    const student = studentIds[0];
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const session = await repo.startSession({
      courseId: course.id,
      lecturerId: lecturer!.id,
      durationMinutes: 20,
    });
    await repo.submitAttendance({ code: session.code, studentId: student, deviceId: "ntf-1" });
    const record = shim.raw
      .prepare("SELECT id FROM attendance_records WHERE session_id = ?")
      .get(session.id) as { id: string };

    const who = shim.raw.prepare("SELECT email FROM users WHERE id = ?").get(student) as {
      email: string;
    };
    const studentSession = await login(who.email);
    const admin = await login("admin@slams.edu");

    const patched = await call("PATCH", `/api/attendance/${record.id}/status`, {
      token: admin.token,
      body: { status: "excused", reason: "Medical evidence provided" },
    });
    expect(patched.status).toBe(200);

    const inbox = await call("GET", "/api/notifications", { token: studentSession.token });
    const body = (await inbox.json()) as {
      items: Array<{ kind: string; title: string; body?: string; href?: string }>;
    };
    const notice = body.items.find((n) => n.kind === "attendance.corrected");
    expect(notice).toBeDefined();
    expect(notice!.title).toContain("excused");
    expect(notice!.body).toContain("Medical evidence provided");
    expect(notice!.href).toBe(`/student/courses/${course.id}`);

    // The correction is also voided → a second, different notice.
    const removed = await call("DELETE", `/api/attendance/${record.id}`, {
      token: admin.token,
      body: { reason: "Duplicate sign-in" },
    });
    expect(removed.status).toBe(200);
    const after = (await (
      await call("GET", "/api/notifications", { token: studentSession.token })
    ).json()) as { items: Array<{ kind: string }> };
    expect(after.items.some((n) => n.kind === "attendance.voided")).toBe(true);
  });

  it("confirms a finished export to the person who asked for it", async () => {
    const admin = await login("admin@slams.edu");
    const res = await call("POST", "/api/reports/exports", {
      token: admin.token,
      body: { format: "xlsx", scope: "all", rowCount: 21, title: "All courses" },
    });
    expect(res.status).toBe(200);
    const inbox = await call("GET", "/api/notifications", { token: admin.token });
    const body = (await inbox.json()) as { items: Array<{ kind: string; title: string }> };
    const notice = body.items.find((n) => n.kind === "export.ready");
    expect(notice).toBeDefined();
    expect(notice!.title).toContain("XLSX");
    expect(notice!.title).toContain("all");
  });

  it("requires authentication for every notification route", async () => {
    for (const [method, path] of [
      ["GET", "/api/notifications"],
      ["GET", "/api/notifications/summary"],
      ["POST", "/api/notifications/read-all"],
      ["POST", "/api/notifications/xyz/read"],
    ] as const) {
      const res = await call(method, path);
      expect(res.status).toBe(401);
    }
  });
});
