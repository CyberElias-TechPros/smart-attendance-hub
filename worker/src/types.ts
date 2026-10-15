import type { AttendanceHealth } from "../../shared/attendance-math";

// Domain types shared across the SLAMS API worker.
// The frontend mirrors these contracts in src/lib/types.ts — keep in sync.

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
  /** Bumped on revocation (logout-all / password change). Any issued token
   *  carries the value that was current at sign-in; a mismatch ⇒ „stale“. */
  authVersion: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  icon?: string;
  color?: string;
  /** The faculty above it (P5.2: what a "faculty reports" grant resolves to). */
  facultyId?: string;
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
  /** Course-level default venue geofence. When set, every session (one-off or
   *  recurring) that doesn't pin its own location inherits this venue lock —
   *  so students can't mark attendance far from the classroom. */
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
  /** When set, the code rotates every N seconds (anti-sharing). */
  codeIntervalSeconds?: number;
  /** When the current code was issued (rotation bookkeeping). */
  codeUpdatedAt?: number;
  /** Previous code, accepted briefly after rotation (grace window). Never exposed to students. */
  prevCode?: string;
  /** Academic period this lecture belongs to (set from P1 onward). */
  semesterId?: string;
  /** When 1 (default), the session closes itself at expires_at. */
  autoEndEnabled: boolean;
  /** Venue capacity at sign-in time. Undefined = unlimited. */
  seats?: number;
}

export type AttendanceStatus = "present" | "late" | "excused" | "absent";

/** Where a record came from. `scan` = the student signed in themselves;
 *  `auto_absent` = materialised when the session closed because the student was
 *  on the roster and never signed in; `manual` = a human changed it. */
export type AttendanceSource = "scan" | "manual" | "import" | "auto_absent";

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  courseId: string;
  timestamp: number;
  latitude?: number;
  longitude?: number;
  /** Sign-in status. present/late count as attended; excused/absent do not. */
  status: AttendanceStatus;
  source: AttendanceSource;
  /** Why a human changed this record (required for corrections). */
  reason?: string;
  /** User id of the person who made the last manual change. */
  markedBy?: string;
  /** 1 once a period is finalised — corrections require an override permission. */
  locked: boolean;
}

/** One materialised "expected but not attended" opportunity. */
export interface Absentee {
  studentId: string;
  name: string;
  matricNo: string;
  status: AttendanceStatus;
  /** Set when a human changed the row (so the UI can show "excused by Dr X"). */
  reason?: string;
}

/** Sign-in forensics surfaced to the lecturer on the live-session view.
 *  `class` is a server-computed classification of the record. */
export interface SignInEvidence {
  ip?: string;
  ua?: string;
  /** Cloudflare colo (datacenter) that served the sign-in, when visible. */
  colo?: string;
  distanceMeters?: number;
  /** Server-side network distance (request.cf) stored when client GPS was
   *  missing. Represents the distance between the venue and the approximate
   *  IP geolocation — coarse, and used to verify venue proximity. */
  netMeters?: number;
  /** HMAC over the venue + location claim at sign-in time (attestable). */
  hashPresent: boolean;
  class: "verified" | "unverified" | "unlocated";
}

/** Recurring session series. A concrete session is materialized from the
 *  series each time an occurrence becomes due (see repo.startSession). */
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
  /** 'daily' | 'weekdays' | 'weekly' | 'custom' */
  recurrence: string;
  /** Physical room the series meets in; used for timetable clash detection. */
  room?: string;
  /** CSV of ISO weekday numbers (Mon=1..Sun=7) when weekly/custom. */
  daysMask: string;
  /** Wall-clock minutes from midnight (the schedule's local time). */
  minuteOfDay: number;
  /** Minutes east of UTC for minuteOfDay's local zone. */
  tzOffsetMinutes: number;
  /** Stop materializing new legs after this UTC ms. */
  endsOn?: number;
  /** Hard cap on total materialized legs. */
  maxOccurrences?: number;
  /** Legs materialized so far. */
  occurrences: number;
  lastStartAt: number;
  enabled: boolean;
  createdAt: number;
}

