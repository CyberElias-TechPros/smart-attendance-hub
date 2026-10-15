// Phase 1.1–1.3 — the institution layer and the All-Courses report
// (brief §3, §4, §6; plan §4.1, §5.2).
//
// These tests exist because the brief's centrepiece screen is a table whose
// every cell must reconcile with the underlying records. They cover the period
// model (faculties, academic sessions, semesters), the twelve columns of the
// All-Courses table, the eight filters, and the weighted totals row.
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

/** A self-contained department (optionally inside a faculty) with its own
 *  students, so filters can be exercised without interference. */
async function makeDepartment(name: string, code: string, facultyId?: string) {
  const dept = await repo.createDepartment(name, code);
  if (facultyId) await repo.setDepartmentFaculty(dept.id, facultyId);
  return dept;
}

async function makeCourse(opts: {
  code: string;
  title: string;
  departmentId: string;
  level?: string;
  lecturerId?: string;
  studentCount?: number;
  tag: string;
}) {
  const course = await repo.createCourse({
    code: opts.code,
    title: opts.title,
    departmentId: opts.departmentId,
    level: opts.level ?? "100",
    units: 3,
  });
  if (opts.lecturerId) await repo.assignLecturer(course.id, opts.lecturerId);
  const students: string[] = [];
  for (let i = 0; i < (opts.studentCount ?? 4); i++) {
    students.push(
      await repo.createUser({
        name: `${opts.tag} Student ${i}`,
        email: `${opts.tag}-${i}@slams.edu`,
        password: "password123",
        role: "student",
        matricNo: `${opts.code.replace(/\s+/g, "")}/${i}`,
        departmentId: opts.departmentId,
        level: opts.level ?? "100",
      }),
    );
  }
  await repo.setEnrollments(course.id, students);
  return { course, students };
}

/** Run a lecture: the first `attend` students sign in, then it closes. */
async function runLecture(
  courseId: string,
  lecturerId: string,
  students: string[],
  attend: number,
  opts: { topic?: string; startedAt?: number } = {},
) {
  const session = await repo.startSession({
    courseId,
    lecturerId,
    durationMinutes: 10,
    topic: opts.topic,
  });
  for (const sid of students.slice(0, attend)) {
    await repo.submitAttendance({ code: session.code, studentId: sid, deviceId: `dev-${sid}` });
  }
  await repo.endSession(session.id);
  if (opts.startedAt != null) {
    // Backdate the lecture (and the rows materialised for it) to place it in an
    // earlier reporting window.
    shim.raw
      .prepare("UPDATE sessions SET started_at = ? WHERE id = ?")
      .run(opts.startedAt, session.id);
    shim.raw
      .prepare("UPDATE attendance_records SET timestamp = ? WHERE session_id = ?")
      .run(opts.startedAt, session.id);
  }
  return session;
}

