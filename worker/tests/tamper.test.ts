import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import worker from "../src/index";
import type { Env } from "../src/index";
import { getRepo } from "../src/db";
import { buildLocationEvidence, verifyLocationEvidence } from "../src/evidence";

const SECRET = "tamper-test-secret-0123456789";
const BASE = "https://api.test";

interface Harness {
  env: Env;
  raw: D1Shim["raw"];
  close(): void;
  call(
    method: string,
    path: string,
    opts?: { token?: string; body?: unknown; ip?: string; cf?: Record<string, unknown> },
  ): Promise<Response>;
  login(email: string, password?: string): Promise<{ status: number; json: unknown }>;
}

function makeHarness(): Harness {
  const shim = createD1Shim();
  applyMigrations(shim.raw);
  const env: Env = { DB: shim.db, SLAMS_JWT_SECRET: SECRET, ALLOWED_ORIGINS: "" };

  async function call(
    method: string,
    path: string,
    opts?: { token?: string; body?: unknown; ip?: string; cf?: Record<string, unknown> },
  ): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts?.token) headers["authorization"] = `Bearer ${opts.token}`;
    if (opts?.ip) headers["cf-connecting-ip"] = opts.ip;
    const request = new Request(`${BASE}${path}`, {
      method,
      headers,
      body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    // Emulate `request.cf` (Cloudflare client-city geolocation), which Node's
    // undici Request does not provide.
    if (opts?.cf) Object.defineProperty(request, "cf", { value: opts.cf, configurable: true });
    return await worker.fetch(request, env);
  }

  return {
    env,
    raw: shim.raw,
    close: shim.close,
    call,
    async login(email, password = "password123") {
      const res = await call("POST", "/api/auth/login", { body: { email, password } });
      return { status: res.status, json: await res.json() };
    },
  };
}

function tokenOf(json: unknown): string {
  return (json as { token?: string }).token!;
}

