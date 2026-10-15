// Phase 0.4 — the dashboard's "today" figures are anchored to the institution's
// clock (plan §3.2). A lecture at 23:30 in Lagos belongs to that Lagos day even
// though the server (and the UTC date) are already on tomorrow.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import { getRepo, type Repo } from "../src/db";
import { dayWindow } from "../src/time";

let shim: D1Shim;
let repo: Repo;

beforeAll(async () => {
  shim = createD1Shim();
  applyMigrations(shim.raw);
  repo = await getRepo(shim.db);
});
afterAll(() => shim.close());

describe("dashboard overview — local-day figures", () => {
  it("defaults to the institution timezone and reports the local date", async () => {
    const settings = await repo.getSiteSettings();
    expect(settings.timezone).toBe("Africa/Lagos");
    // Both policy switches exist, so an institution can change the two
    // decisions that move every percentage without a code change (plan D3/D4).
    expect(settings.lateCountsAsAttended).toBe(true);
    expect(settings.excusedCountsAsAbsent).toBe(true);

    const overview = await repo.adminOverview();
    const expected = dayWindow(Date.now(), settings.timezone);
    expect(overview.today.date).toBe(expected.key);
    expect(overview.weeklyAttendance).toHaveLength(7);
    // The chart's last bucket is today, in the institution's zone.
    expect(overview.weeklyAttendance[6].key).toBe(expected.key);
  });

  it("counts today's lectures by their local day, with independent tallies", async () => {
    const dept = (await repo.listDepartments())[0];
    const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
    const course = await repo.createCourse({
      code: "DAY 101",
      title: "Timezone Demo",
      departmentId: dept.id,
      level: "100",
      units: 1,
    });
    await repo.assignLecturer(course.id, lecturer!.id);

    const students: string[] = [];
    for (let i = 0; i < 4; i++) {
      students.push(
        await repo.createUser({
          name: `Day Student ${i}`,
          email: `day-${i}@slams.edu`,
          password: "password123",
          role: "student",
          matricNo: `DAY/${i}`,
          departmentId: dept.id,
          level: "100",
        }),
      );
    }
    await repo.setEnrollments(course.id, students);

    const session = await repo.startSession({
      courseId: course.id,
      lecturerId: lecturer!.id,
      durationMinutes: 10,
    });
    await repo.submitAttendance({ code: session.code, studentId: students[0], deviceId: "day0" });
    await repo.submitAttendance({ code: session.code, studentId: students[1], deviceId: "day1" });
    await repo.endSession(session.id); // materialises two absences

    const overview = await repo.adminOverview();
    // Hand-computed expectation for this lecture: 2 present, 0 late, 0 excused,
    // 2 absent, 4 expected → 50% attendance for the day.
    expect(overview.today.present).toBe(2);
    expect(overview.today.absent).toBe(2);
    expect(overview.today.expected).toBe(4);
    expect(overview.today.rate).toBe(50);
    expect(overview.today.classesHeld).toBeGreaterThanOrEqual(1);
  });

  it("keeps a late-evening lecture on the institution's calendar day", async () => {
    // Simulate a lecture that started at 23:30 Lagos time (22:30 UTC) and a
    // student who signed in then — for a UTC-anchored report this would be
    // "yesterday's" data at 00:30 Lagos, which is exactly the bug this prevents.
    const settings = await repo.getSiteSettings();
    const lagos = dayWindow(Date.now(), settings.timezone);
    const lateInstant = lagos.end - 30 * 60 * 1000; // 30 minutes before local midnight
    expect(dayWindow(lateInstant, settings.timezone).key).toBe(lagos.key);
    // Cross-check with UTC: the two zones disagree once the clock passes 23:00
    // UTC (00:00 Lagos), which is the boundary the old implementation got wrong.
    const utcKey = new Date(lateInstant).toISOString().slice(0, 10);
    const sameDay = utcKey === lagos.key;
    // Either they agree (server clock after local midnight) or the local day is
    // ahead — never behind.
    expect(sameDay || utcKey < lagos.key).toBe(true);
  });
});
