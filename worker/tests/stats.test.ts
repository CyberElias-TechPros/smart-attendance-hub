// Golden tests for the attendance mathematics (plan §8 / P0.1).
//
// These exist because the previous admin report averaged *student* percentages,
// which is wrong whenever enrolments differ in size. The regression case is
// spelled out explicitly below ("opportunity-weighted roll-up").
import { describe, expect, it } from "vitest";

import {
  attendedCount,
  deltaPoints,
  emptyCounts,
  expectedCount,
  formatPercent,
  health,
  meanOfPercentages,
  percentage,
  percentageInt,
  rate,
  tallyStatuses,
  weightedPercentage,
} from "../src/stats";
import * as clientMath from "../../src/lib/attendance-math";
import * as serverMath from "../src/stats";
import { dayWindow, isValidTimeZone, minutesInZone, recentDayWindows } from "../src/time";

describe("attendance math — counts", () => {
  it("splits a roster tally into attended and expected opportunities", () => {
    const counts = { present: 14, late: 2, excused: 1, absent: 5 };
    expect(attendedCount(counts)).toBe(16); // present + late
    expect(expectedCount(counts)).toBe(22); // every recorded opportunity
    expect(percentage(16, 22, 1)).toBe(72.7);
  });

  it("can exclude excused absences from the denominator (institution option)", () => {
    const counts = { present: 14, late: 2, excused: 1, absent: 5 };
    expect(expectedCount(counts, { excusedCountsAsAbsent: false })).toBe(21);
    expect(percentage(16, 21, 1)).toBe(76.2);
  });

  it("can stop counting lateness as attendance (institution option)", () => {
    const counts = { present: 14, late: 3, excused: 0, absent: 0 };
    expect(attendedCount(counts, { lateCountsAsAttended: false })).toBe(14);
    expect(attendedCount(counts)).toBe(17);
  });

  it("tallies raw status rows and ignores unknown statuses", () => {
    const counts = tallyStatuses([
      { status: "present" },
      { status: "present" },
      { status: "late" },
      { status: "excused" },
      { status: "absent" },
      { status: "something-new" },
      { status: null },
    ]);
    expect(counts).toEqual({ present: 2, late: 1, excused: 1, absent: 1 });
    expect(tallyStatuses([])).toEqual(emptyCounts());
  });
});

describe("attendance math — rates", () => {
  it("returns a ratio in [0,1] and null for an empty denominator", () => {
    expect(rate(9, 10)).toBeCloseTo(0.9, 10);
    expect(rate(0, 0)).toBeNull();
    expect(rate(5, 0)).toBeNull();
  });

  it("rounds exactly once, at the requested precision", () => {
    // 13/16 = 0.8125
    expect(percentage(13, 16, 1)).toBe(81.3);
    expect(percentage(13, 16, 2)).toBe(81.25);
    expect(percentageInt(13, 16)).toBe(81);
    expect(percentage(2, 3, 0)).toBe(67);
  });

  it("never renders a course with no lectures as 0%", () => {
    expect(percentage(0, 0)).toBeNull();
    expect(percentageInt(0, 0)).toBeNull();
    expect(formatPercent(null)).toBe("—");
  });

  it("clamps impossible counts instead of emitting >100%", () => {
    expect(percentage(20, 10)).toBe(100);
  });
});

describe("attendance math — opportunity-weighted roll-up (the brief's §8 rule)", () => {
  it("does NOT equal the mean of the course percentages when enrolments differ", () => {
    // Two courses, deliberately lopsided (the real-world case the plan calls out:
    // 428 students at 87.5% next to 233 at 68.8%).
    const big = { attended: 374, expected: 428 }; // 87.4%
    const small = { attended: 160, expected: 233 }; // 68.7%

    const weighted = weightedPercentage([big, small], 1);
    const naiveMean = meanOfPercentages([
      percentage(big.attended, big.expected, 1),
      percentage(small.attended, small.expected, 1),
    ]);

    expect(weighted).toBe(80.8); // (374+160)/(428+233) = 80.79%
    expect(naiveMean).toBe(78.1);
    // The whole point: the roll-up is pulled toward the larger cohort.
    expect(weighted).not.toBe(naiveMean);
    expect(weighted!).toBeGreaterThan(naiveMean!);
  });

  it("equals the arithmetic mean only when every group is the same size", () => {
    const groups = [
      { attended: 8, expected: 10 }, // 80%
      { attended: 6, expected: 10 }, // 60%
    ];
    expect(weightedPercentage(groups, 1)).toBe(70);
  });

  it("is invariant to how the same opportunities are grouped", () => {
    const flat = weightedPercentage([{ attended: 30, expected: 40 }], 1);
    const chunked = weightedPercentage(
      [
        { attended: 10, expected: 15 },
        { attended: 20, expected: 25 },
      ],
      1,
    );
    expect(chunked).toBe(flat);
  });

  it("reports null when nothing was expected, and ignores empty parts", () => {
    expect(weightedPercentage([])).toBeNull();
    expect(weightedPercentage([{ attended: 0, expected: 0 }])).toBeNull();
  });
});

