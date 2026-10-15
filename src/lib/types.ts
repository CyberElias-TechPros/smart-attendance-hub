import type { AttendanceHealth } from "../../shared/attendance-math";

// Client-side mirrors of the SLAMS API contracts served by the Cloudflare
// Worker (worker/src/types.ts). Keep the two files in sync.

export type Role = "admin" | "lecturer" | "student";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  matricNo?: string;
  staffId?: string;
  departmentId?: string;
  level?: string;
  createdAt: number;
  /** Bumped when the account is signed out on all devices / password changed.
   *  Tokens carrying a stale value are rejected (server-side revocation). */
  authVersion: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  icon?: string;
  color?: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  departmentId: string;
  level: string;
  units: number;
  lecturerId?: string;
  enrolledStudentIds: string[];
  icon?: string;
  color?: string;
  category?: string;
  description?: string;
  /** Academic period this course is delivered in. Lectures and records inherit
   *  it, which is what makes "filter by semester" and period reports work. */
  semesterId?: string;
  /** Course-level default venue geofence (sessions inherit it). */
  venueLat?: number;
  venueLng?: number;
  venueRadius?: number;
}

export interface AttendanceSession {
  id: string;
  courseId: string;
  lecturerId: string;
  code: string;
  startedAt: number;
  expiresAt: number;
  endedAt?: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  topic?: string;
  codeIntervalSeconds?: number;
  codeUpdatedAt?: number;
  prevCode?: string;
  /** When true (default) the session closes itself at expires_at. */
  autoEndEnabled: boolean;
  /** Venue capacity; undefined = unlimited. */
  seats?: number;
}

export type AttendanceStatus = "present" | "late" | "excused" | "absent";

export interface Testimonial {
  name: string;
  role: string;
  text: string;
}

export interface SiteSettings {
  id: string;
  institutionName: string;
  atRiskThreshold: number;
  /** IANA timezone used for every "today"/"this week" boundary (server-side). */
  timezone: string;
  /** Count `late` as attended in percentage math (plan decision D4). */
  lateCountsAsAttended: boolean;
  /** Whether an approved excuse still occupies the denominator (plan D3). */
  excusedCountsAsAbsent: boolean;
  /**
   * Apply the institution's "below the attendance threshold ⇒ barred from the
   * examination" policy on the Results page (plan §4.4 / P4.4). Off by default:
   * the page still *reports* the split, it just does not assert the consequence
   * until the institution says it does.
   */
  barredFromExamBelowThreshold: boolean;
  /** The institution's active period, as resolved by the top-bar selector. */
  currentAcademicSessionId: string | null;
  currentSemesterId: string | null;
  /** Optional logo printed on reports and shown in the top bar. */
  logoUrl: string | null;
  /** Optional note printed in the footer of every generated report. */
  reportFooterNote: string | null;
  marqueeItems: string[];
  testimonials: Testimonial[];
  demoAccountsEnabled: boolean;
  demoPassword: string;
  demoEmailDomain: string;
  showFakeStats: boolean;
  primaryColor: string | null;
  contactEmail: string | null;
}

export interface PublicSettings {
  institutionName: string;
  marqueeItems: string[];
  testimonials: Testimonial[];
  demoAccountsEnabled: boolean;
  demoPassword: string;
  demoEmailDomain: string;
  showFakeStats: boolean;
  primaryColor: string | null;
  contactEmail: string | null;
}

export interface StudentCourseView extends Course {
  lecturerName: string;
  totalSessions: number;
  attendedSessions: number;
  percentage: number;
}

/** Sign-in forensics surfaced to the lecturer on the live-session view. */
export interface SignInEvidence {
  ip?: string;
  ua?: string;
  colo?: string;
  distanceMeters?: number;
  netMeters?: number;
  hashPresent: boolean;
  class: "verified" | "unverified" | "unlocated";
}

export interface SessionDetail {
  session: AttendanceSession;
  course: Course;
  totalEnrolled: number;
  codeExpiresAt?: number;
  attendance: Array<{
    id: string;
    studentId: string;
    name: string;
    matricNo: string;
    timestamp: number;
    deviceId?: string;
    distanceMeters?: number;
    status: AttendanceStatus;
    evidence?: SignInEvidence;
  }>;
}

export interface StudentHistoryItem {
  id: string;
  timestamp: number;
  courseCode: string;
  courseTitle: string;
}

