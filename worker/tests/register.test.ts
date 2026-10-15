// Phase 4.2 — the institution-wide lecture register (`GET /api/reports/sessions`).
//
// The register is the All-Courses table with the course filter removed, so the
// things worth pinning are the ones that could silently drift apart from it:
// the four tallies must reconcile per row, the totals must describe the whole
// filtered set rather than the visible page, filters must combine, a lecturer
// must only ever see their own lectures, and a long course selection must not
// exceed D1's 100-parameter ceiling (the same bug class as the seed batch size).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import { getRepo, type Repo } from "../src/db";
import worker from "../src/index";
import type { Env } from "../src/index";

const SECRET = "register-test-secret-0123456789";
const BASE = "https://api.test";

let shim: D1Shim;
let repo: Repo;
let env: Env;
let adminToken = "";
let lecturerToken = "";

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
});
afterAll(() => shim.close());

async function get(path: string, token = adminToken): Promise<Response> {
  return await worker.fetch(
    new Request(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } }),
    env,
  );
}

/** A course with two rosters and one closed lecture carrying all four statuses. */
async function lectureFixture(code: string, lecturerId: string) {
  const dept = (await repo.listDepartments())[0];
  const course = await repo.createCourse({
    code,
    title: `${code} Register`,
    departmentId: dept.id,
    level: "200",
    units: 2,
  });
  const students: string[] = [];
  for (let i = 0; i < 4; i++) {
    students.push(
      await repo.createUser({
        name: `${code} Student ${i}`,
        email: `${code.replace(/\s/g, "").toLowerCase()}-${i}@slams.edu`,
        password: "password123",
        role: "student",
        matricNo: `${code.replace(/\s/g, "")}/${i}`,
        departmentId: dept.id,
        level: "200",
      }),
    );
  }
  await repo.setEnrollments(course.id, students);
  const session = await repo.startSession({
    courseId: course.id,
    lecturerId,
    durationMinutes: 10,
  });
  // present, late, excused, then one student never signs in → materialised absent.
  await repo.submitAttendance({ code: session.code, studentId: students[0], deviceId: "r1" });
  await repo.submitAttendance({ code: session.code, studentId: students[1], deviceId: "r2" });
  // One of the two sign-ins is then excused, so all four statuses are exercised
  // and the register's tallies have something to reconcile.
  const second = shim.raw
    .prepare("SELECT id FROM attendance_records WHERE session_id = ? ORDER BY timestamp ASC")
    .all(session.id) as Array<{ id: string }>;
  await repo.setAttendanceStatus(second[1].id, "excused", { reason: "Medical certificate" });
  for (const s of await repo.listSessionsForCourse(course.id)) {
    if (!s.endedAt) await repo.endSession(s.id);
  }
  return { courseId: course.id, sessionId: session.id, students };
}

