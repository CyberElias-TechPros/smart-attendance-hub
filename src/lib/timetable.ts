// Weekly-timetable maths: expanding recurring series into a grid, and finding
// the clashes an institution actually cares about.
//
// Kept pure and separate from the page for the same reason the attendance maths
// lives in `shared/`: the rules are the interesting part, and they need to be
// testable without a DOM. Everything is in *wall-clock* minutes relative to the
// series' own local `minuteOfDay`/`tzOffsetMinutes`, which is how a timetable is
// published and read — a 09:00 lecture is at 09:00 for the people in the room.

import type { Schedule } from "./types";

/** ISO weekdays, Monday first (matches `daysMask` and the brief's grid order). */
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface TimetableEntry {
  /** `${scheduleId}:${day}` — one series occupies one cell per meeting day. */
  id: string;
  scheduleId: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  lecturerId?: string;
  lecturerName?: string;
  room?: string;
  /** ISO weekday number, 1 = Monday. */
  day: number;
  /** Wall-clock minutes from midnight in the series' local time. */
  startMinute: number;
  durationMinutes: number;
  endMinute: number;
  topic?: string;
  recurrence: string;
  enabled: boolean;
  /** Legs the series has already delivered, and its cap when it has one. */
  occurrences: number;
  maxOccurrences?: number;
}

export interface Clash {
  a: TimetableEntry;
  b: TimetableEntry;
  /** Why the pair conflicts — shown to the user, never guessed. */
  reason: "room" | "lecturer" | "room+lecturer";
}

/** Which weekdays a series meets on, from its recurrence and day mask. */
export function daysOf(schedule: Pick<Schedule, "recurrence" | "daysMask">): number[] {
  if (schedule.recurrence === "daily") return [1, 2, 3, 4, 5, 6, 7];
  if (schedule.recurrence === "weekdays") return [1, 2, 3, 4, 5];
  return schedule.daysMask
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

export interface ScheduleMeta {
  courseCode: string;
  courseTitle: string;
  lecturerName?: string;
}

/** One entry per meeting day; a paused series still appears (the grid shows it). */
export function expandSchedule(schedule: Schedule, meta: ScheduleMeta): TimetableEntry[] {
  const lecturerId = schedule.lecturerId;
  return daysOf(schedule).map((day) => ({
    id: `${schedule.id}:${day}`,
    scheduleId: schedule.id,
    courseId: schedule.courseId,
    courseCode: meta.courseCode,
    courseTitle: meta.courseTitle,
    lecturerId,
    lecturerName: meta.lecturerName,
    room: schedule.room,
    day,
    startMinute: schedule.minuteOfDay,
    durationMinutes: schedule.durationMinutes,
    endMinute: schedule.minuteOfDay + schedule.durationMinutes,
    topic: schedule.topic,
    recurrence: schedule.recurrence,
    enabled: schedule.enabled,
    occurrences: schedule.occurrences,
    maxOccurrences: schedule.maxOccurrences,
  }));
}

/**
 * Two slots on the same day conflict when they genuinely overlap in time.
 * Back-to-back lectures (one ending exactly when the next begins) are *not* a
 * clash — that is a normal timetable, and flagging it would bury the real ones.
 */
export function overlaps(a: TimetableEntry, b: TimetableEntry): boolean {
  if (a.day !== b.day) return false;
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

function sameRoom(a: TimetableEntry, b: TimetableEntry): boolean {
  const ra = a.room?.trim().toLowerCase();
  const rb = b.room?.trim().toLowerCase();
  return Boolean(ra) && ra === rb;
}

function sameLecturer(a: TimetableEntry, b: TimetableEntry): boolean {
  return Boolean(a.lecturerId) && a.lecturerId === b.lecturerId;
}

/**
 * Every conflicting pair, in a stable order (by day, then start time, then
 * course code) so a refreshed page lists them identically.
 *
 * Paused series are excluded: a series that is not running cannot clash with
 * anything, and including it would make the count depend on history.
 */
export function findClashes(entries: TimetableEntry[]): Clash[] {
  const live = entries.filter((e) => e.enabled);
  const clashes: Clash[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      // Two slots of the same course are the same lecture series, not a clash.
      if (a.courseId === b.courseId) continue;
      if (!overlaps(a, b)) continue;
      const room = sameRoom(a, b);
      const lecturer = sameLecturer(a, b);
      if (!room && !lecturer) continue;
      clashes.push({
        a,
        b,
        reason: room && lecturer ? "room+lecturer" : room ? "room" : "lecturer",
      });
    }
  }
  return clashes.sort(
    (x, y) =>
      x.a.day - y.a.day ||
      x.a.startMinute - y.a.startMinute ||
      x.a.courseCode.localeCompare(y.a.courseCode) ||
      x.b.courseCode.localeCompare(y.b.courseCode),
  );
}

/** Map of entry id → the ids it clashes with, for highlighting grid cells. */
export function clashesByEntry(clashes: Clash[]): Map<string, Clash[]> {
  const out = new Map<string, Clash[]>();
  for (const c of clashes) {
    for (const entry of [c.a, c.b]) {
      const list = out.get(entry.id) ?? [];
      list.push(c);
      out.set(entry.id, list);
    }
  }
  return out;
}

/** Teaching minutes a week (paused series excluded). */
export function contactMinutes(entries: TimetableEntry[]): number {
  return entries.filter((e) => e.enabled).reduce((sum, e) => sum + e.durationMinutes, 0);
}

/** "09:00" from minutes-from-midnight. */
export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Hours as "1 h 45 m" / "45 m" — printed in the grid header and exports. */
export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours === 0) return `${minutes} m`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} m`;
}

/** The grid's time axis: whole hours from the earliest start, default 08:00–18:00. */
export function hourRange(entries: TimetableEntry[]): { from: number; to: number } {
  const starts = entries.map((e) => e.startMinute);
  const ends = entries.map((e) => e.endMinute);
  const min = starts.length ? Math.min(...starts) : 8 * 60;
  const max = ends.length ? Math.max(...ends) : 18 * 60;
  return { from: Math.floor(min / 60) * 60, to: Math.ceil(max / 60) * 60 };
}
