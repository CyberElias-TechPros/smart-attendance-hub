// Grading rules (plan §4.4 / P4.3) — the same module the Worker imports.
//
// A grade appears on a lecturer's mark sheet, in an Excel export, on a student's
// own results page and in the analytics scatter. Four surfaces, one rule: that is
// the whole reason this file exists rather than a `grade()` helper in each place.
import { describe, expect, it } from "vitest";

import {
  correlation,
  gradeFor,
  gradeForPercent,
  isPassGrade,
  percentOf,
  roundTo,
  weightedFinalPercent,
} from "../../shared/grades";

describe("rounding and percentages", () => {
  it("rounds once, to one decimal by default", () => {
    expect(roundTo(74.44, 1)).toBe(74.4);
    expect(roundTo(74.45, 1)).toBe(74.5); // half-up, not banker's rounding
    expect(roundTo(74.45, 0)).toBe(74);
    expect(roundTo(0.005, 2)).toBe(0.01);
  });

  it("derives a percentage from a raw score and its maximum", () => {
    expect(percentOf(14, 20)).toBe(70);
    expect(percentOf(0, 20)).toBe(0);
    expect(percentOf(20, 20)).toBe(100);
    expect(percentOf(87.5, 100)).toBe(87.5);
  });

  it("refuses to invent a percentage without a score or a maximum", () => {
    // "Not marked" must never become 0: an unmarked script is not a fail.
    expect(percentOf(null, 100)).toBeNull();
    expect(percentOf(50, 0)).toBeNull();
    expect(percentOf(Number.NaN, 100)).toBeNull();
  });
});

describe("grade bands", () => {
  it("maps the boundary percentages", () => {
    expect(gradeForPercent(100)).toBe("A");
    expect(gradeForPercent(70)).toBe("A"); // inclusive lower bound
    expect(gradeForPercent(69.9)).toBe("B");
    expect(gradeForPercent(60)).toBe("B");
    expect(gradeForPercent(59.9)).toBe("C");
    expect(gradeForPercent(50)).toBe("C");
    expect(gradeForPercent(49.9)).toBe("D");
    expect(gradeForPercent(45)).toBe("D");
    expect(gradeForPercent(44.9)).toBe("E");
    expect(gradeForPercent(40)).toBe("E");
    expect(gradeForPercent(39.9)).toBe("F");
    expect(gradeForPercent(0)).toBe("F");
  });

  it("has no grade for a missing mark", () => {
    expect(gradeForPercent(null)).toBeUndefined();
    expect(gradeForPercent(Number.NaN)).toBeUndefined();
  });

  it("grades from a raw score against its own maximum", () => {
    expect(gradeFor(14, 20)).toBe("A"); // 70% of 20
    expect(gradeFor(9, 20)).toBe("D"); // 45%
    expect(gradeFor(null, 20)).toBeUndefined();
  });

  it("knows a passing grade from a failing one", () => {
    expect(isPassGrade("A")).toBe(true);
    expect(isPassGrade("E")).toBe(true);
    expect(isPassGrade("F")).toBe(false);
    expect(isPassGrade(undefined)).toBe(false);
  });
});

describe("weighted final percentage", () => {
  it("weights each exam in proportion to its declared weight", () => {
    // 50% weighting on a 60% CA and 50% weighting on an 80% exam ⇒ 70%.
    expect(
      weightedFinalPercent([
        { percent: 60, weight: 50 },
        { percent: 80, weight: 50 },
      ]),
    ).toBe(70);
    // The same percentages with unequal weights must NOT average to 70.
    expect(
      weightedFinalPercent([
        { percent: 60, weight: 20 },
        { percent: 80, weight: 80 },
      ]),
    ).toBe(76);
  });

  it("counts an unweighted exam once", () => {
    expect(weightedFinalPercent([{ percent: 40 }, { percent: 60 }])).toBe(50);
    // A zero or negative weight is treated as "count once", never as "ignore".
    expect(weightedFinalPercent([{ percent: 40, weight: 0 }, { percent: 60 }])).toBe(50);
  });

  it("skips unmarked exams instead of scoring them as zero", () => {
    expect(
      weightedFinalPercent([
        { percent: 90, weight: 50 },
        { percent: null, weight: 50 },
      ]),
    ).toBe(90);
  });

  it("returns null when nothing was marked", () => {
    expect(weightedFinalPercent([{ percent: null }, { percent: null }])).toBeNull();
    expect(weightedFinalPercent([])).toBeNull();
  });
});

describe("correlation", () => {
  it("is 1 for a perfect positive relationship and −1 for a perfect negative one", () => {
    expect(
      correlation([
        [10, 20],
        [20, 40],
        [30, 60],
        [40, 80],
      ]),
    ).toBe(1);
    expect(
      correlation([
        [10, 80],
        [20, 60],
        [30, 40],
        [40, 20],
      ]),
    ).toBe(-1);
  });

  it("refuses to draw a line through too little data, or through no variance", () => {
    expect(correlation([[10, 20]])).toBeNull();
    expect(
      correlation([
        [10, 50],
        [20, 60],
      ]),
    ).toBeNull();
    // Every student attended 100% → nothing to correlate against.
    expect(
      correlation([
        [100, 60],
        [100, 70],
        [100, 80],
      ]),
    ).toBeNull();
  });

  it("reports a strong-but-imperfect relationship honestly", () => {
    const r = correlation([
      [95, 88],
      [80, 72],
      [70, 74],
      [60, 55],
      [50, 61],
      [40, 30],
    ]);
    expect(r).not.toBeNull();
    expect(r as number).toBeGreaterThan(0.85);
    expect(r as number).toBeLessThan(1);
  });
});
