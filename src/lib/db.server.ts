// Server-only in-memory data store for SLAMS.
// NOTE: For production on Cloudflare Workers, swap this module for a Cloudflare
// D1 (SQLite) or Durable Object backed implementation preserving the same API.
// The rest of the app only imports helpers from here; you can migrate without
// touching route/component code. See `README-DEPLOY.md`.

import { nanoid } from "nanoid";
import { hashPassword } from "./auth.server";

export type Role = "admin" | "lecturer" | "student";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  matricNo?: string;   // student
  staffId?: string;    // lecturer
  departmentId?: string;
  level?: string;      // student level e.g. "300"
  createdAt: number;
}

export interface Department {
  id: string;
  name: string;
  code: string;
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
}

export interface AttendanceSession {
  id: string;
  courseId: string;
  lecturerId: string;
  code: string;            // one-time code
  startedAt: number;
  expiresAt: number;
  endedAt?: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  topic?: string;
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  courseId: string;
  timestamp: number;
  latitude?: number;
  longitude?: number;
}

interface DBShape {
  users: Map<string, User>;
  departments: Map<string, Department>;
  courses: Map<string, Course>;
  sessions: Map<string, AttendanceSession>;
  records: AttendanceRecord[];
  seeded: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __slams_db: DBShape | undefined;
}

function newDB(): DBShape {
  return {
    users: new Map(),
    departments: new Map(),
    courses: new Map(),
    sessions: new Map(),
    records: [],
    seeded: false,
  };
}

export function db(): DBShape {
  if (!globalThis.__slams_db) globalThis.__slams_db = newDB();
  return globalThis.__slams_db!;
}

export async function ensureSeeded() {
  const store = db();
  if (store.seeded) return;
  store.seeded = true;

  const passHash = await hashPassword("password123");

  // Departments
  const csc: Department = { id: nanoid(8), name: "Computer Science", code: "CSC" };
  const mth: Department = { id: nanoid(8), name: "Mathematics", code: "MTH" };
  const eee: Department = { id: nanoid(8), name: "Electrical Engineering", code: "EEE" };
  [csc, mth, eee].forEach((d) => store.departments.set(d.id, d));

  // Users
  const admin: User = {
    id: nanoid(10),
    email: "admin@slams.edu",
    passwordHash: passHash,
    name: "System Administrator",
    role: "admin",
    createdAt: Date.now(),
  };
  const lec1: User = {
    id: nanoid(10),
    email: "lecturer@slams.edu",
    passwordHash: passHash,
    name: "Dr. Amina Yusuf",
    role: "lecturer",
    staffId: "STF-1001",
    departmentId: csc.id,
    createdAt: Date.now(),
  };
  const lec2: User = {
    id: nanoid(10),
    email: "okafor@slams.edu",
    passwordHash: passHash,
    name: "Prof. Chuka Okafor",
    role: "lecturer",
    staffId: "STF-1002",
    departmentId: mth.id,
    createdAt: Date.now(),
  };
  const stu1: User = {
    id: nanoid(10),
    email: "student@slams.edu",
    passwordHash: passHash,
    name: "Ada Obi",
    role: "student",
    matricNo: "CSC/21/1001",
    departmentId: csc.id,
    level: "300",
    createdAt: Date.now(),
  };
  const stu2: User = {
    id: nanoid(10),
    email: "bello@slams.edu",
    passwordHash: passHash,
    name: "Ibrahim Bello",
    role: "student",
    matricNo: "CSC/21/1002",
    departmentId: csc.id,
    level: "300",
    createdAt: Date.now(),
  };
  const stu3: User = {
    id: nanoid(10),
    email: "eze@slams.edu",
    passwordHash: passHash,
    name: "Ngozi Eze",
    role: "student",
    matricNo: "CSC/21/1003",
    departmentId: csc.id,
    level: "300",
    createdAt: Date.now(),
  };
  const stu4: User = {
    id: nanoid(10),
    email: "musa@slams.edu",
    passwordHash: passHash,
    name: "Fatima Musa",
    role: "student",
    matricNo: "MTH/21/2001",
    departmentId: mth.id,
    level: "200",
    createdAt: Date.now(),
  };
  [admin, lec1, lec2, stu1, stu2, stu3, stu4].forEach((u) => store.users.set(u.id, u));

  // Courses
  const c1: Course = {
    id: nanoid(8),
    code: "CSC 305",
    title: "Data Structures & Algorithms",
    departmentId: csc.id,
    level: "300",
    units: 3,
    lecturerId: lec1.id,
    enrolledStudentIds: [stu1.id, stu2.id, stu3.id],
  };
  const c2: Course = {
    id: nanoid(8),
    code: "CSC 311",
    title: "Operating Systems",
    departmentId: csc.id,
    level: "300",
    units: 3,
    lecturerId: lec1.id,
    enrolledStudentIds: [stu1.id, stu2.id, stu3.id],
  };
  const c3: Course = {
    id: nanoid(8),
    code: "MTH 201",
    title: "Linear Algebra",
    departmentId: mth.id,
    level: "200",
    units: 3,
    lecturerId: lec2.id,
    enrolledStudentIds: [stu4.id, stu1.id],
  };
  [c1, c2, c3].forEach((c) => store.courses.set(c.id, c));

  // Seed some past sessions & records so charts aren't empty
  const day = 24 * 60 * 60 * 1000;
  for (let i = 12; i >= 1; i--) {
    const started = Date.now() - i * day;
    const s: AttendanceSession = {
      id: nanoid(10),
      courseId: c1.id,
      lecturerId: lec1.id,
      code: String(100000 + Math.floor(Math.random() * 900000)),
      startedAt: started,
      expiresAt: started + 30 * 60 * 1000,
      endedAt: started + 45 * 60 * 1000,
      topic: `Lecture ${13 - i}`,
    };
    store.sessions.set(s.id, s);
    // random attendance
    for (const sid of c1.enrolledStudentIds) {
      if (Math.random() > 0.15) {
        store.records.push({
          id: nanoid(10),
          sessionId: s.id,
          studentId: sid,
          courseId: c1.id,
          timestamp: started + Math.floor(Math.random() * 20 * 60 * 1000),
        });
      }
    }
  }
}

export function generateCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000));
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
