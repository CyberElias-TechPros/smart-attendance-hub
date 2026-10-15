// Phase 0.2 — materialised absences & provenance (plan §4.3).
//
// Before this, "absent" was only ever inferred as (sessions − attended), which
// made Present/Absent/Late impossible to total independently and blurred the
// line between "never showed up" and "approved excuse". These tests pin the new
// behaviour: closing a lecture writes one row per expected student, idempotently,
// without ever presenting an absence as a sign-in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import { getRepo, type Repo } from "../src/db";

let shim: D1Shim;
let repo: Repo;

beforeAll(async () => {
  shim = createD1Shim();
  applyMigrations(shim.raw);
  repo = await getRepo(shim.db);
});
afterAll(() => shim.close());

async function makeCourseWithRoster(suffix: string, studentCount: number) {
  const dept = (await repo.listDepartments())[0];
  const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
  const course = await repo.createCourse({
    code: `INT ${suffix}`,
    title: `Integrity ${suffix}`,
    departmentId: dept.id,
    level: "100",
    units: 2,
  });
  const courseId = course.id;
  await repo.assignLecturer(courseId, lecturer!.id);

  const studentIds: string[] = [];
  for (let i = 0; i < studentCount; i++) {
    const id = await repo.createUser({
      name: `${suffix} Student ${i}`,
      email: `integrity-${suffix}-${i}@slams.edu`,
      password: "password123",
      role: "student",
      matricNo: `INT/${suffix}/${i}`,
      departmentId: dept.id,
      level: "100",
    });
    studentIds.push(id);
  }
  await repo.setEnrollments(courseId, studentIds);
  return { courseId, studentIds, lecturerId: lecturer!.id, deptId: dept.id };
}

function recordRows(sessionId: string) {
  return shim.raw
    .prepare("SELECT student_id, status, source FROM attendance_records WHERE session_id = ?")
    .all(sessionId) as Array<{ student_id: string; status: string; source: string }>;
}

