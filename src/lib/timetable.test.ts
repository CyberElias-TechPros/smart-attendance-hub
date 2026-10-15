// Weekly-timetable rules (plan P4.1).
//
// Clash detection is the kind of feature that looks fine until someone trusts
// it: a false positive buries a real double-booking, and a false negative means
// two cohorts turn up to the same room. These tests pin the boundaries — the
// touching-slots case in particular, because "back-to-back" is a normal
// timetable and must never be reported as a conflict.
import { describe, expect, it } from "vitest";

import {
  clashesByEntry,
  contactMinutes,
  daysOf,
  expandSchedule,
  findClashes,
  formatDuration,
  formatMinute,
  hourRange,
  overlaps,
  type TimetableEntry,
} from "./timetable";
import type { Schedule } from "./types";

function makeSchedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: over.id ?? "sched-1",
    courseId: over.courseId ?? "course-a",
    lecturerId: over.lecturerId ?? "lect-1",
    durationMinutes: over.durationMinutes ?? 60,
    topic: undefined,
    recurrence: over.recurrence ?? "weekly",
    room: over.room ?? "LT-1",
    daysMask: over.daysMask ?? "1,3",
    minuteOfDay: over.minuteOfDay ?? 9 * 60,
    tzOffsetMinutes: 60,
    occurrences: over.occurrences ?? 0,
    lastStartAt: 0,
    enabled: over.enabled ?? true,
    createdAt: 0,
    ...over,
  } as Schedule;
}

function entry(over: Partial<TimetableEntry> = {}): TimetableEntry {
  const startMinute = over.startMinute ?? 9 * 60;
  const durationMinutes = over.durationMinutes ?? 60;
  return {
    id: over.id ?? `e-${startMinute}-${over.day ?? 1}`,
    scheduleId: over.scheduleId ?? "s1",
    courseId: over.courseId ?? "course-a",
    courseCode: over.courseCode ?? "CSC 101",
    courseTitle: over.courseTitle ?? "Intro",
    lecturerId: over.lecturerId ?? "lect-1",
    lecturerName: over.lecturerName ?? "Lecturer One",
    room: over.room ?? "LT-1",
    day: over.day ?? 1,
    startMinute,
    durationMinutes,
    endMinute: startMinute + durationMinutes,
    recurrence: "weekly",
    enabled: over.enabled ?? true,
    occurrences: 0,
    maxOccurrences: undefined,
    ...over,
  };
}

describe("expanding recurring series", () => {
  it("maps recurrences to weekdays", () => {
    expect(daysOf({ recurrence: "daily", daysMask: "" })).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(daysOf({ recurrence: "weekdays", daysMask: "" })).toEqual([1, 2, 3, 4, 5]);
    expect(daysOf({ recurrence: "weekly", daysMask: "1,3,5" })).toEqual([1, 3, 5]);
    // Garbage in the mask is dropped rather than becoming a NaN column.
    expect(daysOf({ recurrence: "custom", daysMask: "2, x, 9, 4" })).toEqual([2, 4]);
  });

  it("produces one entry per meeting day with an absolute end", () => {
    const entries = expandSchedule(makeSchedule(), {
      courseCode: "CSC 101",
      courseTitle: "Intro to Computing",
      lecturerName: "Dr. One",
    });
    expect(entries.map((e) => e.day)).toEqual([1, 3]);
    for (const e of entries) {
      expect(e.startMinute).toBe(540);
      expect(e.endMinute).toBe(600);
      expect(e.courseCode).toBe("CSC 101");
      expect(e.lecturerName).toBe("Dr. One");
      expect(e.room).toBe("LT-1");
    }
  });
});

describe("overlaps", () => {
  it("treats touching slots as compatible", () => {
    const first = entry({ startMinute: 9 * 60, durationMinutes: 60 });
    const second = entry({ startMinute: 10 * 60, durationMinutes: 60 });
    expect(overlaps(first, second)).toBe(false);
    expect(overlaps(second, first)).toBe(false);
  });

  it("detects a one-minute overlap and ignores other days", () => {
    const first = entry({ startMinute: 9 * 60, durationMinutes: 60 });
    expect(overlaps(first, entry({ startMinute: 9 * 60 + 59, durationMinutes: 60 }))).toBe(true);
    expect(overlaps(first, entry({ day: 2, startMinute: 9 * 60 }))).toBe(false);
  });
});

