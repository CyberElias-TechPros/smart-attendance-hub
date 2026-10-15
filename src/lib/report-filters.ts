// Filter object ⇄ URL search-parameter helpers.
//
// The All-Courses table, the course detail page, the print view and every
// export take the *same* `ReportFilters` object. Keeping the parsing in one
// place is what makes "the export honours the current filters" (brief §7) true
// by construction rather than by discipline.

import type { AttendanceStatus, ReportFilters, ReportSortKey } from "./types";

const SORT_KEYS: ReportSortKey[] = [
  "code",
  "title",
  "department",
  "enrolled",
  "classesHeld",
  "classesAttended",
  "rate",
  "present",
  "absent",
  "late",
];

const STATUSES: AttendanceStatus[] = ["present", "late", "excused", "absent"];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Validate a router search object into the canonical filter shape. */
export function normaliseFilters(search: Record<string, unknown>): ReportFilters {
  const sort = str(search.sort) as ReportSortKey | undefined;
  const status = str(search.status) as AttendanceStatus | undefined;
  const page = num(search.page);
  const pageSize = num(search.pageSize);
  return {
    academicSessionId: str(search.academicSessionId),
    semesterId: str(search.semesterId),
    facultyId: str(search.facultyId),
    departmentId: str(search.departmentId),
    courseId: str(search.courseId),
    lecturerId: str(search.lecturerId),
    category: str(search.category),
    status: status && STATUSES.includes(status) ? status : undefined,
    search: str(search.search),
    sort: sort && SORT_KEYS.includes(sort) ? sort : undefined,
    dir: search.dir === "desc" || search.dir === "asc" ? (search.dir as "asc" | "desc") : undefined,
    from: num(search.from),
    to: num(search.to),
    page: page && page > 0 ? Math.floor(page) : undefined,
    pageSize: pageSize && pageSize > 0 ? Math.min(500, Math.floor(pageSize)) : undefined,
  };
}

/** Drop empty keys so URLs stay readable and cache keys stay stable. */
export function cleanFilters(filters: ReportFilters): ReportFilters {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out as ReportFilters;
}

/** Serialise filters for a link or a fetch (same set used by the API client). */
export function filtersToQuery(filters: ReportFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(cleanFilters(filters))) {
    params.set(key, String(value));
  }
  return params.toString();
}

/**
 * Human-readable labels for the applied filters — used by the print header and
 * the workbook's "Report Info" sheet so a recipient can tell exactly which
 * slice of data they are holding.
 */
export function describeFilters(
  filters: ReportFilters,
  labels: {
    session?: string;
    semester?: string;
    faculty?: string;
    department?: string;
    lecturer?: string;
    course?: string;
  } = {},
): string[] {
  const out: string[] = [];
  if (labels.session) out.push(`Academic session: ${labels.session}`);
  if (labels.semester) out.push(`Semester: ${labels.semester}`);
  if (labels.faculty) out.push(`Faculty: ${labels.faculty}`);
  if (labels.department) out.push(`Department: ${labels.department}`);
  if (labels.course) out.push(`Course: ${labels.course}`);
  if (labels.lecturer) out.push(`Lecturer: ${labels.lecturer}`);
  if (filters.category) out.push(`Category: ${filters.category}`);
  if (filters.status) out.push(`Attendance status: ${filters.status}`);
  if (filters.search) out.push(`Search: “${filters.search}”`);
  if (filters.from) out.push(`From: ${new Date(filters.from).toLocaleDateString()}`);
  if (filters.to) out.push(`To: ${new Date(filters.to).toLocaleDateString()}`);
  return out;
}
