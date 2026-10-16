// Phase 4.3 / 4.4 — examinations, results and the attendance×performance join.
//
// What matters here is not that CRUD works, but that the numbers cannot lie:
//   * a score is stored against the paper's own maximum, so re-weighting an
//     assessment cannot rewrite a published percentage;
//   * an unmarked script is excluded from averages — never averaged as a zero;
//   * publishing is the moment students learn their marks, and only an
//     administrator may do it;
//   * the analytics use the *same* opportunity-weighted attendance figure every
//     other page shows, and the barred-from-exam counts are derived from the
//     institution's own threshold and policy flag.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import { getRepo, type Repo } from "../src/db";
import worker from "../src/index";
import type { Env } from "../src/index";

const SECRET = "exams-test-secret-0123456789";
const BASE = "https://api.test";

let shim: D1Shim;
let repo: Repo;
let env: Env;
let adminToken = "";
let lecturerToken = "";
let studentToken = "";

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
  const studentEmail = (() => {
    const row = shim.raw
      .prepare("SELECT email FROM users WHERE role = 'student' ORDER BY name ASC LIMIT 1")
      .get() as { email: string };
    return row.email;
  })();
  studentToken = await login(studentEmail);
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

/** A course taught by the demo lecturer with four students and known attendance. */
async function fixture(code: string, attendancePerStudent: number[]) {
  const dept = (await repo.listDepartments())[0];
  const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
  const course = await repo.createCourse({
    code,
    title: `${code} Assessment`,
    departmentId: dept.id,
    level: "300",
    units: 3,
  });
  await repo.assignLecturer(course.id, lecturer!.id);
  const students: string[] = [];
  for (let i = 0; i < attendancePerStudent.length; i++) {
    students.push(
      await repo.createUser({
        name: `${code} Student ${i}`,
        email: `${code.replace(/\s/g, "").toLowerCase()}-s${i}@slams.edu`,
        password: "password123",
        role: "student",
        matricNo: `${code.replace(/\s/g, "")}/${i}`,
        departmentId: dept.id,
        level: "300",
      }),
    );
  }
  await repo.setEnrollments(course.id, students);

  // `attendancePerStudent[i]` lectures out of 4 → a known percentage per student.
  const LECTURES = 4;
  for (let lecture = 0; lecture < LECTURES; lecture++) {
    const session = await repo.startSession({
      courseId: course.id,
      lecturerId: lecturer!.id,
      durationMinutes: 10,
    });
    for (let i = 0; i < students.length; i++) {
      if (lecture < attendancePerStudent[i]) {
        await repo.submitAttendance({
          code: session.code,
          studentId: students[i],
          deviceId: `${code}-${lecture}`,
        });
      }
    }
    // Closing materialises absences for the students who did not sign in, which
    // is what makes the denominator 4 for everybody.
    await repo.endSession(session.id);
  }
  return { courseId: course.id, studentIds: students, lecturerId: lecturer!.id };
}

