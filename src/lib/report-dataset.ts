// The export "document model".
//
// One payload describes everything an exported or printed report contains:
// institution, period, applied filters, the summary table, its totals row and —
// when a single course is in scope — the per-student and per-lecture detail.
//
// The screen, the print preview, the PDF and the Excel workbook are all built
// from this one object, which is how the brief's rule "the export must use the
// current filters" stays true: there is only one place that decides what the
// report contains.

import type {
  CourseReport,
  CourseReportRow,
  CourseSessionStat,
  CoursesReport,
  ReportFilters,
  Semester,
} from "./types";

export interface ReportDataset {
  title: string;
  subtitle?: string;
  institution: string;
  logoUrl?: string;
  footerNote?: string;
  /** "SLAMS_Attendance_All-Courses_2024-2025_First-Semester_2025-10-15" */
  fileBase: string;
  generatedAt: number;
  generatedBy?: string;
  periodLabel: string;
  filterLabels: string[];
  threshold: number;
  scope: "all" | "course";
  /** Summary rows: one per course, in the order the screen shows them. */
  rows: CourseReportRow[];
  totals: CoursesReport["totals"];
  /** Present only for a single-course report. */
  course?: {
    report: CourseReport;
    lectures: CourseSessionStat[];
  };
}

const SCOPE_LABEL: Record<ReportDataset["scope"], string> = {
  all: "All-Courses",
  course: "Single-Course",
};

function slug(input: string): string {
  return input
    .replace(/[/\\]+/g, "-")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `SLAMS_Attendance_<Scope>_<Session>_<Semester>_<YYYY-MM-DD>` (plan §7). */
export function reportFileBase(
  institution: string,
  scope: ReportDataset["scope"],
  academicSession?: string,
  semester?: string,
  at = Date.now(),
): string {
  const parts = [
    slug(institution || "Institution"),
    "Attendance",
    SCOPE_LABEL[scope],
    academicSession ? slug(academicSession) : "All-Sessions",
    semester ? slug(semester) : "All-Semesters",
    new Date(at).toISOString().slice(0, 10),
  ];
  return parts.join("_");
}

export interface BuildDatasetOptions {
  institutionName: string;
  logoUrl?: string;
  footerNote?: string;
  threshold: number;
  generatedBy?: string;
  courseName?: string;
  courseReport?: CourseReport;
  lectures?: CourseSessionStat[];
  labels?: {
    session?: string;
    semester?: string;
    faculty?: string;
    department?: string;
    lecturer?: string;
  };
  /** Pre-formatted filter descriptions (see describeFilters). */
  filterLabels?: string[];
}

/** Build the export document model from the same payload the screen renders. */
export function buildReportDataset(
  report: CoursesReport,
  options: BuildDatasetOptions,
): ReportDataset {
  const filters: ReportFilters = report.meta.filters;
  const academicSession = report.meta.period.academicSession?.name;
  const semester: Semester | undefined = report.meta.period.semester;
  const scope: ReportDataset["scope"] = options.courseReport ? "course" : "all";

  const periodLabel = [
    academicSession ? `Academic session ${academicSession}` : "All academic sessions",
    semester ? semester.name : "All semesters",
  ].join(" · ");

  return {
    title:
      scope === "course" && options.courseName
        ? `Attendance Report — ${options.courseName}`
        : "Course Attendance Report",
    subtitle: options.labels?.department ?? undefined,
    institution: options.institutionName,
    logoUrl: options.logoUrl,
    footerNote: options.footerNote,
    fileBase: reportFileBase(
      options.institutionName,
      scope,
      academicSession,
      semester?.name,
      report.meta.generatedAt,
    ),
    generatedAt: report.meta.generatedAt,
    generatedBy: options.generatedBy,
    periodLabel,
    filterLabels: options.filterLabels ?? [],
    threshold: options.threshold ?? report.meta.threshold,
    scope,
    rows: report.rows,
    totals: report.totals,
    course:
      options.courseReport && options.lectures
        ? { report: options.courseReport, lectures: options.lectures }
        : undefined,
  };
}

/** How many lectures each course held, for the "averages" line of the summary. */
export function averageLecturesPerStudent(dataset: ReportDataset): number | null {
  if (dataset.rows.length === 0) return null;
  const withLectures = dataset.rows.filter((r) => r.classesHeld > 0);
  if (withLectures.length === 0) return null;
  const total = withLectures.reduce((a, r) => a + r.classesHeld, 0);
  return Math.round((total / withLectures.length) * 10) / 10;
}