export interface Testimonial {
  name: string;
  role: string;
  text: string;
}

export interface SiteSettings {
  id: string;
  institutionName: string;
  atRiskThreshold: number;
  /** IANA timezone of the institution. Every "today"/"this week" boundary is
   *  computed in this zone (server-side), so a Lagos campus and a London campus
   *  never disagree about which lectures happened today. */
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
  /** Institution's active period, resolved by the top-bar selector. */
  currentAcademicSessionId: string | null;
  currentSemesterId: string | null;
  /** Optional logo shown on printed reports (brief §7). */
  logoUrl: string | null;
  /** Optional note printed in the footer of every report. */
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

/** Settings safe to expose to unauthenticated visitors (landing + login page). */
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

export interface SessionDetail {
  session: AttendanceSession;
  course: Course;
  totalEnrolled: number;
  /** When the currently displayed code rotates (only for rotating sessions). */
  codeExpiresAt?: number;
  /** Real sign-ins only (evidence is meaningless for a materialised absence). */
  attendance: Array<{
    id: string;
    studentId: string;
    name: string;
    matricNo: string;
    timestamp: number;
    deviceId?: string;
    /** GPS distance from the venue at sign-in (null when no venue lock). */
    distanceMeters?: number;
    status: AttendanceStatus;
    /** Full forensics (IP/UA/colo/distance/net/hash/class) for this sign-in. */
    evidence?: SignInEvidence;
  }>;
  /** Roster members who were expected but have no sign-in for this lecture.
   *  Empty while the lecture is still open (nobody is late yet). */
  absentees: Absentee[];
  /** Counts derived from the two lists above — the numbers the UI shows. */
  counts: AttendanceCounts;
}

/** The four independent tallies every report is built from (plan §8). */
export interface AttendanceCounts {
  present: number;
  late: number;
  excused: number;
  absent: number;
  /** present + late, per the institution's lateness policy. */
  attended: number;
  /** Everything expected of the roster across these sessions. */
  expected: number;
  /** Opportunity-weighted rate in percent, or null when nothing was expected. */
  rate: number | null;
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
  /** present/late = attended; excused/absent = not (absent is the default for a session with no record). */
  status: AttendanceStatus;
}

export interface CourseReportStudent {
  id: string;
  name: string;
  matricNo: string;
  attended: number;
  percentage: number;
  /** Distinct devices used to sign in (>1 is worth a look). */
  devices: number;
  /** Independent tallies for this student (brief §4 columns 9–11). */
  present: number;
  late: number;
  excused: number;
  absent: number;
  /** Sessions this student was expected to attend (excludes lectures that
   *  happened before they enrolled). */
  expected: number;
}

export interface CourseReport {
  course: {
    id: string;
    code: string;
    title: string;
    level: string;
    units: number;
    category?: string;
    departmentId?: string;
    departmentName?: string;
    departmentCode?: string;
    facultyName?: string;
    lecturerId?: string;
    lecturerName?: string;
    semesterId?: string;
  };
  /** The academic period the figures describe (undefined = all periods). */
  term?: Semester | null;
  totalSessions: number;
  sessions: AttendanceSession[];
  students: CourseReportStudent[];
  /** Roster-wide tallies across every student and session. */
  counts: AttendanceCounts;
  /**
   * Opportunity-weighted course rate (brief §8). Deliberately NOT the mean of
   * the per-student percentages: a 600-student lecture and a 120-student
   * lecture must not carry equal weight.
   */
  weightedRate: number | null;
  /** The naive mean, kept only so the UI can show the difference in a tooltip. */
  meanOfStudents: number | null;
}

export interface FacultyReportCourse {
  id: string;
  code: string;
  title: string;
  enrolled: number;
  sessions: number;
  avg: number;
}

export interface FacultyReportStudent {
  id: string;
  name: string;
  matricNo: string;
  courses: number;
  attended: number;
  total: number;
  percentage: number;
  /** Distinct devices used to sign in (>1 is worth a look). */
  devices: number;
}

export interface FacultyReport {
  courses: FacultyReportCourse[];
  students: FacultyReportStudent[];
}

export interface AdminOverview {
  /** Counts for the institution's *local* day (see site_settings.timezone). */
  today: {
    /** Local calendar date the figures describe, YYYY-MM-DD. */
    date: string;
    label: string;
    present: number;
    late: number;
    excused: number;
    absent: number;
    /** Lectures that ran today (started or closed). */
    classesHeld: number;
    /** Opportunity-weighted attendance rate for today, null when no lectures. */
    rate: number | null;
    /** Students expected across today's lectures. */
    expected: number;
  };
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
  /** Sign-in code is intentionally absent — see listOpenSessionsForStudent. */
  expiresAt: number;
}

// ── Audit trail (plan §4.6 / §9) ──────────────────────────────────────────

/** Every mutation the institution must be able to answer for. Deliberately a
 *  closed union: an unrecognised action string is a bug, not a new feature. */
export type AuditAction =
  | "attendance.update"
  | "attendance.void"
  | "attendance.recompute"
  | "course.create"
  | "course.update"
  | "course.delete"
  | "user.create"
  | "user.update"
  | "user.delete"
  | "session.end"
  | "export.generate"
  | "semester.finalize"
  | "settings.update"
  | "auth.login_failed";

export interface AuditEntry {
  id: string;
  actorId?: string;
  actorRole?: string;
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId?: string;
  courseId?: string;
  semesterId?: string;
  /** The row as it was before the change (JSON-decoded), where applicable. */
  before?: unknown;
  /** The row as it became. */
  after?: unknown;
  reason?: string;
  reqId?: string;
  createdAt: number;
}

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

export interface AuditQuery {
  action?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  courseId?: string;
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
}

/** Standard envelope for every paginated list endpoint (plan §5.3). */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Result of a correction, echoed back so the UI can confirm what it stored. */
export interface AttendanceMutationResult {
  record: AttendanceRecord;
  audited: boolean;
}

// ── Academic structure (plan §4.1 / P1) ────────────────────────────────────

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
  /** Set once the period is published — lectures and corrections are frozen. */
  finalizedAt?: number;
  createdAt: number;
}