export interface StudentCourseSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  expiresAt: number;
  topic?: string;
  attended: boolean;
  attendedAt?: number;
  status: AttendanceStatus;
}

export interface Schedule {
  id: string;
  courseId: string;
  lecturerId: string;
  durationMinutes: number;
  topic?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  codeIntervalSeconds?: number;
  seats?: number;
  recurrence: string;
  /** Physical room the series meets in; used for timetable clash detection. */
  room?: string;
  daysMask: string;
  minuteOfDay: number;
  tzOffsetMinutes: number;
  endsOn?: number;
  maxOccurrences?: number;
  occurrences: number;
  lastStartAt: number;
  enabled: boolean;
  createdAt: number;
}

export interface CourseReportStudent {
  id: string;
  name: string;
  matricNo: string;
  /** Lectures attended (present + late under the institution's policy). */
  attended: number;
  /** Lectures the student was expected at since enrolling in this period. */
  expected: number;
  percentage: number;
  devices: number;
  /** Independently counted outcomes (brief §8 — never derived from each other). */
  present: number;
  late: number;
  excused: number;
  absent: number;
}

/** Independent tallies plus the derived attended/rate pair (brief §8). */
export interface AttendanceCounts {
  present: number;
  late: number;
  excused: number;
  absent: number;
  /** present + late under the institution's late policy. */
  attended: number;
  /** Everything expected of the roster across the lectures in scope. */
  expected: number;
  /** Opportunity-weighted percentage, or null when nothing was expected. */
  rate: number | null;
}

export interface CourseReport {
  course: {
    id: string;
    code: string;
    title: string;
    level: string;
    units: number;
    category?: string;
    departmentName?: string;
    departmentCode?: string;
    facultyName?: string;
    lecturerName?: string;
    semesterId?: string;
  };
  totalSessions: number;
  sessions: AttendanceSession[];
  students: CourseReportStudent[];
  /** Roster-wide tallies across every student and lecture in the period. */
  counts: AttendanceCounts;
  /**
   * Opportunity-weighted course rate (brief §8) — deliberately not the mean of
   * the per-student percentages.
   */
  weightedRate: number | null;
  /** The naive mean, kept so the UI can show why it must not be used. */
  meanOfStudents: number | null;
  term?: Semester | null;
}

export interface FacultyReport {
  courses: Array<{
    id: string;
    code: string;
    title: string;
    enrolled: number;
    sessions: number;
    avg: number;
  }>;
  students: Array<{
    id: string;
    name: string;
    matricNo: string;
    courses: number;
    attended: number;
    total: number;
    percentage: number;
    devices: number;
  }>;
}

/** Local-day figures for the dashboard's headline cards (plan §3.2 / P0.4). */
export interface OverviewToday {
  date: string;
  label: string;
  present: number;
  late: number;
  excused: number;
  absent: number;
  classesHeld: number;
  rate: number | null;
  expected: number;
}

export interface AdminOverview {
  /** Figures for the institution's *local* day (site_settings.timezone). */
  today: OverviewToday;
  counts: {
    students: number;
    lecturers: number;
    courses: number;
    departments: number;
    sessions: number;
    attendance: number;
  };
  recentSessions: Array<{
    id: string;
    courseCode: string;
    startedAt: number;
    endedAt?: number;
    attended: number;
    enrolled: number;
  }>;
  weeklyAttendance: Array<{ label: string; count: number; key?: string }>;
}

export interface OpenSession {
  sessionId: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  /** Sign-in code is intentionally absent — students must be in the venue. */
  expiresAt: number;
}

// ── Academic structure & reports (plan §4–§6) ─────────────────────────────

export interface Faculty {
  id: string;
  name: string;
  code: string;
  deanUserId?: string;
  icon?: string;
  color?: string;
  createdAt: number;
}

export interface AcademicSession {
  id: string;
  name: string;
  code: string;
  startsOn?: number;
  endsOn?: number;
  isCurrent: boolean;
  createdAt: number;
}

export interface Semester {
  id: string;
  academicSessionId: string;
  name: string;
  sequence: number;
  startsOn?: number;
  endsOn?: number;
  isCurrent: boolean;
  finalizedAt?: number;
  createdAt: number;
}

export interface AcademicPeriod {
  academicSession: AcademicSession | null;
  semester: Semester | null;
  academicSessions: AcademicSession[];
  semesters: Semester[];
}

/** The eight attendance filters from the brief (§6). Every report, export and
 *  print view takes exactly this shape. */
