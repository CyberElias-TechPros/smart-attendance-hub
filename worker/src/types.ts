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
  /** When 1 (default), the session closes itself at expires_at. */
  autoEndEnabled: boolean;
  /** Venue capacity at sign-in time. Undefined = unlimited. */
  seats?: number;
}

export type AttendanceStatus = "present" | "late" | "excused" | "absent";

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
}

export interface CourseReport {
  course: { id: string; code: string; title: string; level: string; units: number };
  totalSessions: number;
  sessions: AttendanceSession[];
  students: CourseReportStudent[];
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
  weeklyAttendance: Array<{ label: string; count: number }>;
}

export interface OpenSession {
  sessionId: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  /** Sign-in code is intentionally absent — see listOpenSessionsForStudent. */
  expiresAt: number;
}
