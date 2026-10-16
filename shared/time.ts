// Institution-timezone date arithmetic (plan §3.2 / P0.4).
//
// Every "today", "this week", and "vs last period" figure must be anchored to
// the institution's own clock. Without this, a Lagos campus on UTC+1 sees a
// 23:00 lecture counted as tomorrow, a deployment in UTC disagrees with the
// registrar's spreadsheet, and a student travelling abroad changes the numbers
// by opening a dashboard.
//
// Implemented with Intl only (no dependency, works in Workers and browsers):
// `zonedDayStart` is the inverse of formatting an instant in a target zone, with
// the offset refined for DST boundaries.
//
// Pure functions — no Date.now() inside — so tests can pin an instant.

export interface DayWindow {
  /** Inclusive UTC ms of local midnight. */
  start: number;
  /** Exclusive UTC ms of the next local midnight. */
  end: number;
  /** Local calendar date as YYYY-MM-DD. */
  key: string;
  /** Short human label, e.g. "Tue 14 Oct". */
  label: string;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar parts of an instant in a zone. */
export function partsInZone(
  ms: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  // `hour12: false` can still yield "24" for midnight in some engines.
  const hour = Number(p.hour) % 24;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour,
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset of the zone at a given instant, in ms (local wall clock − UTC). */
export function zoneOffsetMs(ms: number, timeZone: string): number {
  const p = partsInZone(ms, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(ms / 1000) * 1000;
  return asIfUtc - truncated;
}

/** UTC ms of local midnight for the day containing `ms` (plus `offsetDays`). */
export function zonedDayStart(ms: number, timeZone: string, offsetDays = 0): number {
  const shifted = ms + offsetDays * 86_400_000;
  const p = partsInZone(shifted, timeZone);
  const calendarMidnightUtc = Date.UTC(p.year, p.month - 1, p.day);
  // Refine twice: the offset that applies at local midnight may differ from the
  // offset in force at `shifted` on a DST boundary day.
  let guess = calendarMidnightUtc - zoneOffsetMs(shifted, timeZone);
  for (let i = 0; i < 2; i++) {
    guess = calendarMidnightUtc - zoneOffsetMs(guess, timeZone);
  }
  return guess;
}

/** The local day containing `ms`, as a half-open [start, end) window. */
export function dayWindow(ms: number, timeZone: string): DayWindow {
  const start = zonedDayStart(ms, timeZone);
  const end = zonedDayStart(ms, timeZone, 1);
  const p = partsInZone(start, timeZone);
  const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(start));
  return { start, end, key, label };
}

/** The last `days` local days ending with the day containing `ms`, oldest
 *  first — the shape the dashboard's weekly chart consumes. */
export function recentDayWindows(ms: number, timeZone: string, days = 7): DayWindow[] {
  const out: DayWindow[] = [];
  for (let i = days - 1; i >= 0; i--)
    out.push(dayWindow(zonedDayStart(ms, timeZone, -i) + 1, timeZone));
  return out;
}

/** Same offset expressed in whole minutes (callers that display it). */
export function minutesInZone(ms: number, timeZone: string): number {
  return Math.round(zoneOffsetMs(ms, timeZone) / 60_000);
}