/** Everything the top-bar period selector needs in one payload. */
export interface AcademicPeriod {
  academicSession: AcademicSession | null;
  semester: Semester | null;
  academicSessions: AcademicSession[];
  semesters: Semester[];
}

/** The filters shared by the All-Courses table, the exports, and the print
 *  view (brief §6). One object, one meaning, everywhere. */
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
  /**
   * Internal — never parsed from a query string. The courses a reporting grant
   * covers, applied as an OR group by the repo so a grant is *additive*: a
   * lecturer trusted with a department still sees the courses they teach, even
   * when those sit in another department (service courses do exactly that).
   */
  scope?: { departmentId?: string; facultyId?: string; lecturerId?: string };
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

/** One row of the brief's §4 table — every column computed from records. */
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
  /** Total registered students. */
  enrolled: number;
  /** Lectures that actually ran in the selected window. */
  classesHeld: number;
  /** Opportunity-weighted average classes attended per student (brief §4). */
  classesAttended: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attended: number;
  expected: number;
  /** Opportunity-weighted rate in percent, null when no lecture ran. */
  rate: number | null;
  health: AttendanceHealth | null;
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

export interface CoursesReportMeta {
  generatedAt: number;
  filters: ReportFilters;
  period: { academicSession?: AcademicSession; semester?: Semester };
  /** Stated in the payload so a report can never claim a different method. */
  calculation: "opportunity-weighted";
  threshold: number;
  truncated?: boolean;
}

export interface CoursesReport {
  rows: CourseReportRow[];
  totals: CourseReportTotals;
  meta: CoursesReportMeta;
  page: number;
  pageSize: number;
  total: number;
}

/** Per-lecture row for the course detail page (brief §5). */
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