describe("academic structure", () => {
  it("seeds a current academic session and semester, and resolves them", async () => {
    const period = await repo.academicPeriod();
    expect(period.academicSession).toBeTruthy();
    expect(period.semester).toBeTruthy();
    expect(period.semester!.isCurrent).toBe(true);
    expect(period.academicSessions.length).toBeGreaterThanOrEqual(1);
    expect(period.semesters.length).toBeGreaterThanOrEqual(1);
  });

  it("creates faculties, attaches departments, and refuses destructive deletes", async () => {
    // Codes are institution-wide unique and the seed already ships faculties.
    const faculty = await repo.createFaculty({ name: "Faculty of Test Studies", code: "FTS" });
    expect(faculty.id).toBeTruthy();
    await expect(repo.createFaculty({ name: "Duplicate", code: "fts" })).rejects.toThrow(
      /already exists/,
    );

    const dept = await makeDepartment("Faculty Physics", "FPH", faculty.id);
    const faculties = await repo.listFaculties();
    expect(faculties.find((f) => f.id === faculty.id)!.name).toBe("Faculty of Test Studies");

    // A faculty with departments cannot vanish and orphan them.
    await expect(repo.deleteFaculty(faculty.id)).rejects.toThrow(/departments/);
    await repo.setDepartmentFaculty(dept.id, null);
    await repo.deleteFaculty(faculty.id);
    expect((await repo.listFaculties()).some((f) => f.id === faculty.id)).toBe(false);
  });

  it("manages academic sessions and semesters, keeping exactly one current", async () => {
    const created = await repo.createAcademicSession({
      name: "2023/2024",
      code: "2023/2024",
      makeCurrent: true,
    });
    expect(created.isCurrent).toBe(true);

    const first = await repo.createSemester({
      academicSessionId: created.id,
      name: "First Semester",
      makeCurrent: true,
    });
    const second = await repo.createSemester({
      academicSessionId: created.id,
      name: "Second Semester",
    });
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    await expect(
      repo.createSemester({ academicSessionId: created.id, name: "Third", sequence: 1 }),
    ).rejects.toThrow(/already has a semester/);

    await repo.setCurrentSemester(second.id);
    let period = await repo.academicPeriod();
    expect(period.semester!.id).toBe(second.id);
    expect(period.semesters.filter((s) => s.isCurrent)).toHaveLength(1);

    await repo.setCurrentSemester(first.id);
    period = await repo.academicPeriod();
    expect(period.semester!.id).toBe(first.id);
    expect(period.semesters.filter((s) => s.isCurrent)).toHaveLength(1);
  });

  it("freezes a finalised period, then locks its records", async () => {
    const period = await repo.academicPeriod();
    const session = await repo.createAcademicSession({ name: "1999/2000", code: "1999/2000" });
    const sem = await repo.createSemester({
      academicSessionId: session.id,
      name: "Freeze Test",
      makeCurrent: true,
    });

    const dept = await makeDepartment("Freeze Dept", "FRZ");
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const { course, students } = await makeCourse({
      code: "FRZ 101",
      title: "Frozen Course",
      departmentId: dept.id,
      lecturerId: lecturer!.id,
      studentCount: 3,
      tag: "frz",
    });
    await runLecture(course.id, lecturer!.id, students, 2);

    const finalized = await repo.finalizeSemester(sem.id);
    expect(finalized.finalizedAt).toBeTruthy();

    // Every record in the period is now locked: changes need an override.
    const record = shim.raw
      .prepare("SELECT id, locked, semester_id FROM attendance_records WHERE course_id = ? LIMIT 1")
      .get(course.id) as { id: string; locked: number; semester_id: string };
    expect(record.locked).toBe(1);
    expect(record.semester_id).toBe(sem.id);
    await expect(
      repo.setAttendanceStatus(record.id, "late", { actorId: "x", reason: "too late" }),
    ).rejects.toThrow(/finalised period/);

    // Re-opening restores editability (for a correction round).
    await repo.reopenSemester(sem.id);
    const open = await repo.setAttendanceStatus(record.id, "late", {
      actorId: "x",
      reason: "correction window",
    });
    expect(open.status).toBe("late");
    void period;
  });
});

