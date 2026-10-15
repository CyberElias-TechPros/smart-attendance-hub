// Grading and rounding rules (plan §4.4 / P4.3).
//
// Kept shared and pure for the same reason the attendance maths is: a grade is an
// institutional decision that appears on a transcript, in an export and on a
// student's own page, and those three must never disagree. It also means the
// rules are unit-testable without a database.
//
// Deliberate choices:
//   * A bare percentage is derived from `score / maxScore`, never stored in its
//     place. Re-weighting an assessment therefore cannot rewrite history.
//   * Rounding happens once, at the edge, to one decimal place — the same rule
//     the attendance percentages follow.

/** Round to `decimals` places. Returns a number, not a string. */
export function roundTo(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** 0–100 percentage of a raw score. `null` when the raw score is missing. */
export function percentOf(score: number | null, maxScore: number): number | null {
  if (score == null || !Number.isFinite(score) || maxScore <= 0) return null;
  return roundTo((score / maxScore) * 100, 1);
}

/**
 * The default grade band used when an exam carries no explicit grade.
 *
 * These are the common Nigerian/British undergraduate bands (A 70+, B 60–69,
 * C 50–59, D 45–49, E 40–44, F below 40). An institution that grades differently
 * stores its own `grade` per result — which is why the value is persisted rather
 * than always recomputed.
 */
export function gradeForPercent(percent: number | null): string | undefined {
  if (percent == null || !Number.isFinite(percent)) return undefined;
  if (percent >= 70) return "A";
  if (percent >= 60) return "B";
  if (percent >= 50) return "C";
  if (percent >= 45) return "D";
  if (percent >= 40) return "E";
  return "F";
}

/** Convenience: grade straight from a raw score against its maximum. */
export function gradeFor(score: number | null, maxScore: number): string | undefined {
  return gradeForPercent(percentOf(score, maxScore));
}

/** True when the grade is a passing one (used by the barred-from-exam panel). */
export function isPassGrade(grade: string | undefined, passMark = 40): boolean {
  if (!grade) return false;
  return grade !== "F" || passMark <= 0;
}

/**
 * Weighted mean of a student's exam percentages.
 *
 * An exam with a weight contributes in proportion to it; an exam without one
 * counts once. Exams the student has no mark for are skipped entirely rather than
 * counted as zero, because "not marked yet" is not "failed".
 */
export function weightedFinalPercent(
  entries: ReadonlyArray<{ percent: number | null; weight?: number }>,
): number | null {
  let sum = 0;
  let total = 0;
  for (const entry of entries) {
    if (entry.percent == null) continue;
    const weight = entry.weight && entry.weight > 0 ? entry.weight : 1;
    sum += entry.percent * weight;
    total += weight;
  }
  return total > 0 ? roundTo(sum / total, 1) : null;
}

/**
 * Pearson correlation coefficient of two equally-sized series.
 *
 * Used to state "attendance tracks performance" as a number rather than an
 * impression. Returns `null` when there are fewer than three pairs (too few to
 * mean anything) or when either series has no variance.
 */
export function correlation(pairs: ReadonlyArray<readonly [number, number]>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const meanX = pairs.reduce((a, [x]) => a + x, 0) / n;
  const meanY = pairs.reduce((a, [, y]) => a + y, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (const [x, y] of pairs) {
    cov += (x - meanX) * (y - meanY);
    varX += (x - meanX) ** 2;
    varY += (y - meanY) ** 2;
  }
  const denom = Math.sqrt(varX * varY);
  return denom === 0 ? null : roundTo(cov / denom, 2);
}