describe("findClashes", () => {
  it("flags a shared room and a shared lecturer, and says which", () => {
    const roomA = entry({ id: "a", courseId: "c-a", courseCode: "CSC 101", room: "LT-1" });
    const roomB = entry({
      id: "b",
      courseId: "c-b",
      courseCode: "MTH 101",
      room: "lt-1 ",
      lecturerId: "lect-2",
    });
    const lectC = entry({
      id: "c",
      courseId: "c-c",
      courseCode: "PHY 101",
      room: "Lab A",
      lecturerId: "lect-1",
    });
    const same = findClashes([roomA, roomB, lectC]);
    // Room clash (case/space-insensitive) and a lecturer clash for `a`+`c`;
    // `b` and `c` share neither.
    const pairs = same.map((c) => `${c.a.id}-${c.b.id}:${c.reason}`);
    expect(pairs).toContain("a-b:room");
    expect(pairs).toContain("a-c:lecturer");
    expect(pairs).toHaveLength(2);
  });

  it("reports a pair that shares both room and lecturer once", () => {
    const a = entry({ id: "a", courseId: "c-a", room: "LT-2", lecturerId: "lect-9" });
    const b = entry({ id: "b", courseId: "c-b", room: "LT-2", lecturerId: "lect-9" });
    const clashes = findClashes([a, b]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].reason).toBe("room+lecturer");
  });

  it("never flags two series of the same course, or a paused series", () => {
    const a = entry({ id: "a", courseId: "c-a" });
    const sameCourse = entry({ id: "b", courseId: "c-a" });
    expect(findClashes([a, sameCourse])).toHaveLength(0);
    const paused = entry({ id: "c", courseId: "c-c", enabled: false });
    expect(findClashes([a, paused])).toHaveLength(0);
  });

  it("orders clashes by day then start time, and indexes them by entry", () => {
    const a = entry({ id: "a", courseId: "c-a", day: 3, startMinute: 14 * 60, room: "LT-1" });
    const b = entry({ id: "b", courseId: "c-b", day: 3, startMinute: 14 * 60, room: "LT-1" });
    const c = entry({ id: "c", courseId: "c-c", day: 1, startMinute: 8 * 60, room: "LT-1" });
    const d = entry({ id: "d", courseId: "c-d", day: 1, startMinute: 8 * 60, room: "LT-1" });
    const clashes = findClashes([a, b, c, d]);
    expect(clashes.map((x) => x.a.id)).toEqual(["c", "a"]);
    const byEntry = clashesByEntry(clashes);
    expect(byEntry.get("a")).toHaveLength(1);
    expect(byEntry.get("b")?.[0].a.id).toBe("a");
    expect(byEntry.get("z")).toBeUndefined();
  });
});

describe("grid helpers", () => {
  it("counts weekly contact minutes from live series only", () => {
    const entries = [
      entry({ id: "a", durationMinutes: 60 }),
      entry({ id: "b", durationMinutes: 45 }),
      entry({ id: "c", durationMinutes: 120, enabled: false }),
    ];
    expect(contactMinutes(entries)).toBe(105);
    expect(formatDuration(105)).toBe("1 h 45 m");
    expect(formatDuration(45)).toBe("45 m");
    expect(formatDuration(120)).toBe("2 h");
  });

  it("pads the time axis to whole hours around the busiest day", () => {
    expect(hourRange([])).toEqual({ from: 8 * 60, to: 18 * 60 });
    const entries = [
      entry({ id: "a", startMinute: 7 * 60 + 30, durationMinutes: 45 }),
      entry({ id: "b", startMinute: 18 * 60 + 15, durationMinutes: 45 }),
    ];
    expect(hourRange(entries)).toEqual({ from: 7 * 60, to: 19 * 60 });
  });

  it("formats wall-clock minutes", () => {
    expect(formatMinute(0)).toBe("00:00");
    expect(formatMinute(9 * 60 + 5)).toBe("09:05");
    expect(formatMinute(23 * 60 + 59)).toBe("23:59");
  });
});