describe("attendance integrity — materialised absences", () => {
  it("writes one absence per expected student when a lecture closes", async () => {
    const { courseId, studentIds, lecturerId } = await makeCourseWithRoster("A", 5);
    const session = await repo.startSession({ courseId, lecturerId, durationMinutes: 15 });

    // Two students sign in; the rest never do.
    const signers = studentIds.slice(0, 2);
    for (const sid of signers) {
      await repo.submitAttendance({ code: session.code, studentId: sid, deviceId: `dev-${sid}` });
    }

    // While the lecture is open nobody is absent yet — students can still walk in.
    const open = await repo.sessionDetail(session.id);
    expect(open!.absentees).toHaveLength(0);
    expect(open!.attendance).toHaveLength(2);

    await repo.endSession(session.id);

    const rows = recordRows(session.id);
    expect(rows).toHaveLength(5); // roster fully accounted for
    expect(rows.filter((r) => r.status === "present")).toHaveLength(2);
    expect(rows.filter((r) => r.status === "absent")).toHaveLength(3);
    expect(rows.filter((r) => r.source === "auto_absent")).toHaveLength(3);
    expect(rows.filter((r) => r.source === "scan")).toHaveLength(2);

    const detail = await repo.sessionDetail(session.id);
    expect(detail!.absentees).toHaveLength(3);
    expect(detail!.attendance).toHaveLength(2); // absences are NOT listed as sign-ins
    expect(detail!.counts).toMatchObject({ present: 2, late: 0, excused: 0, absent: 3 });
    expect(detail!.counts.attended).toBe(2);
    expect(detail!.counts.expected).toBe(5);
    expect(detail!.counts.rate).toBe(40);

    // Absent rows carry no sign-in forensics: there was no sign-in.
    const absentIds = detail!.absentees.map((a) => a.studentId);
    expect(absentIds).toEqual(studentIds.slice(2));
  });

  it("is idempotent — re-closing a lecture never duplicates rows", async () => {
    const { courseId, studentIds, lecturerId } = await makeCourseWithRoster("B", 3);
    const session = await repo.startSession({ courseId, lecturerId, durationMinutes: 15 });
    await repo.submitAttendance({ code: session.code, studentId: studentIds[0], deviceId: "b0" });
    await repo.endSession(session.id);
    expect(recordRows(session.id)).toHaveLength(3);

    await repo.endSession(session.id);
    await repo.materializeAbsences(session.id);
    expect(recordRows(session.id)).toHaveLength(3);
  });

  it("keeps a student's own history free of phantom sign-ins", async () => {
    const { courseId, studentIds, lecturerId } = await makeCourseWithRoster("C", 3);
    const session = await repo.startSession({ courseId, lecturerId, durationMinutes: 15 });
    await repo.endSession(session.id); // nobody signed in → 3 absences

    const history = await repo.studentHistory(studentIds[0]);
    expect(history.some((h) => h.courseCode === "INT C")).toBe(false);

    const sessions = await repo.studentCourseSessions(studentIds[0], courseId);
    const forSession = sessions.find((s) => s.id === session.id)!;
    expect(forSession.attended).toBe(false);
    expect(forSession.status).toBe("absent");
    expect(forSession.attendedAt).toBeUndefined(); // never claims they signed in
  });

  it("does not blame a student for lectures that ran before they enrolled", async () => {
    const { courseId, studentIds, lecturerId } = await makeCourseWithRoster("D", 2);
    const early = await repo.startSession({ courseId, lecturerId, durationMinutes: 15 });
    await repo.submitAttendance({ code: early.code, studentId: studentIds[0], deviceId: "d0" });
    await repo.endSession(early.id);

    // A late joiner: enrolled after that lecture.
    const lateJoiner = await repo.createUser({
      name: "Late Joiner",
      email: "late-joiner@slams.edu",
      password: "password123",
      role: "student",
      matricNo: "INT/D/9",
      departmentId: (await repo.listDepartments())[0].id,
      level: "100",
    });
    await repo.setEnrollments(courseId, [...studentIds, lateJoiner]);

    // Opening the roster again must NOT have rewritten the original dates…
    const rows = shim.raw
      .prepare("SELECT student_id, enrolled_at FROM course_enrollments WHERE course_id = ?")
      .all(courseId) as Array<{ student_id: string; enrolled_at: number }>;
    const original = rows.find((r) => r.student_id === studentIds[0])!;
    const joinerRow = rows.find((r) => r.student_id === lateJoiner)!;
    expect(original.enrolled_at).toBeGreaterThan(0); // a real timestamp, not reset to 0
    expect(original.enrolled_at).toBeLessThan(joinerRow.enrolled_at); // order preserved

    // …so the late joiner is not retroactively marked absent for the first lecture.
    await repo.materializeAbsences(early.id);
    const after = recordRows(early.id);
    expect(after.map((r) => r.student_id)).not.toContain(lateJoiner);

    // But the second lecture (after they enrolled) does expect them.
    const later = await repo.startSession({ courseId, lecturerId, durationMinutes: 15 });
    await repo.endSession(later.id);
    const laterRows = recordRows(later.id);
    expect(laterRows.map((r) => r.student_id)).toContain(lateJoiner);
  });

  it("reports absent + present + late + excused as independent totals", async () => {
    const { courseId, studentIds, lecturerId } = await makeCourseWithRoster("E", 4);
    const session = await repo.startSession({ courseId, lecturerId, durationMinutes: 15 });
    await repo.submitAttendance({ code: session.code, studentId: studentIds[0], deviceId: "e0" });
    await repo.submitAttendance({ code: session.code, studentId: studentIds[1], deviceId: "e1" });
    await repo.endSession(session.id);

    const lateRow = shim.raw
      .prepare("SELECT id, status FROM attendance_records WHERE session_id = ? AND student_id = ?")
      .get(session.id, studentIds[1]) as { id: string; status: string };
    expect(lateRow.status).toBe("present"); // the raw row before the correction
    await repo.setAttendanceStatus(lateRow.id, "late");

    const report = await repo.courseReport(courseId);
    expect(report!.counts).toMatchObject({
      present: 1,
      late: 1,
      excused: 0,
      absent: 2,
      attended: 2,
    });
    expect(report!.counts.expected).toBe(4);
    expect(report!.weightedRate).toBe(50);

    // Every student's tallies add up to the lecture's roster.
    for (const s of report!.students) {
      expect(s.present + s.late + s.excused + s.absent).toBe(1);
      expect(s.expected).toBe(1);
    }
  });

  it("course-wide rate is opportunity-weighted, not the mean of student rates", async () => {
    // Lecture 1: 10 students, everyone attends.
    // Lecture 2: the same 10 students, only 1 attends.
    // Weighted = 11/20 = 55%. A mean of per-student rates would also be 55% here,
    // so the discriminating case uses uneven rosters across two courses.
    const a = await makeCourseWithRoster("F", 10);
    const s1 = await repo.startSession({
      courseId: a.courseId,
      lecturerId: a.lecturerId,
      durationMinutes: 15,
    });
    for (const sid of a.studentIds) {
      await repo.submitAttendance({ code: s1.code, studentId: sid, deviceId: `f-${sid}` });
    }
    await repo.endSession(s1.id);

    const s2 = await repo.startSession({
      courseId: a.courseId,
      lecturerId: a.lecturerId,
      durationMinutes: 15,
    });
    await repo.submitAttendance({
      code: s2.code,
      studentId: a.studentIds[0],
      deviceId: `f-${a.studentIds[0]}`,
    });
    await repo.endSession(s2.id);

    const report = await repo.courseReport(a.courseId);
    expect(report!.counts.expected).toBe(20);
    expect(report!.counts.attended).toBe(11);
    expect(report!.weightedRate).toBe(55);

    // The two computations described in the brief's §8 must be visibly different
    // when attendance is uneven across a roster of differing sizes.
    const big = await makeCourseWithRoster("G", 40); // 40 students, 1 lecture, 1 attendee
    const bigSession = await repo.startSession({
      courseId: big.courseId,
      lecturerId: big.lecturerId,
      durationMinutes: 15,
    });
    await repo.submitAttendance({
      code: bigSession.code,
      studentId: big.studentIds[0],
      deviceId: "g0",
    });
    await repo.endSession(bigSession.id);
    const bigReport = await repo.courseReport(big.courseId);
    expect(bigReport!.weightedRate).toBe(2.5); // 1/40

    const combined =
      (report!.counts.attended + bigReport!.counts.attended) /
      (report!.counts.expected + bigReport!.counts.expected);
    expect(Math.round(combined * 1000) / 10).toBe(20); // (11+1)/(20+40) = 20%
    // A naive mean of the two course rates would be (55 + 2.5)/2 = 28.75% —
    // demonstrably wrong, and exactly what the brief forbids.
    expect(Math.round(((report!.weightedRate! + bigReport!.weightedRate!) / 2) * 10) / 10).toBe(
      28.8,
    );
  });
});