describe("attendance math — presentation helpers", () => {
  it("classification follows the institution threshold", () => {
    expect(health(92.4, 75)).toBe("good");
    expect(health(72, 75)).toBe("watch");
    expect(health(64, 75)).toBe("at-risk");
    expect(health(40, 75)).toBe("critical");
    expect(health(null, 75)).toBeNull();
  });

  it("formats percentages for dense tables", () => {
    expect(formatPercent(92.4)).toBe("92.4%");
    expect(formatPercent(92)).toBe("92%");
    expect(formatPercent(68.75, 2)).toBe("68.75%");
  });

  it("computes percentage-point deltas", () => {
    expect(deltaPoints(92.4, 89.4)).toBe(3);
    expect(deltaPoints(92.4, null)).toBeNull();
    expect(deltaPoints(88.25, 90, 2)).toBe(-1.75);
  });
});

describe("attendance math — worker and client agree", () => {
  it("exposes the identical implementation on both sides", () => {
    // Guards against the drift the old code suffered from: the SPA mirrored the
    // formula by hand, so a fix on one side left the other wrong. Both entry
    // points now re-export the same module object.
    expect(clientMath.percentage).toBe(percentage);
    expect(clientMath.weightedPercentage).toBe(weightedPercentage);
    expect(clientMath.attendedCount).toBe(attendedCount);
    expect(clientMath.expectedCount).toBe(expectedCount);
    expect(clientMath.formatPercent).toBe(formatPercent);
    expect(clientMath.health).toBe(health);

    // Every server export exists on the client surface too.
    for (const [name, value] of Object.entries(serverMath)) {
      expect(typeof (clientMath as Record<string, unknown>)[name], `${name} missing`).toBe(
        typeof value,
      );
    }
  });
});

describe("institution timezone arithmetic (plan §3.2 / P0.4)", () => {
  it("computes local midnight for a positive-offset zone", () => {
    // 2025-10-14T22:30:00Z is 23:30 on the 14th in Lagos (UTC+1).
    const instant = Date.UTC(2025, 9, 14, 22, 30);
    const win = dayWindow(instant, "Africa/Lagos");
    expect(new Date(win.start).toISOString()).toBe("2025-10-13T23:00:00.000Z");
    expect(new Date(win.end).toISOString()).toBe("2025-10-14T23:00:00.000Z");
    expect(win.key).toBe("2025-10-14");
    expect(win.label).toContain("14");
  });

  it("keeps a late-evening lecture on the right day for a UTC server", () => {
    // 23:30 Lagos on the 14th == 22:30 UTC on the 14th: same local day, and the
    // same UTC day here — but at 00:30 Lagos on the 15th the two disagree.
    const afterMidnight = Date.UTC(2025, 9, 14, 23, 30); // 00:30 Lagos on the 15th
    expect(dayWindow(afterMidnight, "Africa/Lagos").key).toBe("2025-10-15");
    expect(dayWindow(afterMidnight, "UTC").key).toBe("2025-10-14");
  });

  it("handles zones west of UTC", () => {
    const instant = Date.UTC(2025, 9, 14, 5, 0); // 01:00 on the 14th in New York
    const win = dayWindow(instant, "America/New_York");
    expect(win.key).toBe("2025-10-14");
    expect(new Date(win.start).toISOString()).toBe("2025-10-14T04:00:00.000Z");
  });

  it("survives a DST transition without drifting a day", () => {
    // Europe/London leaves BST on 2025-10-26 (01:00 UTC).
    const before = dayWindow(Date.UTC(2025, 9, 25, 12, 0), "Europe/London");
    const after = dayWindow(Date.UTC(2025, 9, 26, 12, 0), "Europe/London");
    expect(before.key).toBe("2025-10-25");
    expect(after.key).toBe("2025-10-26");
    // Local midnight on the 26th is still BST (the clocks go back at 02:00 that
    // day), so the window start is correctly offset by +60 minutes…
    expect(minutesInZone(before.start, "Europe/London")).toBe(60);
    expect(minutesInZone(after.start, "Europe/London")).toBe(60);
    // …and the following day is genuine GMT: the offset changed, the day did not.
    const next = dayWindow(Date.UTC(2025, 9, 27, 12, 0), "Europe/London");
    expect(next.key).toBe("2025-10-27");
    expect(minutesInZone(next.start, "Europe/London")).toBe(0);
    expect(before.end).toBe(after.start); // consecutive windows tile exactly
    expect(after.end).toBe(next.start);
  });

  it("returns consecutive, non-overlapping windows for a chart", () => {
    const windows = recentDayWindows(Date.UTC(2025, 9, 14, 9, 0), "Africa/Lagos", 7);
    expect(windows).toHaveLength(7);
    expect(windows[6].key).toBe("2025-10-14");
    expect(windows[0].key).toBe("2025-10-08");
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].start).toBe(windows[i - 1].end);
    }
  });

  it("falls back to UTC instead of throwing on a bad zone", () => {
    const win = dayWindow(Date.UTC(2025, 9, 14, 9, 0), "Not/AZone");
    expect(win.key).toBe("2025-10-14");
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("Africa/Lagos")).toBe(true);
  });
});