describe("exams & marks", () => {
  it("stores a score against the paper's maximum and derives the grade", async () => {
    const f = await fixture("EXM 101", [4, 4, 4, 4]);
    const exam = await repo.createExam({
      courseId: f.courseId,
      title: "CA 1",
      kind: "ca",
      maxScore: 20,
    });
    expect(exam.maxScore).toBe(20);
    await repo.saveResults(
      exam.id,
      [
        { studentId: f.studentIds[0], score: 14 }, // 70% → A
        { studentId: f.studentIds[1], score: 9 }, // 45% → D
        { studentId: f.studentIds[2], score: null }, // not marked
      ],
      f.lecturerId,
    );
    const marks = await repo.listResults(exam.id);
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    // A missing mark is absent from the table, not a zero row.
    expect(byStudent.has(f.studentIds[2])).toBe(false);
    expect(byStudent.get(f.studentIds[0])!.score).toBe(14);
    expect(byStudent.get(f.studentIds[0])!.grade).toBe("A");
    expect(byStudent.get(f.studentIds[1])!.grade).toBe("D");
  });

  it("upserts on re-save and clears a mark without writing a zero", async () => {
    const f = await fixture("EXM 102", [4, 4]);
    const exam = await repo.createExam({ courseId: f.courseId, title: "Test", maxScore: 50 });
    await repo.saveResults(exam.id, [{ studentId: f.studentIds[0], score: 30 }]);
    await repo.saveResults(exam.id, [{ studentId: f.studentIds[0], score: 45 }]);
    const after = (await repo.listResults(exam.id)).find((m) => m.studentId === f.studentIds[0]);
    expect(after!.score).toBe(45);
    expect(after!.grade).toBe("A"); // 90%

    const cleared = await repo.saveResults(exam.id, [
      { studentId: f.studentIds[0], score: null },
      { studentId: f.studentIds[1], score: 20 },
    ]);
    expect(cleared.cleared).toBe(1);
    expect(cleared.saved).toBe(1);
    const remaining = await repo.listResults(exam.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].studentId).toBe(f.studentIds[1]);
  });

  it("rejects a score above the maximum, and a lecturer cannot mark somebody else's course", async () => {
    const f = await fixture("EXM 103", [4]);
    const created = await call("POST", "/api/exams", {
      token: lecturerToken,
      body: { courseId: f.courseId, title: "Over-max test", maxScore: 20 },
    });
    expect(created.status).toBe(201);
    const exam = (await created.json()) as { id: string };

    const tooBig = await call("POST", `/api/exams/${exam.id}/results`, {
      token: lecturerToken,
      body: { rows: [{ studentId: f.studentIds[0], score: 25 }] },
    });
    expect(tooBig.status).toBe(400);

    // A course the demo lecturer does not teach: create one owned by nobody.
    const other = await repo.createCourse({
      code: "EXM 999",
      title: "Unowned",
      departmentId: (await repo.listDepartments())[0].id,
      level: "300",
      units: 1,
    });
    const foreignExam = await repo.createExam({ courseId: other.id, title: "Theirs" });
    const forbidden = await call("POST", `/api/exams/${foreignExam.id}/results`, {
      token: lecturerToken,
      body: { rows: [{ studentId: f.studentIds[0], score: 10 }] },
    });
    expect(forbidden.status).toBe(403);
  });

  it("only an administrator may publish, and students see nothing until then", async () => {
    const f = await fixture("EXM 104", [4]);
    const exam = await repo.createExam({ courseId: f.courseId, title: "Publishable" });
    await repo.saveResults(exam.id, [{ studentId: f.studentIds[0], score: 88 }], f.lecturerId);

    const studentOf = shim.raw
      .prepare("SELECT email FROM users WHERE id = ?")
      .get(f.studentIds[0]) as { email: string };
    const login = async (email: string) => {
      const res = await call("POST", "/api/auth/login", {
        body: { email, password: "password123" },
      });
      return ((await res.json()) as { token: string }).token;
    };
    const token = await login(studentOf.email);

    const before = await call("GET", `/api/exams/${exam.id}`, { token });
    expect(before.status).toBe(403);

    const lecturerPublish = await call("PATCH", `/api/exams/${exam.id}`, {
      token: lecturerToken,
      body: { published: true },
    });
    expect(lecturerPublish.status).toBe(403);

    const adminPublish = await call("PATCH", `/api/exams/${exam.id}`, {
      token: adminToken,
      body: { published: true },
    });
    expect(adminPublish.status).toBe(200);

    const after = await call("GET", `/api/exams/${exam.id}`, { token });
    expect(after.status).toBe(200);
    const body = (await after.json()) as { results: unknown[] };
    // The student sees their own mark and nobody else's.
    expect(body.results).toHaveLength(1);
  });

  it("notifies a student when a published mark is recorded", async () => {
    const f = await fixture("EXM 105", [4]);
    const exam = await repo.createExam({ courseId: f.courseId, title: "Published CA" });
    await call("PATCH", `/api/exams/${exam.id}`, { token: adminToken, body: { published: true } });
    const res = await call("POST", `/api/exams/${exam.id}/results`, {
      token: adminToken,
      body: { rows: [{ studentId: f.studentIds[0], score: 61 }] },
    });
    expect(res.status).toBe(200);
    const page = await repo.notificationsFor(f.studentIds[0]);
    const notice = page.items.find((n) => n.kind === "result.published");
    expect(notice).toBeDefined();
    expect(notice!.title).toContain("61");
  });

  it("audits scheduling, marking, publishing and deletion", async () => {
    const f = await fixture("EXM 106", [4]);
    const created = await call("POST", "/api/exams", {
      token: adminToken,
      body: { courseId: f.courseId, title: "Audited CA", maxScore: 100 },
    });
    const exam = (await created.json()) as { id: string };
    await call("POST", `/api/exams/${exam.id}/results`, {
      token: adminToken,
      body: { rows: [{ studentId: f.studentIds[0], score: 70 }] },
    });
    await call("PATCH", `/api/exams/${exam.id}`, { token: adminToken, body: { published: true } });
    const removed = await call("DELETE", `/api/exams/${exam.id}`, { token: adminToken });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { removed: number }).removed).toBe(1);

    const actions = (
      shim.raw
        .prepare("SELECT DISTINCT action FROM audit_log WHERE entity_id = ?")
        .all(exam.id) as Array<{ action: string }>
    ).map((r) => r.action);
    expect(actions).toContain("exam.create");
    expect(actions).toContain("result.save");
    expect(actions).toContain("exam.update");
    expect(actions).toContain("exam.delete");
  });

  it("deleting an exam takes its marks with it and leaves no orphans", async () => {
    const f = await fixture("EXM 107", [4, 4]);
    const exam = await repo.createExam({ courseId: f.courseId, title: "Doomed" });
    await repo.saveResults(exam.id, [
      { studentId: f.studentIds[0], score: 50 },
      { studentId: f.studentIds[1], score: 60 },
    ]);
    expect(await repo.deleteExam(exam.id)).toBe(2);
    expect(await repo.getExam(exam.id)).toBeUndefined();
    const orphans = shim.raw
      .prepare("SELECT COUNT(*) AS c FROM results WHERE exam_id = ?")
      .get(exam.id) as { c: number };
    expect(orphans.c).toBe(0);
  });
});