export interface ReportFilters {
  academicSessionId?: string;
  semesterId?: string;
  facultyId?: string;
  departmentId?: string;
  courseId?: string;
  /** Comma-separated course ids — the "export the courses I selected" filter. */
  courseIds?: string;
  lecturerId?: string;
  from?: number;
  to?: number;
  status?: AttendanceStatus;
  search?: string;
  /** Free-text course catalogue grouping (courses.category). */
  category?: string;
  sort?: ReportSortKey;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export type ReportSortKey =
  | "code"
  | "title"
  | "department"
  | "enrolled"
  | "classesHeld"
  | "classesAttended"
  | "rate"
  | "present"
  | "absent"
  | "late";

/** One row of the All Courses table (brief §4). */
export interface CourseReportRow {
  id: string;
  code: string;
  title: string;
  departmentId: string;
  departmentName?: string;
  departmentCode?: string;
  facultyId?: string;
  facultyName?: string;
  lecturerId?: string;
  lecturerName?: string;
  semesterId?: string;
  level: string;
  units: number;
  /** Free-text catalogue grouping, shown on the Course Categories page. */
  category?: string;
  enrolled: number;
  classesHeld: number;
  classesAttended: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attended: number;
  expected: number;
  rate: number | null;
  health: "good" | "watch" | "at-risk" | "critical" | null;
}

export interface CourseReportTotals {
  courses: number;
  enrolled: number;
  classesHeld: number;
  classesAttended: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attended: number;
  expected: number;
  rate: number | null;
}

export interface CoursesReport {
  rows: CourseReportRow[];
  totals: CourseReportTotals;
  meta: {
    generatedAt: number;
    filters: ReportFilters;
    period: { academicSession?: AcademicSession; semester?: Semester };
    calculation: string;
    threshold: number;
  };
  page: number;
  pageSize: number;
  total: number;
}

/**
 * One lecture in the institution-wide register (P4.2 / brief §2 "Attendance").
 *
 * Deliberately the same shape as a course-detail lecture row, plus the course
 * and lecturer it belongs to: the register is the course detail table with the
 * `course_id` filter removed, so the two can never disagree.
 */
export interface SessionRegisterRow {
  sessionId: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  level: string;
  units: number;
  departmentName?: string;
  departmentCode?: string;
  facultyName?: string;
  lecturerId?: string;
  lecturerName?: string;
  topic?: string;
  startedAt: number;
  endedAt?: number;
  semesterId?: string;
  /** Students on the roster when the lecture started. */
  expected: number;
  /** Every row recorded against the lecture (present + late + excused + absent). */
  recorded: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  rate: number | null;
  health?: AttendanceHealth | null;
}

export interface SessionRegisterTotals {
  lectures: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  attended: number;
  expected: number;
  rate: number | null;
}

export interface SessionRegisterPage {
  items: SessionRegisterRow[];
  totals: SessionRegisterTotals;
  page: number;
  pageSize: number;
  total: number;
  meta: {
    generatedAt: number;
    filters: ReportFilters;
    period: AcademicPeriod;
    threshold: number;
  };
}

export interface CourseSessionStat {
  sessionId: string;
  startedAt: number;
  endedAt?: number;
  topic?: string;
  present: number;
  late: number;
  excused: number;
  absent: number;
  expected: number;
  rate: number | null;
}

// ── Audit trail (plan §4.6) ────────────────────────────────────────────────

// ─── Notifications (plan §4.5 / P4.5) ──────────────────────────────────────
//
// One row per recipient, written by `Repo.notify()`. `audience` records *why*
// somebody received a row, which is what lets the inbox distinguish a message
// addressed to one person from a course-wide or role-wide broadcast.

// ─── Examinations & results (plan §4.4 / P4.3) ──────────────────────────────

/** ca | test | exam | practical — the brief's Examinations vocabulary. */
export type ExamKind = "ca" | "test" | "exam" | "practical";

export interface Exam {
  id: string;
  courseId: string;
  courseCode?: string;
  courseTitle?: string;
  departmentId?: string;
  departmentName?: string;
  semesterId?: string;
  semesterName?: string;
  title: string;
  kind: ExamKind;
  /** Contribution to the final score, in percent (optional). */
  weight?: number;
  maxScore: number;
  scheduledAt?: number;
  durationMinutes?: number;
  venue?: string;
  room?: string;
  /** Results released to students. Unpublished results stay staff-visible. */
  published: boolean;
  createdBy?: string;
  createdAt: number;
  /** How many students have a score recorded, and the roster size. */
  marked?: number;
  enrolled?: number;
}

export interface ExamResult {
  id: string;
  examId: string;
  courseId: string;
  studentId: string;
  studentName?: string;
  matricNo?: string;
  score: number | null;
  grade?: string;
  enteredBy?: string;
  updatedAt: number;
}

/** A student's attendance-versus-performance pair (plan P4.4). */
export interface ResultAnalyticsRow {
  studentId: string;
  studentName: string;
  matricNo: string;
  /** Attendance opportunity rate in percent, or null when no lecture ran. */
  attendanceRate: number | null;
  attended: number;
  expected: number;
  /** Weighted final score across the course's exams, in percent, or null. */
  finalPercent: number | null;
  letterGrade?: string;
  /** Whether the attendance policy bars this student from the exam. */
  barred: boolean;
  /** Per-exam scores, keyed by exam id (used by the scatter's tooltip). */
  scores: Record<string, number | null>;
}

export interface ResultAnalytics {
  course: { id: string; code: string; title: string; departmentName?: string };
  threshold: number;
  /** Whether the institution applies the "below threshold ⇒ barred" policy. */
  policyEnabled: boolean;
  exams: Array<{ id: string; title: string; kind: ExamKind; maxScore: number; weight?: number }>;
  rows: ResultAnalyticsRow[];
  summary: {
    students: number;
    barred: number;
    /** Pearson correlation between attendance and final score, or null. */
    correlation: number | null;
    /** Mean final score of the students above/below the threshold. */
    meanAbove: number | null;
    meanBelow: number | null;
    /** How many students would pass by score but are barred by attendance. */
    barredButPassing: number;
  };
  meta: { generatedAt: number; threshold: number; filters: ReportFilters };
}

export interface ReportSnapshot {
  id: string;
  scope: string;
  entityId?: string;
  label: string;
  payload: unknown;
  totals?: Record<string, number | null>;
  rowCount: number;
  createdBy?: string;
  createdAt: number;
}

export interface Notification {
  id: string;
  userId: string;
  audience: string;
  role?: string;
  kind: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  href?: string;
  courseId?: string;
  semesterId?: string;
  readAt?: number;
  createdAt: number;
}

export interface NotificationsPage {
  items: Notification[];
  unread: number;
  total: number;
}

/** Who receives a notification. Resolved server-side, never by the caller. */
export type NotifyAudience =
  | { kind: "user"; userId: string }
  | { kind: "users"; userIds: string[] }
  | { kind: "course"; courseId: string }
  | { kind: "role"; role: Role }
  | { kind: "admins" };

export interface NotifyInput {
  audience: NotifyAudience;
  kind: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  href?: string | null;
  courseId?: string | null;
  semesterId?: string | null;
  /** User ids to skip (typically whoever caused the event). */
  except?: string[];
  /** Injectable clock, so tests can pin `created_at` and ordering. */
  createdAt?: number;
}

export interface AuditEntry {
  id: string;
  actorId?: string;
  actorRole?: string;
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId?: string;
  courseId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  reqId?: string;
  createdAt: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Bulk CSV import (plan P5.4 / decision D8) ───────────────────────────────

export type ImportKind = "students" | "lecturers" | "enrollments" | "results";

export interface ImportRowReport {
  /** 1-based line in the uploaded file, so a report can be pointed at the row. */
  line: number;
  /** The row's identifying value (name / email / matric number). */
  label: string;
  /** `duplicate` rows are skipped, not rejected — that is what makes a re-run safe. */
  status: "ok" | "error" | "duplicate";
  message?: string;
}

export interface ImportPreview {
  kind: ImportKind;
  /** Columns the file actually had. */
  header: string[];
  /** Columns the importer expects. */
  expected: string[];
  rows: ImportRowReport[];
  summary: { total: number; valid: number; errors: number; duplicates: number };
  /** True when `apply` will be accepted — no hard errors, and something to do. */
  ready: boolean;
}

export interface ImportApplyResult {
  kind: ImportKind;
  created: number;
  linked: number;
  updated: number;
  skipped: number;
}

export interface ImportInput {
  kind: ImportKind;
  csv: string;
  /** Enrolments, marks: the course/exam the file is applied to. */
  courseId?: string;
  examId?: string;
  /** Optional: give imported people this password instead of a generated one. */
  defaultPassword?: string;
}
