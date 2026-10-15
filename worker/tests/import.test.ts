// Phase 5.4 — bulk CSV import (plan P5.4 / decision D8).
//
// The import's whole value is that it is safe to re-run and safe to trust: a
// registrar imports the same file twice because the first run half-finished, or
// imports a file with one bad row among four hundred. What these tests pin:
//   * preview and apply validate identically (a green preview cannot launder bad
//     data into the database);
//   * duplicate people are linked/skipped, never duplicated;
//   * hard errors stop the whole file — nothing is partially applied;
//   * marks import against the paper's maximum and update on re-run;
//   * a lecturer may import marks for their own course but not people.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import { getRepo, type Repo } from "../src/db";
import worker from "../src/index";
import type { Env } from "../src/index";

const SECRET = "import-test-secret-0123456789";
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

function countUsers(email: string): number {
  return (
    shim.raw.prepare("SELECT COUNT(*) AS c FROM users WHERE email = ?").get(email) as { c: number }
  ).c;
}

describe("preview", () => {
  it("accepts a well-formed student file and reports every row as ok", async () => {
    const csv = [
      "Name,Email,Matric No,Department,Level",
      "Ada Import,ada.import@slams.edu,CSC/22/9001,CSC,200",
      "Bola Import,bola.import@slams.edu,CSC/22/9002,CSC,200",
    ].join("\n");
    const res = await call("POST", "/api/import/preview", {
      token: adminToken,
      body: { kind: "students", csv },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { total: number; valid: number; errors: number; duplicates: number };
      ready: boolean;
      expected: string[];
    };
    expect(body.summary.valid).toBe(2);
    expect(body.summary.errors).toBe(0);
    expect(body.ready).toBe(true);
    expect(body.expected).toContain("matric no");
  });

  it("names the offending line for every kind of bad row", async () => {
    const csv = [
      "Name,Email,Matric No,Department,Level",
      "Good One,good.one@slams.edu,CSC/22/9101,CSC,200",
      "No Email,,CSC/22/9102,CSC,200",
      "Bad Email,not-an-email,CSC/22/9103,CSC,200",
      "Bad Dept,dept@slams.edu,CSC/22/9104,NOPE,200",
      "No Matric,matric@slams.edu,,CSC,200",
      ",blank@slams.edu,CSC/22/9105,CSC,200",
    ].join("\n");
    const res = await call("POST", "/api/import/preview", {
      token: adminToken,
      body: { kind: "students", csv },
    });
    const body = (await res.json()) as {
      rows: Array<{ line: number; status: string; message?: string }>;
      summary: { errors: number; valid: number };
      ready: boolean;
    };
    expect(body.summary.valid).toBe(1);
    expect(body.summary.errors).toBe(5);
    expect(body.ready).toBe(false);
    const byLine = new Map(body.rows.map((r) => [r.line, r]));
    expect(byLine.get(2)?.status).toBe("ok");
    expect(byLine.get(3)?.message).toMatch(/email address/);
    expect(byLine.get(4)?.message).toMatch(/email address/);
    expect(byLine.get(5)?.message).toMatch(/Unknown department/);
    expect(byLine.get(6)?.message).toMatch(/matric number/i);
    expect(byLine.get(7)?.message).toMatch(/name is required/i);
  });

  it("flags rows repeated inside the file and accounts that already exist", async () => {
    const csv = [
      "name,email,matric no,department,level",
      "Ada Import,ada.import@slams.edu,CSC/22/9001,CSC,200", // already imported? not yet
      "Twin A,twin@slams.edu,CSC/22/9201,CSC,200",
      "Twin B,twin@slams.edu,CSC/22/9202,CSC,200",
      "Duplicate Matric,twin2@slams.edu,CSC/22/9201,CSC,200",
      "Existing Admin,admin@slams.edu,CSC/22/9203,CSC,300",
    ].join("\n");
    const res = await call("POST", "/api/import/preview", {
      token: adminToken,
      body: { kind: "students", csv },
    });
    const body = (await res.json()) as {
      rows: Array<{ line: number; status: string; message?: string }>;
      summary: { valid: number; duplicates: number };
      ready: boolean;
    };
    const byLine = new Map(body.rows.map((r) => [r.line, r]));
    expect(byLine.get(3)?.status).toBe("ok"); // first sighting of both keys
    expect(byLine.get(4)?.status).toBe("duplicate"); // twin email within the file
    expect(byLine.get(5)?.status).toBe("duplicate"); // same matric twice in the file
    expect(byLine.get(6)?.message).toMatch(/already exists/);
    // Duplicates do not block the import: they are skipped, which is what makes
    // a re-run safe.
    expect(body.ready).toBe(true);
    expect(body.summary.duplicates).toBe(3);
  });
});

describe("apply", () => {
  it("creates the valid rows, then links them on a second run instead of duplicating", async () => {
    const csv = [
      "Name,Email,Matric No,Department,Level",
      "Ada Import,ada.import@slams.edu,CSC/22/9001,CSC,200",
      "Bola Import,bola.import@slams.edu,CSC/22/9002,CSC,200",
    ].join("\n");
    const first = await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "students", csv },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { created: number; skipped: number };
    expect(firstBody.created).toBe(2);
    expect(countUsers("ada.import@slams.edu")).toBe(1);

    const second = await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "students", csv },
    });
    const secondBody = (await second.json()) as { created: number; skipped: number };
    expect(secondBody.created).toBe(0);
    expect(secondBody.skipped).toBe(2);
    expect(countUsers("ada.import@slams.edu")).toBe(1);
  });

  it("creates a usable account: the imported student can sign in", async () => {
    const csv = [
      "name,email,matric no,department,level",
      "Login Test,login.test@slams.edu,CSC/22/9301,CSC,200",
    ].join("\r\n");
    await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "students", csv, defaultPassword: "imported-pass-1" },
    });
    const res = await call("POST", "/api/auth/login", {
      body: { email: "login.test@slams.edu", password: "imported-pass-1" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { role: string } };
    expect(body.user.role).toBe("student");
  });

  it("applies nothing when any row has a hard error", async () => {
    const before = countUsers("clean.row@slams.edu");
    const csv = [
      "name,email,matric no,department,level",
      "Clean Row,clean.row@slams.edu,CSC/22/9401,CSC,200",
      "Bad Matrix,bad.dept@slams.edu,CSC/22/9403,NOPE,200",
    ].join("\n");
    const res = await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "students", csv },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/line 3/);
    // The good row must not have landed: the batch never ran.
    expect(countUsers("clean.row@slams.edu")).toBe(before);
    expect(countUsers("bad.dept@slams.edu")).toBe(0);
  });

  it("enrols a roster by matric number, skipping students already on the course", async () => {
    const course = await repo.createCourse({
      code: "IMP 101",
      title: "Import Enrolments",
      departmentId: (await repo.listDepartments())[0].id,
      level: "200",
      units: 2,
    });
    const csv = ["Matric No", "CSC/22/9001", "CSC/22/9002", "CSC/22/9001"].join("\n");
    const res = await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "enrollments", csv, courseId: course.id },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { linked: number; skipped: number };
    expect(body.linked).toBe(2);
    expect(body.skipped).toBe(1); // the repeat inside the file
    const roster = await repo.listEnrollments(course.id);
    expect(roster).toHaveLength(2);

    // Re-running the same file links nobody new.
    const again = await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "enrollments", csv, courseId: course.id },
    });
    const againBody = (await again.json()) as { linked: number; skipped: number };
    expect(againBody.linked).toBe(0);
    expect(againBody.skipped).toBe(3);
    expect(await repo.listEnrollments(course.id)).toHaveLength(2);
  });

  it("imports marks against the paper's maximum and updates them on re-run", async () => {
    const course = await repo.createCourse({
      code: "IMP 102",
      title: "Import Marks",
      departmentId: (await repo.listDepartments())[0].id,
      level: "200",
      units: 2,
    });
    const exam = await repo.createExam({ courseId: course.id, title: "Imported CA", maxScore: 20 });
    const csv = ["Matric No,Score", "CSC/22/9301,17", "CSC/22/9001,12"].join("\n");
    const first = await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "results", csv, examId: exam.id },
    });
    expect(first.status).toBe(200);
    const marks = await repo.listResults(exam.id);
    expect(marks).toHaveLength(2);
    const top = marks.find((m) => m.score === 17)!;
    expect(top.grade).toBe("A"); // 85% of 20 — graded, not stored as 85
    expect(marks.every((m) => m.score != null && m.score <= 20)).toBe(true);

    // A corrected file updates in place; it does not add a third mark.
    const corrected = ["Matric No,Score", "CSC/22/9301,19", "CSC/22/9001,9"].join("\n");
    await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "results", csv: corrected, examId: exam.id },
    });
    const after = await repo.listResults(exam.id);
    expect(after).toHaveLength(2);
    expect(after.find((m) => m.studentId === top.studentId)!.score).toBe(19);
  });

  it("rejects a mark above the paper's maximum, and an unknown matric number", async () => {
    const course = await repo.createCourse({
      code: "IMP 103",
      title: "Import Bounds",
      departmentId: (await repo.listDepartments())[0].id,
      level: "200",
      units: 2,
    });
    const exam = await repo.createExam({ courseId: course.id, title: "Bounds", maxScore: 50 });
    const tooHigh = await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "results", csv: "Matric No,Score\nCSC/22/9301,75", examId: exam.id },
    });
    expect(tooHigh.status).toBe(400);
    const unknown = await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "results", csv: "Matric No,Score\nNOPE/00/0000,10", examId: exam.id },
    });
    expect(unknown.status).toBe(400);
    expect(await repo.listResults(exam.id)).toHaveLength(0);
  });

  it("audits what was imported", async () => {
    const csv = [
      "name,email,matric no,department,level",
      "Audit Import,audit.import@slams.edu,CSC/22/9501,CSC,200",
    ].join("\n");
    await call("POST", "/api/import/apply", {
      token: adminToken,
      body: { kind: "students", csv },
    });
    const row = shim.raw
      .prepare(
        "SELECT reason, actor_email FROM audit_log WHERE action = 'import.apply' ORDER BY created_at DESC LIMIT 1",
      )
      .get() as { reason: string; actor_email: string };
    expect(row.reason).toContain("students");
    expect(row.reason).toContain("1 created");
    expect(row.actor_email).toBe("admin@slams.edu");
  });
});

