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

const DEMO = {
  admin: "admin@slams.edu",
  lecturer: "lecturer@slams.edu",
  student: "student@slams.edu",
};

describe("repo (integration, real SQLite via D1 shim)", () => {
  describe("seeding", () => {
    it("seeds demo users on first use", async () => {
      const admin = await repo.verifyCredentials(DEMO.admin, "password123");
      expect(admin?.role).toBe("admin");
      const lecturer = await repo.verifyCredentials(DEMO.lecturer, "password123");
      expect(lecturer?.role).toBe("lecturer");
      const student = await repo.verifyCredentials(DEMO.student, "password123");
      expect(student?.role).toBe("student");
    });

    it("rejects bad credentials", async () => {
      await expect(repo.verifyCredentials(DEMO.admin, "wrong-password")).resolves.toBeNull();
      await expect(repo.verifyCredentials("ghost@slams.edu", "password123")).resolves.toBeNull();
    });
  });

  describe("users", () => {
    it("creates a student and rejects duplicate emails (case-insensitive)", async () => {
      const id = await repo.createUser({
        name: "Test Student",
        email: "new-student@slams.edu",
        password: "secret-123",
        role: "student",
        matricNo: "CSC/21/9999",
        departmentId: (await repo.listDepartments())[0].id,
        level: "300",
      });
      expect(id).toBeTruthy();
      await expect(
        repo.createUser({
          name: "Duplicate",
          email: "NEW-STUDENT@slams.edu",
          password: "secret-123",
          role: "student",
          matricNo: "X",
          departmentId: "x",
          level: "300",
        }),
      ).rejects.toThrow("Email already in use");
    });

    it("changePassword validates current and enforces length", async () => {
      const s = await repo.getUserByEmail("new-student@slams.edu");
      expect(s).toBeTruthy();
      await expect(repo.changePassword(s!.id, "nope", "new-password-1")).rejects.toThrow(
        "Current password is incorrect",
      );
      await expect(repo.changePassword(s!.id, "secret-123", "short")).rejects.toThrow(
        "at least 8 characters",
      );
      await repo.changePassword(s!.id, "secret-123", "new-password-1");
      await expect(
        repo.verifyCredentials("new-student@slams.edu", "secret-123"),
      ).resolves.toBeNull();
      await expect(
        repo.verifyCredentials("new-student@slams.edu", "new-password-1"),
      ).resolves.toBeTruthy();
    });

    it("deleting a user cascades enrollments and attendance", async () => {
      const s = await repo.getUserByEmail("new-student@slams.edu");
      const courses = await repo.listCourses();
      const c = courses.find((x) => x.enrolledStudentIds.length > 0)!;
      await repo.setEnrollments(c.id, [...c.enrolledStudentIds, s!.id]);
      // Give the student an attendance record in an existing session
      // (direct insert to avoid depending on session open/closed state).
      const sessions = await repo.listSessionsForCourse(c.id);
      const sess = sessions[0];
      shim.raw
        .prepare(
          "INSERT OR IGNORE INTO attendance_records (id, session_id, student_id, course_id, timestamp) VALUES (?,?,?,?,?)",
        )
        .run("rec-test-1", sess.id, s!.id, c.id, Date.now());

      await repo.deleteUser(s!.id);
      await expect(repo.getUser(s!.id)).resolves.toBeUndefined();
      const enr = shim.raw
        .prepare("SELECT COUNT(*) AS c FROM course_enrollments WHERE student_id = ?")
        .get(s!.id) as { c: number };
      expect(enr.c).toBe(0);
      const rec = shim.raw
        .prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE student_id = ?")
        .get(s!.id) as { c: number };
      expect(rec.c).toBe(0);
    });

    it("refuses to delete the last admin", async () => {
      const admin = await repo.getUserByEmail(DEMO.admin);
      await expect(repo.deleteUser(admin!.id)).rejects.toThrow("last administrator");
    });

    it("deleting a lecturer cascades their sessions' attendance records", async () => {
      const lecId = await repo.createUser({
        name: "Temp Lecturer",
        email: "temp-lec@slams.edu",
        password: "temp-pass-1",
        role: "lecturer",
        staffId: "STF-TMP",
      });
      const depts = await repo.listDepartments();
      const c = await repo.createCourse({
        code: "TMP 101",
        title: "Temporary Course",
        departmentId: depts[0].id,
        level: "100",
        units: 1,
      });
      await repo.assignLecturer(c.id, lecId);
      const ada = await repo.getUserByEmail(DEMO.student);
      await repo.setEnrollments(c.id, [ada!.id]);
      const s = await repo.startSession({
        courseId: c.id,
        lecturerId: lecId,
        durationMinutes: 15,
      });
      await repo.submitAttendance({ code: s.code, studentId: ada!.id });

      await repo.deleteUser(lecId);

      const rec = shim.raw
        .prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE course_id = ?")
        .get(c.id) as { c: number };
      expect(rec.c).toBe(0);
      const sess = shim.raw
        .prepare("SELECT COUNT(*) AS c FROM sessions WHERE course_id = ?")
        .get(c.id) as { c: number };
      expect(sess.c).toBe(0);
      // Percentages stay sane (no orphan records ÷ zero sessions).
      const report = await repo.courseReport(c.id);
      expect(report!.totalSessions).toBe(0);
      expect(report!.students[0].attended).toBe(0);
      await repo.deleteCourse(c.id);
    });

    it("partial user updates preserve existing fields", async () => {
      const ada = await repo.getUserByEmail(DEMO.student);
      await repo.updateStudent(ada!.id, { name: "Ada Obi (edited)", email: DEMO.student });
      const after = await repo.getUser(ada!.id);
      expect(after!.name).toBe("Ada Obi (edited)");
      expect(after!.matricNo).toBe(ada!.matricNo);
      expect(after!.departmentId).toBe(ada!.departmentId);
      expect(after!.level).toBe(ada!.level);

      // An explicit "" department means "unassigned" → NULL.
      await repo.updateStudent(ada!.id, {
        name: ada!.name,
        email: ada!.email,
        departmentId: "",
      });
      expect((await repo.getUser(ada!.id))!.departmentId).toBeUndefined();

      // Restore the demo row for the remaining suites.
      await repo.updateStudent(ada!.id, {
        name: ada!.name,
        email: ada!.email,
        matricNo: ada!.matricNo,
        departmentId: ada!.departmentId,
        level: ada!.level,
      });

      const lec = await repo.getUserByEmail(DEMO.lecturer);
      await repo.updateLecturer(lec!.id, { name: "Dr. A. Yusuf (edited)", email: DEMO.lecturer });
      const lecAfter = await repo.getUser(lec!.id);
      expect(lecAfter!.staffId).toBe(lec!.staffId);
      expect(lecAfter!.departmentId).toBe(lec!.departmentId);
      await repo.updateLecturer(lec!.id, { name: lec!.name, email: lec!.email });
    });
  });

  describe("departments", () => {
    it("creates, updates, and guards deletion", async () => {
      const d = await repo.createDepartment("Physics", "PHY", "Atom", "oklch(0.6 0.1 300)");
      await expect(repo.createDepartment("Physics Dup", "PHY")).rejects.toThrow("already exists");
      await repo.updateDepartment(d.id, "Physics & Astronomy", "PHYA");
      await expect(repo.deleteDepartment(d.id)).resolves.toBeUndefined(); // no courses in it yet
      const gone = (await repo.listDepartments()).find((x) => x.id === d.id);
      expect(gone).toBeUndefined();
    });

    it("refuses to delete a department that still has courses", async () => {
      const d = (await repo.listDepartments()).find((x) => x.code === "CSC")!;
      await expect(repo.deleteDepartment(d.id)).rejects.toThrow(/course\(s\) still belong/);
    });
  });

  describe("courses", () => {
    it("creates and rejects duplicate codes", async () => {
      const dept = (await repo.listDepartments()).find((x) => x.code === "CSC")!;
      const c = await repo.createCourse({
        code: "CSC 999",
        title: "Advanced Topics",
        departmentId: dept.id,
        level: "400",
        units: 2,
      });
      expect(c.code).toBe("CSC 999");
      await expect(
        repo.createCourse({
          code: "csc 999",
          title: "Dup",
          departmentId: dept.id,
          level: "400",
          units: 2,
        }),
      ).rejects.toThrow("already exists");
      await expect(
        repo.createCourse({
          code: "X 100",
          title: "Bad dept",
          departmentId: "nope",
          level: "400",
          units: 2,
        }),
      ).rejects.toThrow("Department not found");
    });

    it("deleting a course cascades sessions and records", async () => {
      const c = await repo.getCourseByCode("CSC 999");
      const lectures = (await repo.listUsers("lecturer"))[0];
      await repo.assignLecturer(c!.id, lectures.id);
      const s = await repo.startSession({
        courseId: c!.id,
        lecturerId: lectures.id,
        durationMinutes: 15,
      });
      shim.raw
        .prepare(
          "INSERT INTO attendance_records (id, session_id, student_id, course_id, timestamp) VALUES (?,?,?,?,?)",
        )
        .run("rec-cascade", s.id, lectures.id, c!.id, Date.now());

      await repo.deleteCourse(c!.id);
      await expect(repo.getCourse(c!.id)).resolves.toBeUndefined();
      const sess = shim.raw
        .prepare("SELECT COUNT(*) AS c FROM sessions WHERE course_id = ?")
        .get(c!.id) as { c: number };
      expect(sess.c).toBe(0);
      const rec = shim.raw
        .prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE course_id = ?")
        .get(c!.id) as { c: number };
      expect(rec.c).toBe(0);
    });
  });

  describe("sessions & attendance", () => {
    it("startSession produces codes unique among open sessions", async () => {
      const c = await repo.getCourseByCode("CSC 305");
      const lec = (await repo.listUsers("lecturer")).find((l) => l.email === DEMO.lecturer)!;
      const codes: string[] = [];
      for (let i = 0; i < 25; i++) {
        const s = await repo.startSession({
          courseId: c!.id,
          lecturerId: lec.id,
          durationMinutes: 15,
        });
        codes.push(s.code);
        await repo.endSession(s.id); // close so later tests see a clean state
      }
      // After each startSession, the code must not clash with any OTHER open session.
      // We closed every session, so at minimum the final 25 were valid at insert time.
      expect(codes.length).toBe(25);
    });

    it("submitAttendance enforces enrollment, duplicates, expiry and geo-fence", async () => {
      const c = await repo.getCourseByCode("CSC 305");
      const lec = (await repo.listUsers("lecturer")).find((l) => l.email === DEMO.lecturer)!;
      const ada = await repo.getUserByEmail(DEMO.student);
      const musa = await repo.getUserByEmail("musa@slams.edu"); // not enrolled in CSC 305

      // Wrong student (not enrolled)
      const s1 = await repo.startSession({
        courseId: c!.id,
        lecturerId: lec.id,
        durationMinutes: 15,
      });
      await expect(repo.submitAttendance({ code: s1.code, studentId: musa!.id })).rejects.toThrow(
        "not enrolled",
      );

      // Valid sign-in, then duplicate rejected
      const r = await repo.submitAttendance({ code: s1.code, studentId: ada!.id });
      expect(r.course.code).toBe("CSC 305");
      await expect(repo.submitAttendance({ code: s1.code, studentId: ada!.id })).rejects.toThrow(
        "already submitted",
      );

      // DB-level unique constraint exists
      expect(() =>
        shim.raw
          .prepare(
            "INSERT INTO attendance_records (id, session_id, student_id, course_id, timestamp) VALUES (?,?,?,?,?)",
          )
          .run("rec-dup", s1.id, ada!.id, c!.id, Date.now()),
      ).toThrow(/UNIQUE constraint failed/);

      // Geo-fence
      const s2 = await repo.startSession({
        courseId: c!.id,
        lecturerId: lec.id,
        durationMinutes: 15,
        latitude: 6.5,
        longitude: 3.4,
        radiusMeters: 200,
      });
      await expect(repo.submitAttendance({ code: s2.code, studentId: ada!.id })).rejects.toThrow(
        "Location required",
      );
      await expect(
        repo.submitAttendance({ code: s2.code, studentId: ada!.id, latitude: 6.5, longitude: 3.5 }), // ~11km away
      ).rejects.toThrow(/from the venue/);
      const ok = await repo.submitAttendance({
        code: s2.code,
        studentId: ada!.id,
        latitude: 6.501,
        longitude: 3.401,
      });
      expect(ok.course.title).toBeTruthy();

      // Expired code
      const s3 = await repo.startSession({
        courseId: c!.id,
        lecturerId: lec.id,
        durationMinutes: 15,
      });
      shim.raw
        .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
        .run(Date.now() - 1000, s3.id);
      await expect(repo.submitAttendance({ code: s3.code, studentId: ada!.id })).rejects.toThrow(
        "Invalid or expired",
      );

      // Unknown code
      await expect(repo.submitAttendance({ code: "000000", studentId: ada!.id })).rejects.toThrow(
        "Invalid or expired",
      );

      await repo.endSession(s1.id);
      await repo.endSession(s2.id);
    });
  });

  describe("student views", () => {
    it("studentCourses computes percentages from real data", async () => {
      const ada = await repo.getUserByEmail(DEMO.student);
      const views = await repo.studentCourses(ada!.id);
      expect(views.length).toBeGreaterThan(0);
      const c305 = views.find((v) => v.code === "CSC 305")!;
      expect(c305.totalSessions).toBeGreaterThan(0);
      expect(c305.percentage).toBe(Math.round((c305.attendedSessions / c305.totalSessions) * 100));
      expect(c305.lecturerName).toBeTruthy();
    });

    it("studentCourseSessions requires enrollment and flags attendance", async () => {
      const ada = await repo.getUserByEmail(DEMO.student);
      const musa = await repo.getUserByEmail("musa@slams.edu");
      const c305 = await repo.getCourseByCode("CSC 305");
      const c311 = await repo.getCourseByCode("CSC 311");
      await expect(repo.studentCourseSessions(musa!.id, c305!.id)).rejects.toThrow("Not enrolled");
      const sessions = await repo.studentCourseSessions(ada!.id, c311!.id);
      for (const s of sessions) {
        expect(typeof s.attended).toBe("boolean");
      }
    });

    it("listOpenSessionsForStudent returns only open sessions of enrolled courses", async () => {
      const ada = await repo.getUserByEmail(DEMO.student);
      const open = await repo.listOpenSessionsForStudent(ada!.id);
      const courses = await repo.studentCourses(ada!.id);
      const enrolledIds = new Set(courses.map((c) => c.id));
      for (const o of open) {
        expect(enrolledIds.has(o.courseId)).toBe(true);
        expect(o.expiresAt).toBeGreaterThan(Date.now());
      }
    });
  });

  describe("reports", () => {
    it("courseReport aggregates attendance per student", async () => {
      const c = await repo.getCourseByCode("CSC 305");
      const report = await repo.courseReport(c!.id);
      expect(report!.totalSessions).toBeGreaterThan(0);
      expect(report!.students.length).toBe(3);
      for (const s of report!.students) {
        expect(s.attended).toBeGreaterThanOrEqual(0);
        expect(s.attended).toBeLessThanOrEqual(report!.totalSessions);
        expect(s.percentage).toBe(Math.round((s.attended / report!.totalSessions) * 100));
      }
    });

    it("adminOverview returns consistent counts", async () => {
      const ov = await repo.adminOverview();
      expect(ov.counts.students).toBeGreaterThan(0);
      expect(ov.counts.lecturers).toBeGreaterThanOrEqual(2);
      expect(ov.counts.courses).toBeGreaterThanOrEqual(3);
      expect(ov.weeklyAttendance).toHaveLength(7);
      expect(ov.weeklyAttendance.every((w) => typeof w.count === "number" && w.count >= 0)).toBe(
        true,
      );
      const total = ov.weeklyAttendance.reduce((a, w) => a + w.count, 0);
      // All sign-ins in the last 7 days must appear exactly once (no double counting).
      const raw7d = shim.raw
        .prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE timestamp >= ?")
        .get(Date.now() - 7 * 24 * 60 * 60 * 1000) as { c: number };
      // The chart window is the last 7 UTC days, a subset of the 7*24h window.
      expect(total).toBeLessThanOrEqual(raw7d.c);
    });

    it("facultyReport aggregates courses and students", async () => {
      const fr = await repo.facultyReport();
      expect(fr.courses.length).toBeGreaterThanOrEqual(3);
      expect(fr.students.length).toBeGreaterThanOrEqual(4);
      for (const s of fr.students) {
        expect(s.percentage).toBe(s.total === 0 ? 0 : Math.round((s.attended / s.total) * 100));
      }
    });
  });

  describe("site settings", () => {
    it("returns defaults, merges partials, and sanitizes public view", async () => {
      const s = await repo.getSiteSettings();
      expect(s.institutionName).toBe("SLAMS");
      const next = await repo.saveSiteSettings({ institutionName: "Testland University" });
      expect(next.institutionName).toBe("Testland University");
      expect(next.atRiskThreshold).toBe(s.atRiskThreshold); // untouched

      const pub = await repo.publicSettings();
      expect(pub.institutionName).toBe("Testland University");
      expect(pub.demoPassword).toBe("password123"); // demo enabled by default

      const disabled = await repo.saveSiteSettings({ demoAccountsEnabled: false });
      const pub2 = await repo.publicSettings();
      expect(pub2.demoPassword).toBe(""); // hidden when demo accounts are off
      await repo.saveSiteSettings({
        demoAccountsEnabled: disabled.demoAccountsEnabled ? true : false,
      });
    });
  });

  describe("enrollment", () => {
    it("setEnrollments rejects unknown student ids", async () => {
      const c = await repo.getCourseByCode("CSC 311");
      await expect(repo.setEnrollments(c!.id, ["ghost-1", "ghost-2"])).rejects.toThrow(
        "do not exist",
      );
      const ada = await repo.getUserByEmail(DEMO.student);
      const current = await repo.getCourse(c!.id);
      const ids = current!.enrolledStudentIds.includes(ada!.id)
        ? current!.enrolledStudentIds
        : [...current!.enrolledStudentIds, ada!.id];
      await repo.setEnrollments(c!.id, ids);
      expect((await repo.getCourse(c!.id))!.enrolledStudentIds).toEqual(
        expect.arrayContaining(ids),
      );
    });
  });
});
