// Demo-data seeding. Runs once on first use of an empty database (all
// environments). Mirrors the data described in the README's demo accounts.

import { nanoid } from "nanoid";
import { hashPassword } from "./auth";
import type { D1Database } from "./db";

export async function seedD1(db: D1Database): Promise<void> {
  const passHash = await hashPassword("password123");
  const id = (n = 8) => nanoid(n);

  const csc = {
    id: id(),
    name: "Computer Science",
    code: "CSC",
    icon: "Code2",
    color: "oklch(0.5 0.18 250)",
  };
  const mth = {
    id: id(),
    name: "Mathematics",
    code: "MTH",
    icon: "Sigma",
    color: "oklch(0.6 0.16 60)",
  };
  const eee = {
    id: id(),
    name: "Electrical Engineering",
    code: "EEE",
    icon: "Cpu",
    color: "oklch(0.55 0.16 200)",
  };

  // INSERT OR IGNORE so seeding is safe under multi-isolate concurrency (two
  // isolates can race the seed on first deploy; the second collapses silently).
  await db
    .prepare(
      "INSERT OR IGNORE INTO departments (id, name, code, icon, color) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    )
    .bind(
      csc.id,
      csc.name,
      csc.code,
      csc.icon,
      csc.color,
      mth.id,
      mth.name,
      mth.code,
      mth.icon,
      mth.color,
      eee.id,
      eee.name,
      eee.code,
      eee.icon,
      eee.color,
    )
    .run();

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
  ];
  for (const u of users) {
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

  const c1 = {
    id: id(),
    code: "CSC 305",
    title: "Data Structures & Algorithms",
    departmentId: csc.id,
    level: "300",
    units: 3,
    lecturerId: users[1].id,
    enrolled: [users[3].id, users[4].id, users[5].id],
    icon: "Atom",
    color: "oklch(0.55 0.16 165)",
    category: "Core",
    description: "Foundations of data organization, algorithms, and complexity analysis.",
  };
  const c2 = {
    id: id(),
    code: "CSC 311",
    title: "Operating Systems",
    departmentId: csc.id,
    level: "300",
    units: 3,
    lecturerId: users[1].id,
    enrolled: [users[3].id, users[4].id, users[5].id],
    icon: "Cpu",
    color: "oklch(0.5 0.15 220)",
    category: "Core",
    description: "Processes, memory, scheduling, and concurrency.",
  };
  const c3 = {
    id: id(),
    code: "MTH 201",
    title: "Linear Algebra",
    departmentId: mth.id,
    level: "200",
    units: 3,
    lecturerId: users[2].id,
    enrolled: [users[6].id, users[3].id],
    icon: "Sigma",
    color: "oklch(0.6 0.16 60)",
    category: "Core",
    description: "Vectors, matrices, and linear transformations.",
  };
  for (const c of [c1, c2, c3]) {
    await db
      .prepare(
        "INSERT OR IGNORE INTO courses (id, code, title, department_id, level, units, lecturer_id, icon, color, category, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        c.id,
        c.code,
        c.title,
        c.departmentId,
        c.level,
        c.units,
        c.lecturerId,
        c.icon ?? null,
        c.color ?? null,
        c.category ?? null,
        c.description ?? null,
      )
      .run();
    for (const sid of c.enrolled) {
      await db
        .prepare("INSERT OR IGNORE INTO course_enrollments (course_id, student_id) VALUES (?, ?)")
        .bind(c.id, sid)
        .run();
    }
  }

  // 12 days of history for CSC 305 so dashboards/charts are meaningful at first login.
  const day = 24 * 60 * 60 * 1000;
  for (let i = 12; i >= 1; i--) {
    const started = Date.now() - i * day;
    const sid = id(10);
    const code = String(100000 + Math.floor(Math.random() * 900000));
    await db
      .prepare(
        "INSERT OR IGNORE INTO sessions (id, course_id, lecturer_id, code, started_at, expires_at, ended_at, topic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        sid,
        c1.id,
        users[1].id,
        code,
        started,
        started + 30 * 60 * 1000,
        started + 45 * 60 * 1000,
        `Lecture ${13 - i}`,
      )
      .run();
    for (const st of c1.enrolled) {
      if (Math.random() > 0.15) {
        await db
          .prepare(
            "INSERT OR IGNORE INTO attendance_records (id, session_id, student_id, course_id, timestamp) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(id(10), sid, st, c1.id, started + Math.floor(Math.random() * 20 * 60 * 1000))
          .run();
      }
    }
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO site_settings (id, institution_name, at_risk_threshold, marquee_items, testimonials,
        demo_accounts_enabled, demo_password, demo_email_domain, show_fake_stats, primary_color, contact_email)
       VALUES ('site', 'SLAMS', 70, ?, ?, 1, 'password123', 'slams.edu', 1, NULL, NULL)`,
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
