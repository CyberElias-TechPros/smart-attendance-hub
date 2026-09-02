/**
 * Generates the SQL used to seed a SLAMS database with a first administrator
 * and (optionally) a demonstration dataset.
 *
 * Passwords are hashed here with the same PBKDF2 parameters the Worker uses, so
 * no plaintext credential is ever written to the database or a migration file.
 *
 * Usage:
 *   node --experimental-strip-types scripts/seed.ts --admin-email a@b.edu --admin-password '...' > seed.sql
 *   node --experimental-strip-types scripts/seed.ts --demo --demo-password '...' >> seed.sql
 *   wrangler d1 execute slams --local --file seed.sql
 */

const PBKDF2_ITERATIONS = 210_000;
const enc = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

function id(length = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function sqlString(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const out: string[] = [];
  const now = Date.now();

  if (!has("demo")) {
    const email = arg("admin-email");
    const password = arg("admin-password");
    const name = arg("admin-name") ?? "System Administrator";
    if (!email || !password) {
      console.error(
        "Usage: seed.ts --admin-email <email> --admin-password <password> [--admin-name <name>]",
      );
      process.exit(1);
    }
    if (password.length < 12) {
      console.error("Refusing to seed: choose an administrator password of at least 12 characters.");
      process.exit(1);
    }
    const hash = await hashPassword(password);
    out.push(
      `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at, token_version, failed_logins)
VALUES (${sqlString(id())}, ${sqlString(email.toLowerCase())}, ${sqlString(hash)}, ${sqlString(name)}, 'admin', ${now}, ${now}, 0, 0);`,
    );
    out.push(
      `INSERT OR IGNORE INTO site_settings (id, institution_name, at_risk_threshold, marquee_items, testimonials, demo_accounts_enabled, demo_password, demo_email_domain, show_fake_stats, primary_color, contact_email)
VALUES ('site', 'SLAMS', 70, '[]', '[]', 0, '', 'example.edu', 0, NULL, NULL);`,
    );
    console.log(out.join("\n\n"));
    return;
  }

  // ── Demo dataset ──────────────────────────────────────────────────────────
  const demoPassword = arg("demo-password");
  if (!demoPassword || demoPassword.length < 8) {
    console.error("Usage: seed.ts --demo --demo-password <password of 8+ chars>");
    process.exit(1);
  }
  const hash = await hashPassword(demoPassword);
  const domain = arg("demo-domain") ?? "slams.edu";

  const departments = [
    { id: id(8), name: "Computer Science", code: "CSC", icon: "Code2", color: "oklch(0.5 0.18 250)" },
    { id: id(8), name: "Mathematics", code: "MTH", icon: "Sigma", color: "oklch(0.6 0.16 60)" },
    {
      id: id(8),
      name: "Electrical Engineering",
      code: "EEE",
      icon: "Cpu",
      color: "oklch(0.55 0.16 200)",
    },
  ];
  for (const d of departments) {
    out.push(
      `INSERT INTO departments (id, name, code, icon, color, created_at, updated_at) VALUES (${sqlString(d.id)}, ${sqlString(d.name)}, ${sqlString(d.code)}, ${sqlString(d.icon)}, ${sqlString(d.color)}, ${now}, ${now});`,
    );
  }

  const users = [
    { id: id(), email: `admin@${domain}`, name: "System Administrator", role: "admin" },
    {
      id: id(),
      email: `lecturer@${domain}`,
      name: "Dr. Amina Yusuf",
      role: "lecturer",
      staffId: "STF-1001",
      departmentId: departments[0].id,
    },
    {
      id: id(),
      email: `okafor@${domain}`,
      name: "Prof. Chuka Okafor",
      role: "lecturer",
      staffId: "STF-1002",
      departmentId: departments[1].id,
    },
    {
      id: id(),
      email: `student@${domain}`,
      name: "Ada Obi",
      role: "student",
      matricNo: "CSC/21/1001",
      departmentId: departments[0].id,
      level: "300",
    },
    {
      id: id(),
      email: `bello@${domain}`,
      name: "Ibrahim Bello",
      role: "student",
      matricNo: "CSC/21/1002",
      departmentId: departments[0].id,
      level: "300",
    },
    {
      id: id(),
      email: `eze@${domain}`,
      name: "Ngozi Eze",
      role: "student",
      matricNo: "CSC/21/1003",
      departmentId: departments[0].id,
      level: "300",
    },
    {
      id: id(),
      email: `musa@${domain}`,
      name: "Fatima Musa",
      role: "student",
      matricNo: "MTH/21/2001",
      departmentId: departments[1].id,
      level: "200",
    },
  ] as Array<{
    id: string;
    email: string;
    name: string;
    role: string;
    matricNo?: string;
    staffId?: string;
    departmentId?: string;
    level?: string;
  }>;

  for (const u of users) {
    out.push(
      `INSERT INTO users (id, email, password_hash, name, role, matric_no, staff_id, department_id, level, created_at, updated_at, token_version, failed_logins)
VALUES (${sqlString(u.id)}, ${sqlString(u.email)}, ${sqlString(hash)}, ${sqlString(u.name)}, ${sqlString(u.role)}, ${sqlString(u.matricNo ?? null)}, ${sqlString(u.staffId ?? null)}, ${sqlString(u.departmentId ?? null)}, ${sqlString(u.level ?? null)}, ${now}, ${now}, 0, 0);`,
    );
  }

  const students = users.filter((u) => u.role === "student");
  const courses = [
    {
      id: id(8),
      code: "CSC 305",
      title: "Data Structures & Algorithms",
      departmentId: departments[0].id,
      level: "300",
      units: 3,
      lecturerId: users[1].id,
      enrolled: [students[0].id, students[1].id, students[2].id],
      icon: "Atom",
      color: "oklch(0.55 0.16 165)",
      category: "Core",
      description: "Foundations of data organization, algorithms, and complexity analysis.",
    },
    {
      id: id(8),
      code: "CSC 311",
      title: "Operating Systems",
      departmentId: departments[0].id,
      level: "300",
      units: 3,
      lecturerId: users[1].id,
      enrolled: [students[0].id, students[1].id, students[2].id],
      icon: "Cpu",
      color: "oklch(0.5 0.15 220)",
      category: "Core",
      description: "Processes, memory, scheduling, and concurrency.",
    },
    {
      id: id(8),
      code: "MTH 201",
      title: "Linear Algebra",
      departmentId: departments[1].id,
      level: "200",
      units: 3,
      lecturerId: users[2].id,
      enrolled: [students[3].id, students[0].id],
      icon: "Sigma",
      color: "oklch(0.6 0.16 60)",
      category: "Core",
      description: "Vectors, matrices, and linear transformations.",
    },
  ];

  for (const c of courses) {
    out.push(
      `INSERT INTO courses (id, code, title, department_id, level, units, lecturer_id, icon, color, category, description, created_at, updated_at)
VALUES (${sqlString(c.id)}, ${sqlString(c.code)}, ${sqlString(c.title)}, ${sqlString(c.departmentId)}, ${sqlString(c.level)}, ${c.units}, ${sqlString(c.lecturerId)}, ${sqlString(c.icon)}, ${sqlString(c.color)}, ${sqlString(c.category)}, ${sqlString(c.description)}, ${now}, ${now});`,
    );
    for (const sid of c.enrolled) {
      out.push(
        `INSERT OR IGNORE INTO course_enrollments (course_id, student_id, created_at) VALUES (${sqlString(c.id)}, ${sqlString(sid)}, ${now});`,
      );
    }
  }

  // Historical sessions with deterministic-ish attendance so charts have shape.
  const day = 24 * 60 * 60 * 1000;
  const main = courses[0];
  for (let i = 12; i >= 1; i--) {
    const started = now - i * day;
    const sid = id();
    const code = String(100000 + ((i * 7919) % 900000));
    out.push(
      `INSERT INTO sessions (id, course_id, lecturer_id, code, started_at, expires_at, ended_at, topic)
VALUES (${sqlString(sid)}, ${sqlString(main.id)}, ${sqlString(main.lecturerId)}, ${sqlString(code)}, ${started}, ${started + 30 * 60000}, ${started + 45 * 60000}, ${sqlString(`Lecture ${13 - i}`)});`,
    );
    main.enrolled.forEach((studentId, index) => {
      // Skip roughly one in seven check-ins to create realistic gaps.
      if ((i + index) % 7 === 0) return;
      out.push(
        `INSERT OR IGNORE INTO attendance_records (id, session_id, student_id, course_id, timestamp, method)
VALUES (${sqlString(id())}, ${sqlString(sid)}, ${sqlString(studentId)}, ${sqlString(main.id)}, ${started + (index + 1) * 60000}, 'code');`,
      );
    });
  }

  out.push(
    `INSERT INTO site_settings (id, institution_name, at_risk_threshold, marquee_items, testimonials, demo_accounts_enabled, demo_password, demo_email_domain, show_fake_stats, primary_color, contact_email)
VALUES ('site', 'SLAMS', 70, ${sqlString(JSON.stringify(["Real-time QR check-in", "Fraud-resistant codes", "Zero paper sheets", "Instant reports"]))}, ${sqlString(
      JSON.stringify([
        {
          name: "Dr. Amina Yusuf",
          role: "Lecturer, Computer Science",
          text: "I stopped chasing attendance sheets. SLAMS just works.",
        },
        {
          name: "Ada Obi",
          role: "300L Student",
          text: "Signing in takes four seconds. I never miss a mark now.",
        },
      ]),
    )}, 1, '', ${sqlString(domain)}, 0, NULL, NULL)
ON CONFLICT(id) DO UPDATE SET demo_accounts_enabled = 1, demo_email_domain = excluded.demo_email_domain;`,
  );

  console.log(out.join("\n"));
}

void main();
