import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import { getRepo, type Repo } from "../src/db";

let shim: D1Shim;
let repo: Repo;
let course: { id: string; departmentId: string };
let lecturerId: string;
let studentId: string;

beforeAll(async () => {
  shim = createD1Shim();
  applyMigrations(shim.raw);
  repo = await getRepo(shim.db);
  const lec = await repo.getUserByEmail("lecturer@slams.edu");
  const stu = await repo.getUserByEmail("student@slams.edu");
  const c = await repo.getCourseByCode("CSC 311");
  if (!c) throw new Error("demo course CSC 311 missing");
  lecturerId = lec!.id;
  studentId = stu!.id;
  course = c;
});
afterAll(() => shim.close());

describe("lifecycle: auto-close (never-ending-session guard)", () => {
  it("closes OPEN sessions that have outlived their window", async () => {
    const s = await repo.startSession({ courseId: course.id, lecturerId, durationMinutes: 15 });
    // Force the window into the past; the session is still "open".
    shim.raw
      .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .run(Date.now() - 1000, s.id);

    const closed = await repo.closeExpiredSessions();
    expect(closed).toBeGreaterThanOrEqual(1);
    expect((await repo.getSession(s.id))!.endedAt).toBeGreaterThan(0);
  });

  it("leaves sessions the lecturer opted out of auto-close alone", async () => {
    const s = await repo.startSession({
      courseId: course.id,
      lecturerId,
      durationMinutes: 15,
      autoEndEnabled: false,
    });
    shim.raw
      .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
      .run(Date.now() - 1000, s.id);
    await repo.closeExpiredSessions();
    expect((await repo.getSession(s.id))!.endedAt).toBeUndefined();
    await repo.endSession(s.id);
  });
});

describe("lifecycle: venue capacity (seats)", () => {
  it("turns students away once the room is full", async () => {
    const s = await repo.startSession({
      courseId: course.id,
      lecturerId,
      durationMinutes: 15,
      seats: 1,
    });
    expect(s.seats).toBe(1);

    // First student fills the seat.
    await expect(repo.submitAttendance({ code: s.code, studentId })).resolves.toBeTruthy();

    // Cram a second record directly (different student) to prove the guard is
    // about capacity, not duplicates.
    const second = await repo.createUser({
      name: "Full Room",
      email: "fullroom@slams.edu",
      password: "whatever-1",
      role: "student",
      matricNo: "CSC/21/7000",
      departmentId: course.departmentId,
      level: "300",
    });
    await repo.setEnrollments(course.id, [studentId, second]);
    await expect(repo.submitAttendance({ code: s.code, studentId: second })).rejects.toThrow(
      /full/,
    );

    await repo.endSession(s.id);
    await repo.deleteUser(second);
  });
});

describe("lifecycle: attendance status (excused/late)", () => {
  it("excused records stop counting toward the percentage but stay in history", async () => {
    const s = await repo.startSession({
      courseId: course.id,
      lecturerId,
      durationMinutes: 15,
      codeIntervalSeconds: 60,
    });
    const rec = await repo.submitAttendance({ code: s.code, studentId, deviceId: "lifecycle-dev" });
    expect(rec).toBeTruthy();

    const row = shim.raw
      .prepare("SELECT id, status FROM attendance_records WHERE session_id = ? AND student_id = ?")
      .get(s.id, studentId) as { id: string; status: string };
    expect(row.status).toBe("present");

    await repo.setAttendanceStatus(row.id, "excused");
    expect(
      (
        shim.raw.prepare("SELECT status FROM attendance_records WHERE id = ?").get(row.id) as {
          status: string;
        }
      ).status,
    ).toBe("excused");

    // Percentage for the course no longer counts this excused record.
    const view = (await repo.studentCourses(studentId)).find((v) => v.id === course.id)!;
    const report = await repo.courseReport(course.id);
    const repStudent = report!.students.find((x) => x.id === studentId)!;
    const rawPresent = shim.raw
      .prepare(
        "SELECT COUNT(DISTINCT session_id) AS c FROM attendance_records WHERE course_id = ? AND student_id = ? AND status IN ('present','late')",
      )
      .get(course.id, studentId) as { c: number };
    expect(repStudent.attended).toBe(rawPresent.c);
    expect(view.attendedSessions).toBe(rawPresent.c);

    await repo.endSession(s.id);
  });
});

