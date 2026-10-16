// Attendance mathematics — THE single source of truth for every rate the
// product displays, exports, or reports on. (Plan: docs/UPGRADE-PLAN.md §8.)
//
// Why a module instead of inline SQL arithmetic:
//   1. The brief's §8 rule ("course-wide percentage must be computed over the
//      total attendance opportunities across eligible students and sessions —
//      do NOT average course percentages when enrolments differ") is easy to
//      get subtly wrong in five different places. It lives here once.
//   2. Rounding policy is centralised: compute at full precision, round exactly
//      once at the presentation edge, and never re-aggregate rounded values
//      (that is how the old UI drifted: it averaged per-student percentages).
//   3. The client mirrors this module (src/lib/attendance-math.ts) and a test
//      asserts the two agree, so the UI can never tell a different story from
//      the server.
//
// Vocabulary
//   opportunity ("expected") — one student × one lecture they were expected to
//                               attend. The denominator of every rate.
//   attended                  — present + late (see lateCountsAsAttended).
//   excused                   — an approved absence. By default it is still an
//                               expectation that was not met (it does not
//                               inflate the rate); institutions can opt to
//                               drop excused rows from the denominator.
//
// Nothing here touches the database or the network: pure functions, pure tests.

export type AttendanceStatus = "present" | "late" | "excused" | "absent";

/** Statuses that count as "attended" when the institution counts lateness. */
export const ATTENDED_STATUSES: readonly AttendanceStatus[] = ["present", "late"];

/** Statuses that represent a recorded, unmet expectation. */
export const UNMET_STATUSES: readonly AttendanceStatus[] = ["absent"];

export interface StatusCounts {
  present: number;
  late: number;
  excused: number;
  absent: number;
}

export interface RateOptions {
  /** Count `late` as attended (default true — plan decision D4). */
  lateCountsAsAttended?: boolean;
  /** Count `excused` in the denominator as an unmet expectation (default true,
   *  the conservative reading — plan decision D3). When false, an approved
   *  excuse removes the expectation entirely. */
  excusedCountsAsAbsent?: boolean;
}

export const DEFAULT_RATE_OPTIONS: Required<RateOptions> = {
  lateCountsAsAttended: true,
  excusedCountsAsAbsent: true,
};

export function emptyCounts(): StatusCounts {
  return { present: 0, late: 0, excused: 0, absent: 0 };
}

/** Tally a list of records/rows by status (unknown statuses are ignored, so a
 *  future status can never silently corrupt a rate). */
export function tallyStatuses(
  rows: ReadonlyArray<{ status?: string | null }> | ReadonlyArray<string | null | undefined>,
): StatusCounts {
  const out = emptyCounts();
  for (const row of rows) {
    const status = typeof row === "string" ? row : (row?.status ?? null);
    if (status === "present") out.present++;
    else if (status === "late") out.late++;
    else if (status === "excused") out.excused++;
    else if (status === "absent") out.absent++;
  }
  return out;
}

export function countsEqual(a: StatusCounts, b: StatusCounts): boolean {
  return (
    a.present === b.present && a.late === b.late && a.excused === b.excused && a.absent === b.absent
  );
}

/** attended = present + (late, when the institution counts it). */
export function attendedCount(
  counts: StatusCounts,
  options: RateOptions = DEFAULT_RATE_OPTIONS,
): number {
  const opts = { ...DEFAULT_RATE_OPTIONS, ...options };
  return counts.present + (opts.lateCountsAsAttended ? counts.late : 0);
}

/** expected = every opportunity a student had to attend. An `excused` absence
 *  is, by default, still one of those opportunities (an approved reason for
 *  missing it, not a lecture that never happened). */
export function expectedCount(
  counts: StatusCounts,
  options: RateOptions = DEFAULT_RATE_OPTIONS,
): number {
  const opts = { ...DEFAULT_RATE_OPTIONS, ...options };
  return (
    counts.present + counts.late + counts.absent + (opts.excusedCountsAsAbsent ? counts.excused : 0)
  );
}

/** Raw ratio in [0, 1]; `null` when there is no denominator (render "—",
 *  never "0%" — a course with no lectures yet is not a 0% course). */
export function rate(attended: number, expected: number): number | null {
  if (!Number.isFinite(attended) || !Number.isFinite(expected) || expected <= 0) return null;
  return Math.min(1, Math.max(0, attended / expected));
}

/** Percentage rounded once, at the edge, to `decimals` places. `null` when
 *  there is no denominator. */
export function percentage(attended: number, expected: number, decimals = 1): number | null {
  const r = rate(attended, expected);
  if (r === null) return null;
  const factor = 10 ** decimals;
  return Math.round(r * 100 * factor) / factor;
}

/** Whole-number percentage (the values shown in the All-Courses table). */
export function percentageInt(attended: number, expected: number): number | null {
  const p = percentage(attended, expected, 0);
  return p === null ? null : p;
}

/** Opportunity-weighted roll-up across many groups (courses, departments, …).
 *
 *  This is the function that makes enrolments of different sizes comparable:
 *  it sums attended opportunities and expected opportunities *before* dividing
 *  — the exact opposite of averaging group percentages. */
export function weightedPercentage(
  parts: ReadonlyArray<{ attended: number; expected: number }>,
  decimals = 1,
): number | null {
  let attended = 0;
  let expected = 0;
  for (const p of parts) {
    attended += p.attended;
    expected += p.expected;
  }
  return percentage(attended, expected, decimals);
}

/** Deliberately-named helper so a reviewer can see that averaging group
 *  percentages is only acceptable for *equal-sized* groups (never used for
 *  attendance). Kept exported for the parity test and documentation value. */
export function meanOfPercentages(values: ReadonlyArray<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length === 0) return null;
  return Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 10) / 10;
}

export type AttendanceHealth = "good" | "watch" | "at-risk" | "critical";

/** Badge classification shared by the dashboard, tables, and exports. */
export function health(percent: number | null, threshold = 75): AttendanceHealth | null {
  if (percent === null) return null;
  if (percent >= threshold) return "good";
  if (percent >= threshold - 5) return "watch";
  if (percent >= threshold - 15) return "at-risk";
  return "critical";
}

/** Human-readable percentage for tables, PDFs, and empty states. */
export function formatPercent(percent: number | null, decimals = 1): string {
  if (percent === null) return "—";
  const fixed = percent.toFixed(decimals);
  // 92.0% -> 92% keeps dense tables readable; 92.4% stays precise.
  return `${fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed}%`;
}

/** Percentage-point delta between two rates, or null when either is unknown. */
export function deltaPoints(
  current: number | null,
  previous: number | null,
  decimals = 1,
): number | null {
  if (current === null || previous === null) return null;
  const factor = 10 ** decimals;
  return Math.round((current - previous) * factor) / factor;
}