describe("attendance × performance analytics", () => {
  it("joins the opportunity-weighted attendance with the weighted final score", async () => {
    // Attendance: 4/4, 3/4, 1/4, 0/4 → 100%, 75%, 25%, 0%.
    const f = await fixture("ANL 101", [4, 3, 1, 0]);
    const report = await repo.courseReport(f.courseId, {});
    const byAttendance = new Map(report!.students.map((s) => [s.id, s.percentage]));
    expect(byAttendance.get(f.studentIds[0])).toBe(100);
    expect(byAttendance.get(f.studentIds[1])).toBe(75);
    expect(byAttendance.get(f.studentIds[2])).toBe(25);
    expect(byAttendance.get(f.studentIds[3])).toBe(0);

    const ca = await repo.createExam({
      courseId: f.courseId,
      title: "CA",
      maxScore: 20,
      weight: 30,
    });
    const exam = await repo.createExam({
      courseId: f.courseId,
      title: "Exam",
      maxScore: 100,
      weight: 70,
    });
    await repo.saveResults(ca.id, [
      { studentId: f.studentIds[0], score: 16 }, // 80%
      { studentId: f.studentIds[1], score: 12 }, // 60%
      { studentId: f.studentIds[2], score: 8 }, // 40%
      { studentId: f.studentIds[3], score: 4 }, // 20%
    ]);
    await repo.saveResults(exam.id, [
      { studentId: f.studentIds[0], score: 90 },
      { studentId: f.studentIds[1], score: 70 },
      { studentId: f.studentIds[2], score: 30 },
      { studentId: f.studentIds[3], score: 10 },
    ]);

    const analytics = await repo.resultAnalytics(f.courseId, {});
    expect(analytics).toBeDefined();
    const rows = new Map(analytics!.rows.map((r) => [r.studentId, r]));
    // Weighted: 0.3 × 80 + 0.7 × 90 = 87 — not the unweighted 85.
    expect(rows.get(f.studentIds[0])!.finalPercent).toBe(87);
    expect(rows.get(f.studentIds[0])!.letterGrade).toBe("A");
    expect(rows.get(f.studentIds[1])!.finalPercent).toBe(67);
    expect(rows.get(f.studentIds[2])!.finalPercent).toBe(33);
    expect(rows.get(f.studentIds[3])!.finalPercent).toBe(13);

    // The attendance half is the same number the course page reports.
    expect(rows.get(f.studentIds[1])!.attendanceRate).toBe(75);
    expect(analytics!.exams).toHaveLength(2);
    expect(analytics!.summary.students).toBe(4);
    expect(analytics!.summary.correlation).not.toBeNull();
  });

  it("excludes unmarked students from the means instead of scoring them zero", async () => {
    const f = await fixture("ANL 102", [4, 4, 4]);
    const exam = await repo.createExam({ courseId: f.courseId, title: "Half marked" });
    await repo.saveResults(exam.id, [
      { studentId: f.studentIds[0], score: 80 },
      { studentId: f.studentIds[1], score: 60 },
      // student 3 never marked
    ]);
    const analytics = await repo.resultAnalytics(f.courseId, {});
    const unmarked = analytics!.rows.find((r) => r.studentId === f.studentIds[2]);
    expect(unmarked!.finalPercent).toBeNull();
    expect(unmarked!.letterGrade).toBeUndefined();
    // Mean over the two marked students is 70, not (80+60+0)/3 = 46.7.
    expect(analytics!.summary.meanAbove).toBe(70);
  });

  it("counts the students the attendance policy actually changes the outcome for", async () => {
    // 1/4 = 25% attendance but a high score, and 4/4 with a low score.
    const f = await fixture("ANL 103", [1, 4]);
    const exam = await repo.createExam({ courseId: f.courseId, title: "Policy" });
    await repo.saveResults(exam.id, [
      { studentId: f.studentIds[0], score: 90 }, // strong student, poor attendance
      { studentId: f.studentIds[1], score: 30 }, // attending, failing
    ]);

    // Policy off by default: reported, not enforced.
    const loose = await repo.resultAnalytics(f.courseId, {});
    expect(loose!.policyEnabled).toBe(false);
    expect(loose!.rows.find((r) => r.studentId === f.studentIds[0])!.barred).toBe(false);
    expect(loose!.summary.barredButPassing).toBe(0);

    await repo.saveSiteSettings({ barredFromExamBelowThreshold: true });
    const strict = await repo.resultAnalytics(f.courseId, {});
    expect(strict!.policyEnabled).toBe(true);
    const barred = strict!.rows.find((r) => r.studentId === f.studentIds[0])!;
    expect(barred.barred).toBe(true);
    expect(strict!.summary.barred).toBe(1);
    // The student above is a pass on score alone, so the policy changes their result.
    expect(strict!.summary.barredButPassing).toBe(1);
    // And the student who attends but fails is not counted as barred.
    const failing = strict!.rows.find((r) => r.studentId === f.studentIds[1])!;
    expect(failing.barred).toBe(false);
  });

  it("serves the analytics over HTTP to the course's lecturer, and refuses others", async () => {
    const f = await fixture("ANL 104", [4, 4]);
    const exam = await repo.createExam({ courseId: f.courseId, title: "HTTP" });
    await repo.saveResults(exam.id, [
      { studentId: f.studentIds[0], score: 50 },
      { studentId: f.studentIds[1], score: 70 },
    ]);
    const mine = await call("GET", `/api/reports/courses/${f.courseId}/analytics`, {
      token: lecturerToken,
    });
    expect(mine.status).toBe(200);
    const body = (await mine.json()) as { rows: unknown[]; threshold: number };
    expect(body.rows).toHaveLength(2);
    expect(body.threshold).toBeGreaterThan(0);

    const anon = await call("GET", `/api/reports/courses/${f.courseId}/analytics`);
    expect(anon.status).toBe(401);

    const asStudent = await call("GET", `/api/reports/courses/${f.courseId}/analytics`, {
      token: studentToken,
    });
    expect(asStudent.status).toBe(403);

    // A course the lecturer does not own is refused even for reading.
    const other = await repo.createCourse({
      code: "ANL 999",
      title: "Not mine",
      departmentId: (await repo.listDepartments())[0].id,
      level: "300",
      units: 1,
    });
    const foreign = await call("GET", `/api/reports/courses/${other.id}/analytics`, {
      token: lecturerToken,
    });
    expect(foreign.status).toBe(403);
  });
});
