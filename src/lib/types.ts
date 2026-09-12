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
  attendance: Array<{
    id: string;
    studentId: string;
    name: string;
    matricNo: string;
    timestamp: number;
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
}

export interface CourseReportStudent {
  id: string;
  name: string;
  matricNo: string;
  attended: number;
  percentage: number;
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