describe("tamper-proofing (Phase 2)", () => {
  let h: Harness;
  beforeAll(() => {
    h = makeHarness();
  });
  afterAll(() => h.close());

  it("evidence digests verify (and reject tampering)", async () => {
    const secret = new TextEncoder().encode("a-very-secret-key-0123456789abcdef");
    const claim = {
      studentId: "stud-1",
      code: "123456",
      latitude: 6.5,
      longitude: 3.4,
      clientTime: 1700000000000,
      deviceId: "dev-abc",
    };
    const evidence = await buildLocationEvidence(secret, claim);
    expect(evidence).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyLocationEvidence(secret, claim, evidence)).toBe(true);
    expect(await verifyLocationEvidence(secret, { ...claim, latitude: 6.51 }, evidence)).toBe(
      false,
    );
  });

  it("venue-locked session rejects a student who submits no GPS (network fallback absent)", async () => {
    const lec = await h.login("lecturer@slams.edu");
    const stu = await h.login("student@slams.edu");
    const lecToken = tokenOf(lec.json);
    const stuToken = tokenOf(stu.json);

    const courses = (await (
      await h.call("GET", "/api/lecturer/courses", { token: lecToken })
    ).json()) as Array<{ id: string }>;
    const start = await h.call("POST", "/api/sessions", {
      token: lecToken,
      body: {
        courseId: courses[0].id,
        durationMinutes: 10,
        latitude: 6.5,
        longitude: 3.4,
        radiusMeters: 150,
      },
    });
    expect(start.status).toBe(201);
    const session = (await start.json()) as { id: string; code: string };

    // No GPS, and (with no request.cf) no network fallback → refused.
    const res = await h.call("POST", "/api/attendance", {
      token: stuToken,
      body: { code: session.code },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /venue|Location|GPS/i,
    );

    await h.call("POST", `/api/sessions/${session.id}/end`, { token: lecToken });
  });

  it("network fallback accepts a student within the venue radius", async () => {
    // cf.city-level geolocation places the student ~inside the 150m fence.
    const lec = await h.login("lecturer@slams.edu");
    const stu = await h.login("student@slams.edu");
    const lecToken = tokenOf(lec.json);
    const stuToken = tokenOf(stu.json);

    const courses = (await (
      await h.call("GET", "/api/lecturer/courses", { token: lecToken })
    ).json()) as Array<{ id: string }>;
    const start = await h.call("POST", "/api/sessions", {
      token: lecToken,
      body: {
        courseId: courses[0].id,
        durationMinutes: 10,
        latitude: 6.5,
        longitude: 3.4,
        radiusMeters: 200,
      },
    });
    const session = (await start.json()) as { id: string; code: string };

    const res = await h.call("POST", "/api/attendance", {
      token: stuToken,
      body: { code: session.code },
      // request.cf geolocation ~ near the venue (6.5005, 3.4005 ≈ 70m).
      cf: { latitude: "6.5005", longitude: "3.4005", colo: "LOS", country: "NG" },
    });
    expect(res.status).toBe(200);

    // The sign-in carries forensic metadata.
    const rows = h.raw
      .prepare(
        "SELECT colo, net_distance_meters, evidence FROM attendance_records WHERE session_id = ?",
      )
      .all(session.id) as Array<{ colo: string; net_distance_meters: number; evidence: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].colo).toBe("LOS");
    expect(rows[0].net_distance_meters).toBeGreaterThan(0);
    expect(rows[0].evidence).toMatch(/^[0-9a-f]{64}$/);

    await h.call("POST", `/api/sessions/${session.id}/end`, { token: lecToken });
  });

  it("server-side revocation: logout kills the token everywhere", async () => {
    const login = await h.login("lecturer@slams.edu");
    const token = tokenOf(login.json);

    const me1 = await h.call("GET", "/api/auth/me", { token });
    expect(me1.status).toBe(200);

    const logout = await h.call("POST", "/api/auth/logout", { token });
    expect(logout.status).toBe(200);

    const me2 = await h.call("GET", "/api/auth/me", { token });
    expect(me2.status).toBe(401);
    expect(((await me2.json()) as { error: { code: string } }).error.code).toBe("session_revoked");
  });

  it("course-level venue geofence is inherited by new sessions", async () => {
    const admin = await h.login("admin@slams.edu");
    const adminToken = tokenOf(admin.json);
    const lec = await h.login("lecturer@slams.edu");
    const lecToken = tokenOf(lec.json);

    const depts = (await (
      await h.call("GET", "/api/departments", { token: adminToken })
    ).json()) as Array<{ id: string; code: string }>;
    const csc = depts.find((d) => d.code === "CSC")!;
    const made = await h.call("POST", "/api/courses", {
      token: adminToken,
      body: { code: "CSC 888", title: "Geofenced", departmentId: csc.id, level: "400", units: 2 },
    });
    const course = (await made.json()) as { id: string };
    await h.call("PATCH", `/api/courses/${course.id}/lecturer`, {
      token: adminToken,
      body: {
        lecturerId: (
          (await (await h.call("GET", "/api/auth/me", { token: lecToken })).json()) as {
            id: string;
          }
        ).id,
      },
    });
    const venue = await h.call("PATCH", `/api/courses/${course.id}/venue`, {
      token: adminToken,
      body: { latitude: 6.5, longitude: 3.4, radiusMeters: 100 },
    });
    expect(venue.status).toBe(200);

    // Lecturer starts without any coords → inherits the venue.
    const start = await h.call("POST", "/api/sessions", {
      token: lecToken,
      body: { courseId: course.id, durationMinutes: 10 },
    });
    expect(start.status).toBe(201);
    const session = (await start.json()) as { id: string; code: string; radiusMeters: number };
    expect(session.radiusMeters).toBe(100);

    await h.call("POST", `/api/sessions/${session.id}/end`, { token: lecToken });
    await h.call("DELETE", `/api/courses/${course.id}`, { token: adminToken });
  });

  it("records show a verified forensics class after a GPS sign-in", async () => {
    const repo = await getRepo(h.env.DB);
    const course = await repo.getCourseByCode("CSC 305");
    const lec = (await repo.listUsers("lecturer")).find((l) => l.email === "lecturer@slams.edu")!;
    const ada = await repo.getUserByEmail("student@slams.edu");

    const s = await repo.startSession({
      courseId: course!.id,
      lecturerId: lec.id,
      durationMinutes: 10,
      latitude: 6.5,
      longitude: 3.4,
      radiusMeters: 200,
    });
    await repo.submitAttendance({
      code: s.code,
      studentId: ada!.id,
      latitude: 6.501,
      longitude: 3.401,
      deviceId: "tamper-device-01",
      clientTime: Date.now(),
      secret: new TextEncoder().encode(SECRET),
    });
    const detail = await repo.sessionDetail(s.id);
    const row = detail!.attendance[0];
    expect(row.evidence?.class).toBe("verified");
    expect(row.evidence?.hashPresent).toBe(true);
    expect(row.evidence?.distanceMeters).toBeGreaterThan(0);

    await repo.endSession(s.id);
  });
});
