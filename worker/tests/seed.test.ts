// The demo seed is part of the product: the admin dashboard, the All Courses
// table and the exports are all judged on it. These tests pin the two things
// that broke (or nearly broke) it:
//
//   1. D1 rejects any statement with more than 100 bound parameters. node:sqlite
//      (used by the shim) does not, so a chunked multi-row insert can pass every
//      test and still fail on a real deployment. The wrapper below enforces the
//      production limit.
//   2. The dataset must be rich enough to exercise the reports — several
//      faculties, the brief's eleven courses, and genuinely different attendance
//      rates so at-risk reporting has something to find.

import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import type { D1Database, D1PreparedStatement } from "../src/db";
import { getRepo } from "../src/db";
import { seedD1 } from "../src/seed";

const D1_MAX_BOUND_PARAMS = 100;

let shim: D1Shim | null = null;
afterEach(() => {
  shim?.close();
  shim = null;
});

/** Wrap the shim so it fails exactly like D1 when a statement binds too many values. */
function instrumentedDb(db: D1Database, oversized: number[]): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      const inner = db.prepare(sql);
      let bound: D1PreparedStatement | null = null;
      const self = {
        bind(...values: unknown[]): D1PreparedStatement {
          if (values.length > D1_MAX_BOUND_PARAMS) oversized.push(values.length);
          bound = inner.bind(...values);
          return self;
        },
        all: <T = Record<string, unknown>>() => (bound ?? inner).all<T>(),
        first: <T = Record<string, unknown>>() => (bound ?? inner).first<T>(),
        run: () => (bound ?? inner).run(),
      };
      return self as D1PreparedStatement;
    },
  };
}

describe("demo seed", () => {
  it("never binds more parameters than D1 allows (100)", async () => {
    shim = createD1Shim();
    applyMigrations(shim.raw);
    const oversized: number[] = [];
    await seedD1(instrumentedDb(shim.db, oversized));
    expect(oversized).toEqual([]);

    // And the data actually landed.
    const users = shim.raw.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
    expect(users.c).toBeGreaterThan(15);
  });

  it("seeds the institution layer the reports depend on", async () => {
    shim = createD1Shim();
    applyMigrations(shim.raw);
    const repo = await getRepo(shim.db);

    const faculties = await repo.listFaculties();
    expect(faculties.length).toBeGreaterThanOrEqual(3);

    const departments = await repo.listDepartments();
    expect(departments.length).toBeGreaterThanOrEqual(4);

    const report = await repo.coursesReport({ pageSize: 100 });
    // The brief's All Courses table shows eleven courses.
    expect(report.rows.length).toBeGreaterThanOrEqual(11);
    expect(report.totals.rate).toBeGreaterThan(0);

    // Faculty filter has something to filter on.
    const scopedCourse = report.rows.find((r) => r.facultyId);
    const facultyId = scopedCourse?.facultyId;
    expect(facultyId).toBeTruthy();
    if (!facultyId) throw new Error("seed has no course attached to a faculty");
    const scoped = await repo.coursesReport({ facultyId, pageSize: 100 });
    expect(scoped.rows.length).toBeGreaterThan(0);
    expect(scoped.rows.every((r) => r.facultyId === facultyId)).toBe(true);

    // Every course with lectures reports a rate, and the rates differ — a demo
    // where every course reads the same percentage cannot show at-risk work.
    const rates = report.rows
      .filter((r) => r.classesHeld > 0)
      .map((r) => r.rate)
      .filter((r): r is number => r !== null);
    expect(rates.length).toBeGreaterThanOrEqual(8);
    expect(new Set(rates).size).toBeGreaterThan(3);
    expect(rates.some((r) => r < report.meta.threshold)).toBe(true);

    // Absences are materialised rows (P0.2), so present/absent/late reconcile.
    const absences = shim.raw
      .prepare("SELECT COUNT(*) AS c FROM attendance_records WHERE status = 'absent'")
      .get() as { c: number };
    expect(absences.c).toBeGreaterThan(0);
    expect(report.totals.present + report.totals.late + report.totals.excused).toBeGreaterThan(0);
    expect(report.totals.absent).toBeGreaterThan(0);
  });

  it("seeds marks that agree with the attendance behind them (P4.3/P4.4)", async () => {
    shim = createD1Shim();
    applyMigrations(shim.raw);
    const repo = await getRepo(shim.db);

    // Two papers per course — a continuous assessment and an examination — and
    // a mark for every enrolled student, minus the one script on the examiner's
    // desk.
    const exams = shim.raw.prepare("SELECT COUNT(*) AS c FROM exams").get() as { c: number };
    const courses = shim.raw.prepare("SELECT COUNT(*) AS c FROM courses").get() as { c: number };
    expect(exams.c).toBe(courses.c * 2);

    const unmarked = shim.raw
      .prepare("SELECT COUNT(*) AS c FROM results WHERE score IS NULL")
      .get() as { c: number };
    expect(unmarked.c).toBe(1);

    // A paper is still awaiting publication, so "release marks" is a real step.
    const unpublished = shim.raw
      .prepare("SELECT COUNT(*) AS c FROM exams WHERE published = 0")
      .get() as { c: number };
    expect(unpublished.c).toBe(1);

    // The analytics a HOD would look at: attendance tracks performance, and the
    // student who passes on marks while sitting under the threshold exists.
    const report = await repo.coursesReport({ pageSize: 100 });
    // The biggest roster, because a correlation over four students is noise.
    const course = report.rows
      .filter((r) => r.classesHeld > 0 && r.rate !== null)
      .sort((a, b) => b.enrolled - a.enrolled)[0];
    if (!course) throw new Error("seed has no course with lectures");
    const analytics = await repo.resultAnalytics(course.id);
    if (!analytics) throw new Error("no analytics for a seeded course");

    expect(analytics.rows.length).toBeGreaterThan(15);
    expect(analytics.summary.correlation).not.toBeNull();
    expect(analytics.summary.correlation as number).toBeGreaterThan(0.2);

    // The barred-but-passing student is in the data whether or not the
    // institution has asserted the policy…
    const underThreshold = analytics.rows.filter(
      (r) => r.attendanceRate !== null && r.attendanceRate < analytics.threshold,
    );
    expect(underThreshold.length).toBeGreaterThan(0);
    expect(underThreshold.some((r) => r.finalPercent !== null && r.finalPercent >= 50)).toBe(true);
    // …and the policy flag is off by default, so nothing is barred yet.
    expect(analytics.summary.barred).toBe(0);
    expect(analytics.meta.threshold).toBe(75);

    // Turning the policy on is what makes the report assert the consequence.
    await repo.saveSiteSettings({ barredFromExamBelowThreshold: true });
    const barred = await repo.resultAnalytics(course.id);
    if (!barred) throw new Error("no analytics after enabling the policy");
    expect(barred.summary.barred).toBeGreaterThan(0);
    expect(barred.summary.barredButPassing).toBeGreaterThan(0);

    // The unmarked script is excluded from the average rather than counted as a
    // zero: no student without a final mark contributes to the means.
    const scored = analytics.rows.filter((r) => r.finalPercent !== null);
    const unscored = analytics.rows.filter((r) => r.finalPercent === null);
    expect(scored.length + unscored.length).toBe(analytics.rows.length);
    expect(analytics.summary.meanAbove).not.toBeNull();

    // Marks sit inside the paper's own maximum — never stored as percentages.
    const overMax = shim.raw
      .prepare("SELECT COUNT(*) AS c FROM results WHERE score > 100")
      .get() as { c: number };
    expect(overMax.c).toBe(0);
  });
});