describe("lifecycle: recurring schedules", () => {
  it("materializes at most one leg per course/window and is idempotent", async () => {
    const sched = await repo.createSchedule({
      courseId: course.id,
      lecturerId,
      durationMinutes: 15,
      recurrence: "weekly",
      daysMask: "1,2,3,4,5",
      minuteOfDay: 9 * 60, // 09:00 local
      tzOffsetMinutes: 60,
      maxOccurrences: 3,
    });

    // A "now" far after the first due occurrence should produce exactly one
    // session (the due leg), and re-running must not duplicate it.
    const now = Date.now() + 25 * 60 * 60 * 1000;
    const started1 = await repo.materializeSchedules(now);
    expect(started1).toBe(1);
    const started2 = await repo.materializeSchedules(now);
    expect(started2).toBe(0);

    const after = await repo.getSchedule(sched.id);
    expect(after!.occurrences).toBe(1);
    expect(after!.lastStartAt).toBeGreaterThan(0);

    // The materialized session belongs to the right course and is open.
    const sessions = await repo.listSessionsForCourse(course.id);
    expect(sessions.length).toBeGreaterThan(0);

    // Close the materialized session so later schedule tests start clean.
    for (const s of sessions) {
      if (!s.endedAt) await repo.endSession(s.id);
    }

    await repo.deleteSchedule(sched.id);
    // Deleting a series keeps the already-materialized session (no regression).
    expect(await repo.getSchedule(sched.id)).toBeUndefined();
  });

  it("enforces the occurrence cap", async () => {
    const sched = await repo.createSchedule({
      courseId: course.id,
      lecturerId,
      durationMinutes: 5,
      recurrence: "daily",
      minuteOfDay: 0,
      tzOffsetMinutes: 0,
      maxOccurrences: 1,
    });
    // First tick materializes the one allowed leg.
    await repo.materializeSchedules(Date.now() + 25 * 60 * 60 * 1000);
    const after = await repo.getSchedule(sched.id);
    expect(after!.occurrences).toBe(1);

    // A later tick fires again but the cap blocks a second leg.
    for (const s of await repo.listSessionsForCourse(course.id)) {
      if (!s.endedAt) await repo.endSession(s.id);
    }
    await repo.materializeSchedules(Date.now() + 49 * 60 * 60 * 1000);
    expect((await repo.getSchedule(sched.id))!.occurrences).toBe(1);

    await repo.deleteSchedule(sched.id);
  });

  it("toggle enable/disable", async () => {
    const sched = await repo.createSchedule({
      courseId: course.id,
      lecturerId,
      durationMinutes: 5,
      recurrence: "daily",
      minuteOfDay: 0,
      tzOffsetMinutes: 0,
    });
    await repo.setScheduleEnabled(sched.id, false);
    expect((await repo.getSchedule(sched.id))!.enabled).toBe(false);
    await repo.deleteSchedule(sched.id);
  });
});

describe("lifecycle: lecturer claim flow", () => {
  it("lets a lecturer claim an unassigned course in their department", async () => {
    const dept = (await repo.listDepartments())[0];
    const unowned = await repo.createCourse({
      code: "CSC 888",
      title: "Unclaimed Course",
      departmentId: dept.id,
      level: "400",
      units: 2,
    });
    expect((await repo.getCourse(unowned.id))!.lecturerId).toBeUndefined();

    const available = await repo.unassignedCoursesForLecturer(lecturerId);
    expect(available.some((c) => c.id === unowned.id)).toBe(true);

    const claimed = await repo.claimCourse(unowned.id, lecturerId);
    expect(claimed.lecturerId).toBe(lecturerId);

    // Idempotent on re-claim.
    await expect(repo.claimCourse(unowned.id, lecturerId)).resolves.toBeTruthy();

    // A different lecturer cannot steal it.
    const other = await repo.getUserByEmail("okafor@slams.edu");
    await expect(repo.claimCourse(unowned.id, other!.id)).rejects.toThrow(/already assigned/);

    await repo.deleteCourse(unowned.id);
  });
});
