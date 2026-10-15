// Demo-data seeding. Runs once on first use of an empty database (all
// environments). Mirrors the data described in the README's demo accounts.
//
// Since P1 the seed also builds the institution layer the admin dashboard
// reports on: faculties above departments, an academic period on every course
// and lecture, and — most importantly — enough real lectures and rosters that
// every figure in the UI is computed from records rather than invented.
//
// The numbers below are deliberately varied (a struggling 200-level course, a
// strong 400-level one, a course with a student who never attends) so an
// administrator immediately sees what the at-risk reporting is for.

import { nanoid } from "nanoid";
import { hashPassword } from "./auth";
import type { D1Database } from "./db";
import { zonedDayStart } from "./time";

/** Deterministic PRNG (mulberry32): the demo dataset is identical on every
 *  machine, so screenshots, docs and support conversations all match. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Insert many rows per statement: a first-run seed must not spend a minute on
 *  round-trips when a deployment has real rosters to write.
 *
 *  The batch size is derived from the *parameter* budget, not a row count: D1
 *  rejects a prepared statement with more than 100 bound variables, so a wide
 *  table simply gets fewer rows per statement. (node:sqlite, which the tests
 *  use, is far more permissive — this is exactly the class of bug that only
 *  shows up against the real runtime.) */
const MAX_BOUND_PARAMS = 90; // stay clear of D1's 100-parameter ceiling