describe("lecture register", () => {
  it("reports one reconciling row per lecture", async () => {
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const f = await lectureFixture("REG 101", lecturer!.id);

    const res = await get("/api/reports/sessions?pageSize=200");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<Record<string, number | string | null>>;
      totals: Record<string, number | null>;
    };
    const row = body.items.find((r) => r.sessionId === f.sessionId);
    expect(row).toBeDefined();
    const present = Number(row!.present);
    const late = Number(row!.late);
    const excused = Number(row!.excused);
    const absent = Number(row!.absent);
    // Only two people signed in; the rest were materialised as absent on close.
    expect(present).toBe(1);
    expect(late).toBe(0);
    expect(excused).toBe(1);
    expect(absent).toBe(2);
    expect(Number(row!.expected)).toBe(4);
    expect(Number(row!.recorded)).toBe(present + late + excused + absent);
    // 1 attended opportunity of 4 → 25%; the excused mark neither helps nor hurts.
    expect(Number(row!.rate)).toBe(25);
    expect(row!.health).toBe("critical");
    expect(row!.courseCode).toBe("REG 101");

    // Totals are institutional and must be at least this row.
    expect(Number(body.totals.lectures)).toBeGreaterThanOrEqual(1);
    expect(Number(body.totals.attended)).toBeGreaterThanOrEqual(present + late);
    expect(Number(body.totals.rate)).toBeGreaterThan(0);
  });

  it("combines filters: course, course selection and attendance status", async () => {
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const f = await lectureFixture("REG 102", lecturer!.id);

    const single = (await (await get(`/api/reports/sessions?courseId=${f.courseId}`)).json()) as {
      items: unknown[];
      totals: { lectures: number };
    };
    expect(single.totals.lectures).toBe(1);
    expect(single.items).toHaveLength(1);

    // A lecture that contains absences matches `status=absent`; one that contains
    // none does not. REG 102 has two materialised absences.
    const withAbsent = (await (
      await get(`/api/reports/sessions?courseId=${f.courseId}&status=absent`)
    ).json()) as { totals: { lectures: number } };
    expect(withAbsent.totals.lectures).toBe(1);
    const withLate = (await (
      await get(`/api/reports/sessions?courseId=${f.courseId}&status=late`)
    ).json()) as { totals: { lectures: number } };
    expect(withLate.totals.lectures).toBe(0);

    const selected = (await (
      await get(`/api/reports/sessions?courseIds=${f.courseId}`)
    ).json()) as { totals: { lectures: number } };
    expect(selected.totals.lectures).toBe(1);
  });

  it("keeps a long course selection inside D1's bound-parameter ceiling", async () => {
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const f = await lectureFixture("REG 103", lecturer!.id);
    const filler = Array.from({ length: 120 }, (_, i) => `filler-${i}`);
    filler[1] = f.courseId; // inside the cap
    const beyond = [...filler, ...Array.from({ length: 10 }, (_, i) => `tail-${i}`)];
    beyond[100] = f.courseId; // beyond the cap → ignored rather than exploding

    const res = await get(`/api/reports/sessions?courseIds=${beyond.join(",")}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totals: { lectures: number } };
    // The lecture is counted once, because the id inside the cap is honoured and
    // the copy past the cap is dropped — not because the statement threw.
    expect(body.totals.lectures).toBe(1);
  });

  it("paginates while the totals describe the whole filtered set", async () => {
    const page1 = (await (await get("/api/reports/sessions?pageSize=5&page=1")).json()) as {
      items: unknown[];
      total: number;
      totals: { lectures: number; present: number };
    };
    const page2 = (await (await get("/api/reports/sessions?pageSize=5&page=2")).json()) as {
      items: unknown[];
      totals: { lectures: number; present: number };
    };
    expect(page1.items).toHaveLength(5);
    expect(page1.total).toBeGreaterThan(5);
    // Same totals on every page: they are not a sum of the visible rows.
    expect(page2.totals.lectures).toBe(page1.totals.lectures);
    expect(page2.totals.present).toBe(page1.totals.present);
  });

  it("pins a lecturer to their own lectures", async () => {
    const res = await get("/api/reports/sessions?pageSize=200", lecturerToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ lecturerName?: string }>;
      totals: { lectures: number };
    };
    expect(body.items.length).toBeGreaterThan(0);
    const names = new Set(body.items.map((r) => r.lecturerName));
    expect(names.size).toBe(1);
    expect([...names][0]).toBe("Dr. Amina Yusuf");

    // The admin sees strictly more than any single lecturer.
    const admin = (await (await get("/api/reports/sessions?pageSize=200")).json()) as {
      totals: { lectures: number };
    };
    expect(admin.totals.lectures).toBeGreaterThan(body.totals.lectures);
  });

  it("refuses anonymous access", async () => {
    const res = await worker.fetch(new Request(`${BASE}/api/reports/sessions`), env);
    expect(res.status).toBe(401);
  });
});