describe("permissions", () => {
  it("lets a lecturer import marks for their own course but not people", async () => {
    const dept = (await repo.listDepartments())[0];
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const course = await repo.createCourse({
      code: "IMP 104",
      title: "Owned",
      departmentId: dept.id,
      level: "200",
      units: 2,
    });
    await repo.assignLecturer(course.id, lecturer!.id);
    const exam = await repo.createExam({ courseId: course.id, title: "Mine" });

    const people = await call("POST", "/api/import/apply", {
      token: lecturerToken,
      body: {
        kind: "students",
        csv: "name,email,matric no\nSneaky,sneaky@slams.edu,CSC/22/9601",
      },
    });
    expect(people.status).toBe(403);

    const marks = await call("POST", "/api/import/apply", {
      token: lecturerToken,
      body: { kind: "results", csv: "Matric No,Score\nCSC/22/9301,10", examId: exam.id },
    });
    expect(marks.status).toBe(200);

    // A course they do not teach is refused.
    const foreign = await repo.createCourse({
      code: "IMP 105",
      title: "Not owned",
      departmentId: dept.id,
      level: "200",
      units: 2,
    });
    const foreignExam = await repo.createExam({ courseId: foreign.id, title: "Theirs" });
    const refused = await call("POST", "/api/import/apply", {
      token: lecturerToken,
      body: { kind: "results", csv: "Matric No,Score\nCSC/22/9301,10", examId: foreignExam.id },
    });
    expect(refused.status).toBe(403);
  });

  it("requires authentication and serves a template for each kind", async () => {
    const anon = await call("POST", "/api/import/preview", {
      body: { kind: "students", csv: "a" },
    });
    expect(anon.status).toBe(401);

    const res = await call("GET", "/api/import/template?kind=students", { token: adminToken });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Matric No");
    expect(text).toContain("Department");

    const bad = await call("GET", "/api/import/template?kind=nonsense", { token: adminToken });
    expect(bad.status).toBe(400);
  });
});