async function insertMany(
  db: D1Database,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunk?: number,
): Promise<void> {
  if (rows.length === 0) return;
  const perStatement = chunk ?? Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns.length));
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  for (let i = 0; i < rows.length; i += perStatement) {
    const slice = rows.slice(i, i + perStatement);
    const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES ${slice
      .map(() => placeholders)
      .join(", ")}`;
    await db
      .prepare(sql)
      .bind(...slice.flat())
      .run();
  }
}

export async function seedD1(db: D1Database): Promise<void> {
  const passHash = await hashPassword("password123");
  const id = (n = 8) => nanoid(n);
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const random = rng(20251015);

  // ── Faculties (the level above departments) ──
  const science = { id: id(), name: "Faculty of Science", code: "SCI", icon: "FlaskConical" };
  const engineering = {
    id: id(),
    name: "Faculty of Engineering",
    code: "ENG",
    icon: "Cog",
  };
  const lifeSciences = {
    id: id(),
    name: "Faculty of Life Sciences",
    code: "LSC",
    icon: "Leaf",
  };
  for (const f of [science, engineering, lifeSciences]) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO faculties (id, name, code, dean_user_id, icon, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(f.id, f.name, f.code, null, f.icon, null, now)
      .run();
  }

  const csc = {
    id: id(),
    name: "Computer Science",
    code: "CSC",
    icon: "Code2",
    color: "oklch(0.5 0.18 250)",
    facultyId: science.id,
  };
  const mth = {
    id: id(),
    name: "Mathematics",
    code: "MTH",
    icon: "Sigma",
    color: "oklch(0.6 0.16 60)",
    facultyId: science.id,
  };
  const eee = {
    id: id(),
    name: "Electrical Engineering",
    code: "EEE",
    icon: "Cpu",
    color: "oklch(0.55 0.16 200)",
    facultyId: engineering.id,
  };
  const bio = {
    id: id(),
    name: "Biological Sciences",
    code: "BIO",
    icon: "Leaf",
    color: "oklch(0.6 0.15 150)",
    facultyId: lifeSciences.id,
  };
  const departments = [csc, mth, eee, bio];

  // INSERT OR IGNORE so seeding is safe under multi-isolate concurrency (two
  // isolates can race the seed on first deploy; the second collapses silently).
  await insertMany(
    db,
    "departments",
    ["id", "name", "code", "icon", "color", "faculty_id"],
    departments.map((d) => [d.id, d.name, d.code, d.icon, d.color, d.facultyId]),
  );

  const users: Array<{
    id: string;
    email: string;
    name: string;
    role: "admin" | "lecturer" | "student";
    matricNo?: string;
    staffId?: string;
    departmentId?: string;
    level?: string;
  }> = [
    { id: id(10), email: "admin@slams.edu", name: "System Administrator", role: "admin" },
    {
      id: id(10),
      email: "lecturer@slams.edu",
      name: "Dr. Amina Yusuf",
      role: "lecturer",
      staffId: "STF-1001",
      departmentId: csc.id,
    },
    {
      id: id(10),
      email: "okafor@slams.edu",
      name: "Prof. Chuka Okafor",
      role: "lecturer",
      staffId: "STF-1002",
      departmentId: mth.id,
    },
    {
      id: id(10),
      email: "adeyemi@slams.edu",
      name: "Dr. Grace Adeyemi",
      role: "lecturer",
      staffId: "STF-1003",
      departmentId: eee.id,
    },
    {
      id: id(10),
      email: "nwosu@slams.edu",
      name: "Dr. Samuel Nwosu",
      role: "lecturer",
      staffId: "STF-1004",
      departmentId: bio.id,
    },
    // Students — the demo roster. The first three are also the README accounts.
    {
      id: id(10),
      email: "student@slams.edu",
      name: "Ada Obi",
      role: "student",
      matricNo: "CSC/21/1001",
      departmentId: csc.id,
      level: "300",
    },
    {
      id: id(10),
      email: "bello@slams.edu",
      name: "Ibrahim Bello",
      role: "student",
      matricNo: "CSC/21/1002",
      departmentId: csc.id,
      level: "300",
    },
    {
      id: id(10),
      email: "eze@slams.edu",
      name: "Ngozi Eze",
      role: "student",
      matricNo: "CSC/21/1003",
      departmentId: csc.id,
      level: "300",
    },
    {
      id: id(10),
      email: "musa@slams.edu",
      name: "Fatima Musa",
      role: "student",
      matricNo: "MTH/21/2001",
      departmentId: mth.id,
      level: "200",
    },
    {
      id: id(10),
      email: "lawal@slams.edu",
      name: "Tunde Lawal",
      role: "student",
      matricNo: "CSC/22/1010",
      departmentId: csc.id,
      level: "200",
    },
    {
      id: id(10),
      email: "chioma@slams.edu",
      name: "Chioma Nnaji",
      role: "student",
      matricNo: "CSC/22/1011",
      departmentId: csc.id,
      level: "200",
    },
    {
      id: id(10),
      email: "sani@slams.edu",
      name: "Aisha Sani",
      role: "student",
      matricNo: "CSC/22/1012",
      departmentId: csc.id,
      level: "200",
    },
    {
      id: id(10),
      email: "daniel@slams.edu",
      name: "Emeka Daniel",
      role: "student",
      matricNo: "CSC/20/1004",
      departmentId: csc.id,
      level: "400",
    },
    {
      id: id(10),
      email: "grace@slams.edu",
      name: "Blessing Grace",
      role: "student",
      matricNo: "CSC/20/1005",
      departmentId: csc.id,
      level: "400",
    },
    {
      id: id(10),
      email: "yusuf@slams.edu",
      name: "Hauwa Yusuf",
      role: "student",
      matricNo: "MTH/22/2002",
      departmentId: mth.id,
      level: "200",
    },
    {
      id: id(10),
      email: "peter@slams.edu",
      name: "Peter Okon",
      role: "student",
      matricNo: "MTH/21/2003",
      departmentId: mth.id,
      level: "300",
    },
    {
      id: id(10),
      email: "zainab@slams.edu",
      name: "Zainab Aliyu",
      role: "student",
      matricNo: "EEE/22/3001",
      departmentId: eee.id,
      level: "200",
    },
    {
      id: id(10),
      email: "obinna@slams.edu",
      name: "Obinna Uche",
      role: "student",
      matricNo: "EEE/21/3002",
      departmentId: eee.id,
      level: "300",
    },
    {
      id: id(10),
      email: "halima@slams.edu",
      name: "Halima Bala",
      role: "student",
      matricNo: "EEE/21/3003",
      departmentId: eee.id,
      level: "300",
    },
    {
      id: id(10),
      email: "kene@slams.edu",
      name: "Kenechukwu Obi",
      role: "student",
      matricNo: "BIO/22/4001",
      departmentId: bio.id,
      level: "200",
    },
    {
      id: id(10),
      email: "amaka@slams.edu",
      name: "Amaka Ilodibe",
      role: "student",
      matricNo: "BIO/22/4002",
      departmentId: bio.id,
      level: "200",
    },
    {
      id: id(10),
      email: "ibrahim@slams.edu",
      name: "Sadiq Ibrahim",
      role: "student",
      matricNo: "BIO/22/4003",
      departmentId: bio.id,
      level: "200",
    },
    {
      id: id(10),
      email: "funmi@slams.edu",
      name: "Funmilayo Ade",
      role: "student",
      matricNo: "BIO/21/4004",
      departmentId: bio.id,
      level: "300",
    },
  ];

  await insertMany(
    db,
    "users",
    [
      "id",
      "email",
      "password_hash",
      "name",
      "role",
      "matric_no",
      "staff_id",
      "department_id",
      "level",
      "created_at",
    ],
    users.map((u) => [
      u.id,
      u.email,
      passHash,
      u.name,
      u.role,
      u.matricNo ?? null,
      u.staffId ?? null,
      u.departmentId ?? null,
      u.level ?? null,
      now,
    ]),
  );

  const byEmail = (email: string) => users.find((u) => u.email === email)!;
  const amina = byEmail("lecturer@slams.edu");
  const chuka = byEmail("okafor@slams.edu");
  const grace = byEmail("adeyemi@slams.edu");
  const samuel = byEmail("nwosu@slams.edu");
  const studentIds = (...matrics: string[]) =>
    users.filter((u) => u.matricNo && matrics.includes(u.matricNo)).map((u) => u.id);
  const csc200 = studentIds("CSC/22/1010", "CSC/22/1011", "CSC/22/1012");
  const csc300 = studentIds("CSC/21/1001", "CSC/21/1002", "CSC/21/1003");
  const csc400 = studentIds("CSC/20/1004", "CSC/20/1005");

  interface SeedCourse {
    code: string;
    title: string;
    department: typeof csc;
    level: string;
    units: number;
    lecturerId: string;
    students: string[];
    icon: string;
    color: string;
    category: string;
    description: string;
    /** How many past lectures to generate, and how reliable this cohort is. */
    lectures: number;
    /* attendance pattern: [min, max] reliability range for the roster */
    reliability: [number, number];
  }

  const courses: SeedCourse[] = [
    {
      code: "CSC 203",
      title: "Discrete Structures",
      department: csc,
      level: "200",
      units: 3,
      lecturerId: amina.id,
      students: [...csc200, ...csc300],
      icon: "Network",
      color: "oklch(0.55 0.16 250)",
      category: "Core",
      description: "Logic, sets, relations, combinatorics and graph theory for computing.",
      lectures: 14,
      reliability: [0.72, 0.98],
    },
    {
      code: "CSC 305",
      title: "Data Structures & Algorithms",
      department: csc,
      level: "300",
      units: 3,
      lecturerId: amina.id,
      students: [...csc300],
      icon: "Atom",
      color: "oklch(0.55 0.16 165)",
      category: "Core",
      description: "Foundations of data organization, algorithms, and complexity analysis.",
      lectures: 12,
      reliability: [0.8, 0.95],
    },
    {
      code: "CSC 311",
      title: "Operating Systems",
      department: csc,
      level: "300",
      units: 3,
      lecturerId: amina.id,
      students: [...csc300, ...csc400],
      icon: "Cpu",
      color: "oklch(0.5 0.15 220)",
      category: "Core",
      description: "Processes, memory, scheduling, and concurrency.",
      lectures: 10,
      reliability: [0.75, 0.95],
    },
    {
      code: "CSC 341",
      title: "Database Systems",
      department: csc,
      level: "300",
      units: 3,
      lecturerId: amina.id,
      students: [...csc300, ...csc200],
      icon: "Database",
      color: "oklch(0.5 0.14 280)",
      category: "Core",
      description: "Relational modelling, normalisation, transactions and SQL.",
      lectures: 9,
      reliability: [0.7, 0.93],
    },
    {
      code: "CSC 401",
      title: "Artificial Intelligence",
      department: csc,
      level: "400",
      units: 3,
      lecturerId: amina.id,
      students: [...csc400, ...csc300],
      icon: "BrainCircuit",
      color: "oklch(0.55 0.18 300)",
      category: "Elective",
      description: "Search, knowledge representation and machine learning foundations.",
      lectures: 8,
      reliability: [0.82, 0.99],
    },
    {
      code: "MTH 201",
      title: "Linear Algebra",
      department: mth,
      level: "200",
      units: 3,
      lecturerId: chuka.id,
      students: [...studentIds("MTH/21/2001", "MTH/22/2002", "MTH/21/2003"), ...csc200],
      icon: "Sigma",
      color: "oklch(0.6 0.16 60)",
      category: "Core",
      description: "Vectors, matrices, and linear transformations.",
      lectures: 11,
      reliability: [0.55, 0.88],
    },
    {
      code: "MTH 202",
      title: "Calculus II",
      department: mth,
      level: "200",
      units: 3,
      lecturerId: chuka.id,
      students: [...studentIds("MTH/21/2001", "MTH/22/2002", "MTH/21/2003"), ...csc200],
      icon: "FunctionSquare",
      color: "oklch(0.62 0.15 45)",
      category: "Core",
      description: "Integration techniques, series and multivariable calculus.",
      lectures: 10,
      reliability: [0.5, 0.82],
    },
    {
      code: "STA 210",
      title: "Probability & Statistics",
      department: mth,
      level: "200",
      units: 2,
      lecturerId: chuka.id,
      students: [...studentIds("MTH/22/2002"), ...csc200, ...csc300],
      icon: "ChartNoAxesColumn",
      color: "oklch(0.58 0.14 100)",
      category: "Service",
      description: "Probability distributions, estimation and hypothesis testing.",
      lectures: 9,
      reliability: [0.62, 0.9],
    },
    {
      code: "EEE 201",
      title: "Circuit Theory",
      department: eee,
      level: "200",
      units: 3,
      lecturerId: grace.id,
      students: [...studentIds("EEE/22/3001", "EEE/21/3002", "EEE/21/3003")],
      icon: "Zap",
      color: "oklch(0.55 0.16 200)",
      category: "Core",
      description: "Network theorems, transient analysis and AC circuits.",
      lectures: 12,
      reliability: [0.72, 0.97],
    },
    {
      code: "EEE 305",
      title: "Digital Electronics",
      department: eee,
      level: "300",
      units: 3,
      lecturerId: grace.id,
      students: [...studentIds("EEE/21/3002", "EEE/21/3003", "EEE/22/3001")],
      icon: "CircuitBoard",
      color: "oklch(0.52 0.15 185)",
      category: "Core",
      description: "Logic families, sequential circuits and FPGA fundamentals.",
      lectures: 10,
      reliability: [0.75, 0.98],
    },
    {
      code: "BIO 201",
      title: "Genetics",
      department: bio,
      level: "200",
      units: 3,
      lecturerId: samuel.id,
      students: [...studentIds("BIO/22/4001", "BIO/22/4002", "BIO/22/4003", "BIO/21/4004")],
      icon: "Leaf",
      color: "oklch(0.6 0.15 150)",
      category: "Core",
      description: "Mendelian inheritance, gene expression and population genetics.",
      lectures: 11,
      reliability: [0.52, 0.86],
    },
  ];

  // The institution's active period, so seeded lectures are semester-scoped.
  // Both blocks below stamp it on their courses, sessions and records.
  const periodRow = (await db
    .prepare("SELECT current_semester_id AS semester_id FROM site_settings WHERE id = 'site'")
    .first()) as { semester_id: string | null } | null;
  const semesterId = periodRow?.semester_id ?? "sem_current";

  const courseRows: unknown[][] = [];
  const enrollmentRows: unknown[][] = [];
  const sessionRows: unknown[][] = [];
  const recordRows: unknown[][] = [];
  // Recurring series behind the Timetable page (plan P4.1). The weekly pattern is
  // what an institution actually publishes, and it is what makes clash detection
  // meaningful — the seeded pattern contains one genuine room clash (see below).
  const scheduleRows: unknown[][] = [];

  // Rooms are reused across the catalogue on purpose: reusing LT-1 for two
  // courses that meet on the same day at the same hour is exactly the conflict
  // the Timetable page must surface, so the demo data contains a real one.
  const ROOMS = ["LT-1", "LT-2", "LT-3", "Lab A", "Hall B"];
  const DAY_PATTERNS = ["1,3", "2,4", "1", "3,5", "2", "4", "5", "3", "1,4", "2,5", "5"];

  for (const [courseIndex, c] of courses.entries()) {
    const courseId = id();
    courseRows.push([
      courseId,
      c.code,
      c.title,
      c.department.id,
      c.level,
      c.units,
      c.lecturerId,
      c.icon,
      c.color,
      c.category,
      c.description,
      semesterId,
    ]);
    for (const studentId of c.students) {
      // enrolled_at 0 = "since the beginning", so every generated lecture counts.
      enrollmentRows.push([courseId, studentId, 0]);
    }

    // A per-student reliability factor: this is what makes student percentages
    // differ (and the course-wide weighted rate meaningful) rather than every
    // roster looking identical.
    const reliability = new Map(
      c.students.map((studentId) => {
        const [lo, hi] = c.reliability;
        return [studentId, lo + random() * (hi - lo)] as const;
      }),
    );

    // One lecture roughly every 3 days, most recent ~2 days ago.
    for (let i = 0; i < c.lectures; i++) {
      const started = now - (i * 3 + 2) * day - Math.floor(random() * 6) * 60 * 60 * 1000;
      const sessionId = id(10);
      sessionRows.push([
        sessionId,
        courseId,
        c.lecturerId,
        String(100000 + Math.floor(random() * 900000)),
        started,
        started + 30 * 60 * 1000,
        started + 45 * 60 * 1000,
        `Lecture ${c.lectures - i}`,
        semesterId,
      ]);
      for (const studentId of c.students) {
        const reliable = reliability.get(studentId) ?? 0.8;
        const attended = random() < reliable;
        if (!attended) {
          // Closed lectures materialise their unmet expectations: without these
          // rows "absent" is invisible and every course looks the same.
          recordRows.push([
            id(10),
            sessionId,
            studentId,
            courseId,
            started,
            "absent",
            "auto_absent",
            semesterId,
          ]);
          continue;
        }
        const late = random() < 0.18;
        const offset = late
          ? (11 + Math.floor(random() * 15)) * 60 * 1000
          : Math.floor(random() * 10) * 60 * 1000;
        recordRows.push([
          id(10),
          sessionId,
          studentId,
          courseId,
          started + offset,
          late ? "late" : "present",
          "scan",
          semesterId,
        ]);
      }
    }

    scheduleRows.push([
      id(10),
      courseId,
      c.lecturerId,
      55, // a standard 55-minute lecture slot
      `Weekly ${c.code}`,
      "weekly",
      ROOMS[courseIndex % ROOMS.length],
      DAY_PATTERNS[courseIndex % DAY_PATTERNS.length],
      8 * 60 + (courseIndex % 5) * 60, // 08:00, 09:00, 10:00, 11:00, 12:00
      0,
      // The series has already delivered its legs: `occurrences` equals the cap,
      // so the lifecycle tick leaves it alone (it must not invent new lectures
      // for a demo dataset, and the legacy schedule tests assert exact counts).
      1,
      1,
      now - 2 * day,
      1,
      now - 14 * day,
    ]);
  }

  await insertMany(
    db,
    "schedules",
    [
      "id",
      "course_id",
      "lecturer_id",
      "duration_minutes",
      "topic",
      "recurrence",
      "room",
      "days_mask",
      "minute_of_day",
      "tz_offset_minutes",
      "max_occurrences",
      "occurrences",
      "last_start_at",
      "enabled",
      "created_at",
    ],
    scheduleRows,
  );

  await insertMany(
    db,
    "courses",
    [
      "id",
      "code",
      "title",
      "department_id",
      "level",
      "units",
      "lecturer_id",
      "icon",
      "color",
      "category",
      "description",
      "semester_id",
    ],
    courseRows,
  );
  await insertMany(
    db,
    "course_enrollments",
    ["course_id", "student_id", "enrolled_at"],
    enrollmentRows,
  );
  await insertMany(
    db,
    "sessions",
    [
      "id",
      "course_id",
      "lecturer_id",
      "code",
      "started_at",
      "expires_at",
      "ended_at",
      "topic",
      "semester_id",
    ],
    sessionRows,
  );
  await insertMany(
    db,
    "attendance_records",
    ["id", "session_id", "student_id", "course_id", "timestamp", "status", "source", "semester_id"],
    recordRows,
  );

  // ─── Phase 0.5: institution-scale demo dataset ────────────────────────────
  //
  // The dashboard, the All Courses table and the exports are judged on this
  // data, so it has to look like a working institution rather than three
  // courses: eleven courses spread across five departments and three levels,
  // ~60 students, a term's worth of lectures, and — crucially — *varied*
  // attendance, including cohorts doing badly enough to trip the at-risk
  // report and one student who never attends at all.
  //
  // Everything here is derived from a seeded, deterministic PRNG so every
  // install of SLAMS shows the same figures (screenshots and support
  // conversations stay reproducible).

  const extraDepartments = [
    { id: id(), name: "Physics", code: "PHY", icon: "Atom", color: "oklch(0.55 0.15 300)" },
    { id: id(), name: "Chemistry", code: "CHM", icon: "FlaskConical", color: "oklch(0.6 0.15 30)" },
    {
      id: id(),
      name: "General Studies",
      code: "GST",
      icon: "BookOpen",
      color: "oklch(0.6 0.1 250)",
    },
  ];
  for (const d of extraDepartments) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO departments (id, name, code, icon, color) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(d.id, d.name, d.code, d.icon, d.color)
      .run();
  }
  // `bio` (Biological Sciences) is declared with the faculties above.
  const [phy, chm, gst] = extraDepartments;

  // Two more lecturers so the lecturer filter and per-lecturer reports differ.
  const extraUsers: Array<{
    id: string;
    email: string;
    name: string;
    role: "lecturer" | "student";
    matricNo?: string;
    staffId?: string;
    departmentId?: string;
    level?: string;
  }> = [
    {
      id: id(10),
      email: "adeyemi@slams.edu",
      name: "Dr. Grace Adeyemi",
      role: "lecturer",
      staffId: "STF-1003",
      departmentId: phy.id,
    },
    {
      id: id(10),
      email: "nwosu@slams.edu",
      name: "Dr. Samuel Nwosu",
      role: "lecturer",
      staffId: "STF-1004",
      departmentId: bio.id,
    },
  ];

  const FIRST_NAMES = [
    "Ada",
    "Ibrahim",
    "Ngozi",
    "Fatima",
    "Emeka",
    "Aisha",
    "Tunde",
    "Chiamaka",
    "Yusuf",
    "Blessing",
    "Kelechi",
    "Zainab",
    "Oluwaseun",
    "Halima",
    "Chinedu",
    "Amaka",
    "Sadiq",
    "Temitope",
    "Ifeoma",
    "Bashir",
    "Obinna",
    "Rukayat",
    "Damilola",
    "Musa",
    "Chisom",
    "Hauwa",
    "Segun",
    "Nneka",
    "Abdul",
    "Peace",
  ];
  const LAST_NAMES = [
    "Obi",
    "Bello",
    "Eze",
    "Musa",
    "Okafor",
    "Yusuf",
    "Adeyemi",
    "Nwosu",
    "Ibrahim",
    "Ogunleye",
    "Chukwu",
    "Danjuma",
    "Balogun",
    "Umeh",
    "Salami",
    "Afolabi",
    "Nnamdi",
    "Lawal",
    "Okonkwo",
    "Bakare",
  ];
  const studentDepts = [csc, mth, eee, phy, chm, bio, gst];
  const levels = ["100", "200", "300", "400"];
  const roster: Array<{ id: string; departmentId: string; level: string; matricNo: string }> = [];

  for (let i = 0; i < 60; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 7) % LAST_NAMES.length];
    const dept = studentDepts[i % studentDepts.length];
    const level = levels[Math.floor(i / 15) % levels.length];
    // Matric numbers follow the institution's own convention, so they sort and
    // filter the way an administrator expects.
    const matricNo = `${dept.code}/${level.slice(0, 2)}/${2000 + ((i * 13) % 900)}`;
    const user = {
      id: id(10),
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@slams.edu`,
      name: `${first} ${last}`,
      role: "student" as const,
      matricNo,
      departmentId: dept.id,
      level,
    };
    extraUsers.push(user);
    roster.push({ id: user.id, departmentId: dept.id, level, matricNo });
  }

  for (const u of extraUsers) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, matric_no, staff_id, department_id, level, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        u.id,
        u.email,
        passHash,
        u.name,
        u.role,
        u.matricNo ?? null,
        u.staffId ?? null,
        u.departmentId ?? null,
        u.level ?? null,
        Date.now(),
      )
      .run();
  }

  interface CatalogueCourse {
    code: string;
    title: string;
    departmentId: string;
    level: string;
    units: number;
    lecturerId: string;
    category: string;
    icon: string;
    color: string;
    /** How many of the roster to draw, and how well they attend. */
    intake: number;
    lectures: number;
    reliability: [number, number];
  }

  const catalogue: CatalogueCourse[] = [
    {
      code: "CSC 315",
      title: "Human-Computer Interaction",
      departmentId: csc.id,
      level: "300",
      units: 3,
      lecturerId: users[1].id,
      category: "Core",
      icon: "Binary",
      color: "oklch(0.55 0.15 250)",
      intake: 34,
      lectures: 16,
      reliability: [0.58, 0.95],
    },
    {
      code: "CSC 421",
      title: "Machine Learning",
      departmentId: csc.id,
      level: "400",
      units: 3,
      lecturerId: users[1].id,
      category: "Elective",
      icon: "Brain",
      color: "oklch(0.5 0.16 300)",
      intake: 18,
      lectures: 14,
      reliability: [0.62, 0.98],
    },
    {
      code: "MTH 302",
      title: "Numerical Analysis",
      departmentId: mth.id,
      level: "300",
      units: 3,
      lecturerId: users[2].id,
      category: "Core",
      icon: "Sigma",
      color: "oklch(0.6 0.14 60)",
      intake: 22,
      lectures: 15,
      reliability: [0.5, 0.88],
    },
    {
      code: "MTH 210",
      title: "Real Analysis",
      departmentId: mth.id,
      level: "200",
      units: 2,
      lecturerId: users[2].id,
      category: "Core",
      icon: "Percent",
      color: "oklch(0.58 0.13 40)",
      intake: 28,
      lectures: 12,
      reliability: [0.55, 0.92],
    },
    {
      code: "PHY 201",
      title: "Classical Mechanics",
      departmentId: phy.id,
      level: "200",
      units: 3,
      lecturerId: extraUsers[0].id,
      category: "Core",
      icon: "Orbit",
      color: "oklch(0.55 0.15 200)",
      intake: 24,
      lectures: 15,
      reliability: [0.6, 0.94],
    },
    {
      code: "PHY 305",
      title: "Electromagnetism",
      departmentId: phy.id,
      level: "300",
      units: 3,
      lecturerId: extraUsers[0].id,
      category: "Core",
      icon: "Zap",
      color: "oklch(0.52 0.15 220)",
      intake: 16,
      lectures: 13,
      reliability: [0.68, 0.97],
    },
    {
      code: "CHM 101",
      title: "General Chemistry I",
      departmentId: chm.id,
      level: "100",
      units: 3,
      lecturerId: extraUsers[0].id,
      category: "Core",
      icon: "FlaskConical",
      color: "oklch(0.6 0.15 30)",
      intake: 38,
      lectures: 16,
      reliability: [0.66, 0.96],
    },
    {
      code: "EEE 210",
      title: "Electrical Machines",
      departmentId: eee.id,
      level: "200",
      units: 3,
      lecturerId: users[1].id,
      category: "Core",
      icon: "Cpu",
      color: "oklch(0.5 0.13 190)",
      intake: 20,
      lectures: 14,
      reliability: [0.72, 0.99],
    },
    {
      code: "BIO 305",
      title: "Microbiology",
      departmentId: bio.id,
      level: "300",
      units: 3,
      lecturerId: extraUsers[1].id,
      category: "Core",
      icon: "Leaf",
      color: "oklch(0.6 0.15 150)",
      intake: 26,
      lectures: 15,
      reliability: [0.48, 0.9],
    },
    {
      code: "GST 101",
      title: "Communication in English",
      departmentId: gst.id,
      level: "100",
      units: 2,
      lecturerId: extraUsers[1].id,
      category: "Service",
      icon: "BookOpen",
      color: "oklch(0.6 0.1 250)",
      intake: 40,
      lectures: 12,
      reliability: [0.7, 0.98],
    },
  ];

  // ~150 lectures' worth of records: collected here, written in budget-sized
  // batches at the end (see insertMany).
  const seedRecords: unknown[][] = [];

  // A handful of lectures that ran *today*, so the dashboard's "Students Present
  // Today" card and the today-only filters have something real to show.
  const todayPlan: Array<{
    courseId: string;
    lecturerId: string;
    code: string;
    roster: Array<{ id: string }>;
    reliability: Map<string, number>;
  }> = [];

  for (const course of catalogue) {
    const courseId = id();
    await db
      .prepare(
        "INSERT OR IGNORE INTO courses (id, code, title, department_id, level, units, lecturer_id, icon, color, category, description, semester_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        courseId,
        course.code,
        course.title,
        course.departmentId,
        course.level,
        course.units,
        course.lecturerId,
        course.icon,
        course.color,
        course.category,
        `${course.title} — ${course.level} level, ${course.units} units.`,
        semesterId,
      )
      .run();

    // Rosters are drawn from students at (or below) the course's level: an
    // institution's 100-level service course really does carry its largest
    // enrolment, and that is what makes the weighted-total maths visible.
    const candidates = roster.filter((r) =>
      r.departmentId === course.departmentId ? true : Number(r.level) <= Number(course.level),
    );
    const enrolled = candidates.slice(0, course.intake);
    for (const student of enrolled) {
      await db
        .prepare("INSERT OR IGNORE INTO course_enrollments (course_id, student_id) VALUES (?, ?)")
        .bind(courseId, student.id)
        .run();
    }

    // A per-student reliability factor: the reason two students in the same
    // class end the term on different percentages.
    const reliability = new Map(
      enrolled.map((student) => [
        student.id,
        course.reliability[0] + Math.random() * (course.reliability[1] - course.reliability[0]),
      ]),
    );

    const [rosterLo, rosterHi] = course.reliability;
    for (let lecture = 0; lecture < course.lectures; lecture++) {
      // Two lectures a week for the term, most recent one yesterday: past
      // lectures keep "classes held" honest and the weekly chart populated,
      // while nothing lands in the future.
      const started = now - (lecture * 3.5 + 1) * day;
      const sessionId = id(10);
      const code = String(100000 + Math.floor(Math.random() * 900000));
      await db
        .prepare(
          "INSERT OR IGNORE INTO sessions (id, course_id, lecturer_id, code, started_at, expires_at, ended_at, topic, semester_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          sessionId,
          courseId,
          course.lecturerId,
          code,
          Math.round(started),
          Math.round(started + 30 * 60 * 1000),
          Math.round(started + 45 * 60 * 1000),
          `${course.code} lecture ${lecture + 1}`,
          semesterId,
        )
        .run();

      // Batched below via insertMany: D1 refuses a statement with more than 100
      // bound parameters, so the batch size is derived from the column count.
      const rows: unknown[][] = [];
      for (const student of enrolled) {
        const p = reliability.get(student.id) ?? (rosterLo + rosterHi) / 2;
        const roll = Math.random();
        const offset = Math.floor(Math.random() * 12 * 60 * 1000);
        // Sign-ins cluster in the first minutes; a fifth of arrivals are late.
        const ts = Math.round(started + (roll > 0.8 ? 12 * 60 * 1000 + offset : offset));
        if (roll < p) {
          const status = roll > 0.8 ? "late" : "present";
          rows.push([id(10), sessionId, courseId, student.id, ts, status, "scan", semesterId]);
        } else {
          // Materialised absence — the same shape the close-session path writes,
          // so reports can count present/absent/late independently (P0.2).
          rows.push([
            id(10),
            sessionId,
            courseId,
            student.id,
            Math.round(started),
            "absent",
            "auto_absent",
            semesterId,
          ]);
        }
      }
      // Inserted in batches at the end of the seed (one statement per ~11 rows
      // for this column count) rather than one round-trip per record.
      seedRecords.push(...rows);
    }

    if (todayPlan.length < 3) {
      todayPlan.push({
        courseId,
        lecturerId: course.lecturerId,
        code: course.code,
        roster: enrolled,
        reliability,
      });
    }
  }

  // Three lectures that started earlier today (closed, so their absences are
  // materialised exactly like a lecture a lecturer ended by hand).
  const todayStart = zonedDayStart(now, "Africa/Lagos");
  for (const [index, plan] of todayPlan.entries()) {
    const started = Math.max(todayStart + (8 + index) * 60 * 60 * 1000, now - 90 * 60 * 1000);
    if (started > now) continue; // before 08:00 local: skip rather than invent the future
    const sessionId = id(10);
    await db
      .prepare(
        "INSERT OR IGNORE INTO sessions (id, course_id, lecturer_id, code, started_at, expires_at, ended_at, topic, semester_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        sessionId,
        plan.courseId,
        plan.lecturerId,
        String(100000 + Math.floor(Math.random() * 900000)),
        Math.round(started),
        Math.round(started + 30 * 60 * 1000),
        Math.round(Math.min(started + 45 * 60 * 1000, now)),
        `${plan.code} lecture today`,
        semesterId,
      )
      .run();
    for (const student of plan.roster) {
      const p = plan.reliability.get(student.id) ?? 0.8;
      const roll = Math.random();
      const attended = roll < p;
      const late = attended && roll > 0.82;
      seedRecords.push([
        id(10),
        sessionId,
        plan.courseId,
        student.id,
        Math.round(started + (late ? 13 * 60 * 1000 : Math.floor(Math.random() * 8 * 60 * 1000))),
        attended ? (late ? "late" : "present") : "absent",
        attended ? "scan" : "auto_absent",
        semesterId,
      ]);
    }
  }

  await insertMany(
    db,
    "attendance_records",
    ["id", "session_id", "course_id", "student_id", "timestamp", "status", "source", "semester_id"],
    seedRecords,
  );

  await db
    .prepare(
      `INSERT OR IGNORE INTO site_settings (id, institution_name, at_risk_threshold, marquee_items, testimonials,
        demo_accounts_enabled, demo_password, demo_email_domain, show_fake_stats, primary_color, contact_email)
       VALUES ('site', 'SLAMS', 75, ?, ?, 1, 'password123', 'slams.edu', 1, NULL, NULL)`,
    )
    .bind(
      JSON.stringify([
        "Real-time QR check-in",
        "Fraud-resistant codes",
        "Zero paper sheets",
        "Instant reports",
        "Works offline-first",
      ]),
      JSON.stringify([
        {
          name: "Dr. Amina Yusuf",
          role: "Lecturer, Computer Science",
          text: "I stopped chasing attendance sheets. SLAMS just works.",
        },
        {
          name: "Ada Obi",
          role: "300L Student",
          text: "Signing in takes 4 seconds. I never miss a mark now.",
        },
        {
          name: "Prof. Chuka Okafor",
          role: "HOD, Mathematics",
          text: "The faculty report saved me days of manual tallying.",
        },
      ]),
    )
    .run();
}
