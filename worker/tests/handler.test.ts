import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import worker from "../src/index";
import type { Env } from "../src/index";

const SECRET = "handler-test-secret-0123456789";
const BASE = "https://api.test";

interface Harness {
  env: Env;
  raw: D1Shim["raw"];
  close(): void;
  call(
    method: string,
    path: string,
    opts?: { token?: string; body?: unknown; origin?: string; ip?: string },
  ): Promise<Response>;
  login(email: string, password?: string, ip?: string): Promise<{ status: number; json: unknown }>;
}

function makeHarness(allowedOrigins = ""): Harness {
  const shim = createD1Shim();
  applyMigrations(shim.raw);
  const env: Env = { DB: shim.db, SLAMS_JWT_SECRET: SECRET, ALLOWED_ORIGINS: allowedOrigins };

  async function call(
    method: string,
    path: string,
    opts?: { token?: string; body?: unknown; origin?: string; ip?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts?.token) headers["authorization"] = `Bearer ${opts.token}`;
    if (opts?.origin) headers["origin"] = opts.origin;
    if (opts?.ip) headers["cf-connecting-ip"] = opts.ip;
    return await worker.fetch(
      new Request(`${BASE}${path}`, {
        method,
        headers,
        body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
      env,
    );
  }

  return {
    env,
    raw: shim.raw,
    close: shim.close,
    call,
    async login(email, password = "password123", ip = "203.0.113.1") {
      const res = await call("POST", "/api/auth/login", { body: { email, password }, ip });
      return { status: res.status, json: await res.json() };
    },
  };
}

function userOf(json: unknown) {
  return (json as { user?: { id: string; role: string } }).user!;
}
function tokenOf(json: unknown) {
  return (json as { token?: string }).token!;
}

describe("worker handler (integration)", () => {
  let h: Harness;
  let adminToken: string;
  let lecturerToken: string;
  let studentToken: string;
  let lecturerId: string;
  let otherLecturerId: string;
  let courseA: { id: string }; // owned by demo lecturer
  let courseB: { id: string }; // owned by a second lecturer

  beforeAll(async () => {
    h = makeHarness();
    const admin = await h.login("admin@slams.edu");
    expect(admin.status).toBe(200);
    adminToken = tokenOf(admin.json);
    const lec = await h.login("lecturer@slams.edu");
    lecturerToken = tokenOf(lec.json);
    lecturerId = userOf(lec.json).id;
    const stu = await h.login("student@slams.edu");
    studentToken = tokenOf(stu.json);

    // Set up a second lecturer with their own course so IDOR checks are testable.
    const dept = await h.call("GET", "/api/departments", { token: adminToken });
    const depts = (await dept.json()) as Array<{ id: string; code: string }>;
    const csc = depts.find((d) => d.code === "CSC")!;
    const created = await h.call("POST", "/api/users", {
      token: adminToken,
      body: {
        role: "lecturer",
        name: "Second Lecturer",
        email: "second@slams.edu",
        staffId: "STF-9999",
        departmentId: csc.id,
        password: "second-pass-1",
      },
    });
    expect(created.status).toBe(201);
    otherLecturerId = ((await await created.json()) as { id: string }).id;
    const otherLec = await h.login("second@slams.edu", "second-pass-1", "203.0.113.2");
    const courseBRes = await h.call("POST", "/api/courses", {
      token: adminToken,
      body: {
        code: "CSC 777",
        title: "Second Lecturer Course",
        departmentId: csc.id,
        level: "300",
        units: 3,
      },
    });
    expect(courseBRes.status).toBe(201);
    courseB = await courseBRes.json();
    await h.call("PATCH", `/api/courses/${courseB.id}/lecturer`, {
      token: adminToken,
      body: { lecturerId: otherLecturerId },
    });

    const coursesRes = await h.call("GET", "/api/courses", { token: lecturerToken });
    const courses = (await coursesRes.json()) as Array<{ id: string; lecturerId?: string }>;
    courseA = courses.find((c) => c.lecturerId === lecturerId)!;
    void otherLec;
  });
  afterAll(() => h.close());

  it("serves /api/health", async () => {
    const res = await h.call("GET", "/api/health");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("serves public settings without auth and hides internal fields", async () => {
    const res = await h.call("GET", "/api/public/settings");
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.institutionName).toBeTruthy();
    expect(s.atRiskThreshold).toBeUndefined(); // not public
  });

  it("rejects unknown routes with 404 JSON", async () => {
    const res = await h.call("GET", "/api/nope", { token: adminToken });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("requires auth on protected routes", async () => {
    const res = await h.call("GET", "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("auth/me returns the caller", async () => {
    const res = await h.call("GET", "/api/auth/me", { token: adminToken });
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("admin");
  });

  it("returns 403 when role is not allowed", async () => {
    const res = await h.call("GET", "/api/admin/overview", { token: studentToken });
    expect(res.status).toBe(403);
    const res2 = await h.call("GET", "/api/users", { token: lecturerToken });
    expect(res2.status).toBe(403);
  });

  it("rate-limits repeated failed logins per IP", async () => {
    const ip = "198.51.100.99";
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await h.call("POST", "/api/auth/login", {
        body: { email: "admin@slams.edu", password: "wrong" },
        ip,
      });
      last = res.status;
      if (res.status === 429) break;
    }
    expect(last).toBe(429);
  });

  it("validates login input", async () => {
    const res = await h.call("POST", "/api/auth/login", {
      body: { email: "not-an-email", password: "x" },
      ip: "203.0.113.9",
    });
    expect(res.status).toBe(400);
  });

  it("enforces IDOR: lecturer cannot read another lecturer's sessions or reports", async () => {
    // Start a session on course B (owned by otherLecturer).
    const startRes = await h.call("POST", "/api/sessions", {
      token: await tokenFor("second@slams.edu", "second-pass-1"),
      body: { courseId: courseB.id, durationMinutes: 15 },
    });
    expect(startRes.status).toBe(201);
    const session = (await startRes.json()) as { id: string };

    const forbidden = await h.call("GET", `/api/sessions/${session.id}`, { token: lecturerToken });
    expect(forbidden.status).toBe(403);

    const reportForbidden = await h.call("GET", `/api/reports/course/${courseB.id}`, {
      token: lecturerToken,
    });
    expect(reportForbidden.status).toBe(403);

    const sessionsForbidden = await h.call("GET", `/api/courses/${courseB.id}/sessions`, {
      token: lecturerToken,
    });
    expect(sessionsForbidden.status).toBe(403);

    // But the owner can.
    const ok = await h.call("GET", `/api/sessions/${session.id}`, {
      token: await tokenFor("second@slams.edu", "second-pass-1"),
    });
    expect(ok.status).toBe(200);
    await h.call("POST", `/api/sessions/${session.id}/end`, {
      token: await tokenFor("second@slams.edu", "second-pass-1"),
    });
  });

  async function tokenFor(email: string, password: string): Promise<string> {
    const r = await h.login(email, password, "203.0.113.3");
    expect(r.status).toBe(200);
    return tokenOf(r.json);
  }

  it("enforces course ownership when starting sessions", async () => {
    const res = await h.call("POST", "/api/sessions", {
      token: lecturerToken,
      body: { courseId: courseB.id, durationMinutes: 15 },
    });
    expect(res.status).toBe(403);
  });

  it("students cannot access admin or lecturer endpoints", async () => {
    expect(
      (
        await h.call("POST", "/api/users", {
          token: studentToken,
          body: {
            role: "student",
            name: "Hacker",
            email: "h@x.edu",
            matricNo: "M1",
            departmentId: "x",
            level: "100",
            password: "pass-1234",
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (await h.call("DELETE", `/api/courses/${courseA.id}`, { token: studentToken })).status,
    ).toBe(403);
    expect(
      (await h.call("GET", `/api/reports/course/${courseA.id}`, { token: studentToken })).status,
    ).toBe(403);
  });

  it("attendance submission validates the code format", async () => {
    const res = await h.call("POST", "/api/attendance", {
      token: studentToken,
      body: { code: "12345" },
    });
    expect(res.status).toBe(400);
    const res2 = await h.call("POST", "/api/attendance", {
      token: studentToken,
      body: { code: "12ab34" },
    });
    expect(res2.status).toBe(400);
  });

  it("attendance submission works end-to-end for an enrolled student", async () => {
    const startRes = await h.call("POST", "/api/sessions", {
      token: lecturerToken,
      body: { courseId: courseA.id, durationMinutes: 10, topic: "Integration test" },
    });
    expect(startRes.status).toBe(201);
    const session = (await startRes.json()) as { id: string; code: string };

    const ok = await h.call("POST", "/api/attendance", {
      token: studentToken,
      body: { code: session.code },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { course: { code: string } };
    expect(body.course.code).toBe(courseA ? "CSC 305" : body.course.code);

    const dup = await h.call("POST", "/api/attendance", {
      token: studentToken,
      body: { code: session.code },
    });
    expect(dup.status).toBe(400);

    const detail = await h.call("GET", `/api/sessions/${session.id}`, { token: lecturerToken });
    expect(detail.status).toBe(200);
    const d = (await detail.json()) as { attendance: Array<{ matricNo: string }> };
    expect(d.attendance.length).toBe(1);

    // Lecturer can remove their own attendance record.
    const recId = d.attendance[0].matricNo; // (id is on the record too; use matric only as existence proof)
    void recId;
    const records = (await h.raw
      .prepare("SELECT id FROM attendance_records WHERE session_id = ?")
      .all(session.id)) as Array<{ id: string }>;
    const del = await h.call("DELETE", `/api/attendance/${records[0].id}`, {
      token: lecturerToken,
    });
    expect(del.status).toBe(200);
    await h.call("POST", `/api/sessions/${session.id}/end`, { token: lecturerToken });
  });

  it("CORS: enforces ALLOWED_ORIGINS when configured", async () => {
    const strict = makeHarness("https://allowed.example");
    try {
      const preflightBad = await strict.call("OPTIONS", "/api/health", {
        origin: "https://evil.example",
      });
      expect(preflightBad.status).toBe(403);

      const preflightOk = await strict.call("OPTIONS", "/api/health", {
        origin: "https://allowed.example",
      });
      expect(preflightOk.status).toBe(204);
      expect(preflightOk.headers.get("access-control-allow-origin")).toBe(
        "https://allowed.example",
      );

      const reqBad = await strict.call("GET", "/api/health", { origin: "https://evil.example" });
      expect(reqBad.status).toBe(403);

      const reqOk = await strict.call("GET", "/api/health", { origin: "https://allowed.example" });
      expect(reqOk.status).toBe(200);
      expect(reqOk.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    } finally {
      strict.close();
    }
  });

  it("sends security headers on responses", async () => {
    const res = await h.call("GET", "/api/health");
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("rejects oversized bodies", async () => {
    const big = "x".repeat(300 * 1024);
    const res = await h.call("POST", "/api/auth/login", {
      body: { email: "a@b.co", password: big },
      ip: "203.0.113.4",
    });
    expect(res.status).toBe(413);
  });

  it("deleting the last admin is blocked at the API layer", async () => {
    const me = await h.call("GET", "/api/auth/me", { token: adminToken });
    const admin = (await me.json()) as { id: string };
    const res = await h.call("DELETE", `/api/users/${admin.id}`, { token: adminToken });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/last administrator/);
  });

  it("successful logins do not consume the login rate limit", async () => {
    // Campuses share NAT IPs: only FAILED attempts may count, otherwise
    // legitimate users lock each other out.
    const ip = "198.51.100.77";
    for (let i = 0; i < 12; i++) {
      const res = await h.login("student@slams.edu", "password123", ip);
      expect(res.status).toBe(200);
    }
  });

  it("rejects partial geofence parameters when starting a session", async () => {
    const partial = await h.call("POST", "/api/sessions", {
      token: lecturerToken,
      body: { courseId: courseA.id, latitude: 9.05 },
    });
    expect(partial.status).toBe(400);
    expect(((await partial.json()) as { error: { message: string } }).error.message).toMatch(
      /latitude, longitude and radiusMeters/,
    );

    // A complete geofence is accepted (then closed to keep a clean state).
    const full = await h.call("POST", "/api/sessions", {
      token: lecturerToken,
      body: {
        courseId: courseA.id,
        durationMinutes: 15,
        latitude: 9.05,
        longitude: 7.49,
        radiusMeters: 150,
      },
    });
    expect(full.status).toBe(201);
    const created = (await full.json()) as { id: string };
    await h.call("POST", `/api/sessions/${created.id}/end`, { token: lecturerToken });
  });

  it("open-sessions feed never exposes the sign-in code", async () => {
    const started = await h.call("POST", "/api/sessions", {
      token: lecturerToken,
      body: { courseId: courseA.id, durationMinutes: 15 },
    });
    expect(started.status).toBe(201);
    const created = (await started.json()) as { id: string };

    const res = await h.call("GET", "/api/me/open-sessions", { token: studentToken });
    expect(res.status).toBe(200);
    const items = (await res.json()) as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    for (const o of items) {
      expect("code" in o).toBe(false);
      expect(o.sessionId).toBeTruthy();
      expect(o.expiresAt).toBeTruthy();
    }

    await h.call("POST", `/api/sessions/${created.id}/end`, { token: lecturerToken });
  });

  it("profile self-update works for admins (previously broken)", async () => {
    const res = await h.call("PATCH", "/api/users/profile", {
      token: adminToken,
      body: { name: "System Administrator 2", email: "admin@slams.edu" },
    });
    expect(res.status).toBe(200);
    const me = await h.call("GET", "/api/auth/me", { token: adminToken });
    expect((await me.json()).name).toBe("System Administrator 2");
    // revert
    await h.call("PATCH", "/api/users/profile", {
      token: adminToken,
      body: { name: "System Administrator", email: "admin@slams.edu" },
    });
  });
});
