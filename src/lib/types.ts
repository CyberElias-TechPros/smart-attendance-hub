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
  attended: number;
  percentage: number;
  devices: number;
}

export interface CourseReport {
  course: { id: string; code: string; title: string; level: string; units: number };
  totalSessions: number;
  sessions: AttendanceSession[];
  students: CourseReportStudent[];
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
  /** Sign-in code is intentionally absent — students must be in the venue. */
  expiresAt: number;
}