describe("All-Courses report (brief §4)", () => {
  it("returns every column of the brief's table with reconciling figures", async () => {
    const dept = await makeDepartment("Report Dept", "RPT");
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const { course, students } = await makeCourse({
      code: "RPT 101",
      title: "Reported Course",
      departmentId: dept.id,
      lecturerId: lecturer!.id,
      studentCount: 10,
      tag: "rpt",
    });
    // Three lectures: 10/10, 8/10, 6/10 attend → 24 of 30 opportunities = 80%.
    await runLecture(course.id, lecturer!.id, students, 10);
    await runLecture(course.id, lecturer!.id, students, 8);
    await runLecture(course.id, lecturer!.id, students, 6);

    const report = await repo.coursesReport({ courseId: course.id });
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    expect(row.code).toBe("RPT 101");
    expect(row.enrolled).toBe(10);
    expect(row.classesHeld).toBe(3);
    expect(row.present).toBe(24);
    expect(row.absent).toBe(6);
    expect(row.expected).toBe(30);
    expect(row.rate).toBe(80);
    // The brief's "Classes Attended": 80% of 3 lectures = 2.4 per student.
    expect(row.classesAttended).toBe(2.4);
    expect(row.health).toBe("good");
    expect(row.departmentName).toBe("Report Dept");
    expect(row.lecturerName).toBe("Dr. Amina Yusuf");

    // The totals row describes the same filtered set, weighted.
    expect(report.totals.courses).toBe(1);
    expect(report.totals.rate).toBe(80);
    expect(report.meta.calculation).toBe("opportunity-weighted");
  });

  it("weights the roll-up by opportunities, not by course count", async () => {
    const dept = await makeDepartment("Weight Dept", "WGT");
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    // Small cohort, perfect attendance.
    const small = await makeCourse({
      code: "WGT 101",
      title: "Small Cohort",
      departmentId: dept.id,
      lecturerId: lecturer!.id,
      studentCount: 2,
      tag: "wgt-s",
    });
    // Large cohort, poor attendance.
    const large = await makeCourse({
      code: "WGT 201",
      title: "Large Cohort",
      departmentId: dept.id,
      lecturerId: lecturer!.id,
      studentCount: 20,
      tag: "wgt-l",
      level: "200",
    });
    await runLecture(small.course.id, lecturer!.id, small.students, 2); // 2/2
    await runLecture(large.course.id, lecturer!.id, large.students, 4); // 4/20

    const report = await repo.coursesReport({ departmentId: dept.id });
    expect(report.rows).toHaveLength(2);
    const smallRow = report.rows.find((r) => r.code === "WGT 101")!;
    const largeRow = report.rows.find((r) => r.code === "WGT 201")!;
    expect(smallRow.rate).toBe(100);
    expect(largeRow.rate).toBe(20);

    // (2+4)/(2+20) = 27.3% — NOT the (100+20)/2 = 60% a mean would produce.
    expect(report.totals.rate).toBe(27.3);
    expect(report.totals.expected).toBe(22);
    expect(report.totals.attended).toBe(6);
  });

  it("sorts, paginates, and reports the filtered total", async () => {
    const report = await repo.coursesReport({ pageSize: 2, page: 1, sort: "rate", dir: "desc" });
    expect(report.rows.length).toBeLessThanOrEqual(2);
    expect(report.page).toBe(1);
    expect(report.pageSize).toBe(2);
    expect(report.total).toBeGreaterThan(2); // the fixture set has more courses

    const page2 = await repo.coursesReport({ pageSize: 2, page: 2, sort: "rate", dir: "desc" });
    expect(page2.rows[0].code).not.toBe(report.rows[0].code);

    // Descending rate really is descending.
    const rates = report.rows.map((r) => r.rate ?? -1);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThanOrEqual(rates[i - 1]);

    // Ascending is the mirror image.
    const asc = await repo.coursesReport({ sort: "rate", dir: "asc", pageSize: 100 });
    const ascRates = asc.rows.map((r) => r.rate ?? -1).filter((r) => r >= 0);
    for (let i = 1; i < ascRates.length; i++)
      expect(ascRates[i]).toBeGreaterThanOrEqual(ascRates[i - 1]);
  });

  it("filters by faculty, department, lecturer, course, search and date range (§6)", async () => {
    const faculty = await repo.createFaculty({ name: "Faculty of Filtering", code: "FLT" });
    const dept = await makeDepartment("Filter Dept", "FDM", faculty.id);
    const otherDept = await makeDepartment("Other Filter Dept", "OFD");
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const okafor = await repo.getUserByEmail("okafor@slams.edu");

    const { course, students } = await makeCourse({
      code: "FLT 101",
      title: "Filtered Course",
      departmentId: dept.id,
      lecturerId: lecturer!.id,
      studentCount: 5,
      tag: "flt",
    });
    const other = await makeCourse({
      code: "OFD 101",
      title: "Unrelated Course",
      departmentId: otherDept.id,
      lecturerId: okafor!.id,
      studentCount: 3,
      tag: "ofd",
    });
    const longAgo = Date.now() - 400 * 24 * 60 * 60 * 1000;
    await runLecture(course.id, lecturer!.id, students, 5); // recent
    await runLecture(course.id, lecturer!.id, students, 1, { startedAt: longAgo }); // old
    await runLecture(other.course.id, okafor!.id, other.students, 3);

    // Faculty scope
    const byFaculty = await repo.coursesReport({ facultyId: faculty.id, pageSize: 100 });
    expect(byFaculty.rows.map((r) => r.code)).toEqual(["FLT 101"]);

    // Department scope
    const byDept = await repo.coursesReport({ departmentId: dept.id, pageSize: 100 });
    expect(byDept.rows.map((r) => r.code)).toEqual(["FLT 101"]);

    // Lecturer scope
    const byLecturer = await repo.coursesReport({ lecturerId: okafor!.id, pageSize: 100 });
    expect(byLecturer.rows.map((r) => r.code)).toContain("OFD 101");
    expect(byLecturer.rows.map((r) => r.code)).not.toContain("FLT 101");

    // Course scope
    const byCourse = await repo.coursesReport({ courseId: other.course.id, pageSize: 100 });
    expect(byCourse.rows).toHaveLength(1);
    expect(byCourse.rows[0].code).toBe("OFD 101");

    // Search is case-insensitive across code, title, department and lecturer.
    // The lecturer term is scoped by department here so it stays unambiguous
    // (the seeded lecturer also teaches elsewhere).
    for (const term of ["flt 101", "FLT 101", "filtered", "fdm"]) {
      const found = await repo.coursesReport({ search: term, pageSize: 100 });
      expect(
        found.rows.map((r) => r.code),
        `search "${term}"`,
      ).toEqual(["FLT 101"]);
    }
    const byLecturerName = await repo.coursesReport({
      departmentId: dept.id,
      search: "amina",
      pageSize: 100,
    });
    expect(byLecturerName.rows.map((r) => r.code)).toEqual(["FLT 101"]);
    expect((await repo.coursesReport({ search: "no-such-course", pageSize: 100 })).rows).toEqual(
      [],
    );

    // Date range: only the recent lecture counts.
    const recent = await repo.coursesReport({
      courseId: course.id,
      from: Date.now() - 24 * 60 * 60 * 1000,
    });
    expect(recent.rows[0].classesHeld).toBe(1);
    expect(recent.rows[0].rate).toBe(100); // 5 of 5 attended today

    // The whole history, unfiltered by date.
    const all = await repo.coursesReport({ courseId: course.id });
    expect(all.rows[0].classesHeld).toBe(2);
    expect(all.rows[0].expected).toBe(10);
    expect(all.rows[0].rate).toBe(60); // (5 + 1) / 10
  });

  it("scopes the report to a semester and keeps other periods out", async () => {
    const dept = await makeDepartment("Semester Dept", "SEM");
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const { course, students } = await makeCourse({
      code: "SEM 101",
      title: "Semester Course",
      departmentId: dept.id,
      lecturerId: lecturer!.id,
      studentCount: 4,
      tag: "sem",
    });
    await runLecture(course.id, lecturer!.id, students, 4);

    const other = await repo.createAcademicSession({ name: "2022/2023", code: "2022/2023" });
    const past = await repo.createSemester({
      academicSessionId: other.id,
      name: "Past Semester",
      startsOn: Date.now() - 500 * 24 * 60 * 60 * 1000,
      endsOn: Date.now() - 300 * 24 * 60 * 60 * 1000,
    });

    const current = await repo.coursesReport({ courseId: course.id });
    expect(current.rows[0].classesHeld).toBe(1);

    // A period the course does not belong to reports nothing, rather than
    // silently reporting the current period's numbers under a past label.
    const inPast = await repo.coursesReport({ courseId: course.id, semesterId: past.id });
    expect(inPast.rows).toHaveLength(1);
    expect(inPast.rows[0].classesHeld).toBe(0);
    expect(inPast.rows[0].rate).toBeNull();
  });

  it("gives a course with no lectures an empty rate, never 0%", async () => {
    const dept = await makeDepartment("Empty Dept", "EMP");
    const { course } = await makeCourse({
      code: "EMP 101",
      title: "Never Met",
      departmentId: dept.id,
      studentCount: 3,
      tag: "emp",
    });
    const report = await repo.coursesReport({ courseId: course.id });
    expect(report.rows[0].classesHeld).toBe(0);
    expect(report.rows[0].rate).toBeNull();
    expect(report.rows[0].health).toBeNull();
  });

  it("excludes a student enrolled after a lecture from that lecture's denominator", async () => {
    const dept = await makeDepartment("Late Join Dept", "LJD");
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const { course, students } = await makeCourse({
      code: "LJD 101",
      title: "Late Joiner Course",
      departmentId: dept.id,
      lecturerId: lecturer!.id,
      studentCount: 2,
      tag: "ljd",
    });
    await runLecture(course.id, lecturer!.id, students, 2); // both attended

    const joiner = await repo.createUser({
      name: "Joined Late",
      email: "joined-late@slams.edu",
      password: "password123",
      role: "student",
      matricNo: "LJD/99",
      departmentId: dept.id,
      level: "100",
    });
    await repo.setEnrollments(course.id, [...students, joiner]);

    const report = await repo.coursesReport({ courseId: course.id });
    // The joiner is registered (3 students) but was not expected at lecture 1:
    // 2 of 2 opportunities, not 2 of 3.
    expect(report.rows[0].enrolled).toBe(3);
    expect(report.rows[0].expected).toBe(2);
    expect(report.rows[0].rate).toBe(100);
  });

  it("exposes per-lecture stats for the course detail page (brief §5)", async () => {
    const dept = await makeDepartment("Detail Dept", "DTL");
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const { course, students } = await makeCourse({
      code: "DTL 101",
      title: "Detail Course",
      departmentId: dept.id,
      lecturerId: lecturer!.id,
      studentCount: 6,
      tag: "dtl",
    });
    await runLecture(course.id, lecturer!.id, students, 6, { topic: "Lecture 1" });
    await runLecture(course.id, lecturer!.id, students, 3, { topic: "Lecture 2" });

    const stats = await repo.courseSessionStats(course.id);
    expect(stats).toHaveLength(2);
    expect(stats[0].topic).toBe("Lecture 1");
    expect(stats[0]).toMatchObject({ present: 6, absent: 0, expected: 6, rate: 100 });
    expect(stats[1]).toMatchObject({ present: 3, absent: 3, expected: 6, rate: 50 });
    // Oldest first: the page reads as a semester timeline.
    expect(stats[0].startedAt).toBeLessThan(stats[1].startedAt);
  });
});
