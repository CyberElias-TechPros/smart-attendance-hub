// Bulk import: students, lecturers, enrolments and marks (plan P5.4 / D8).
//
// The shape is deliberately preview → validate → apply, and the same validator
// runs for both steps. That matters: a preview that validates differently from
// the apply is worse than no preview, because it launders bad data through a
// green tick. `apply` re-validates the same text it was given and refuses if
// anything changed under it (a duplicate email created by somebody else in the
// meantime), which is why the two share one code path.
//
// Guarantees this module is responsible for:
//   * every row either applies or is reported with its file line number;
//   * nothing is partially applied — the apply step hands one batch to D1, so a
//     failure rolls the whole file back;
//   * existing people are never silently overwritten by an import (an enrolment
//     for an existing matric number links, it does not re-create the student).

import { cell, parseCsv, type CsvParseResult } from "../../shared/csv";
import { gradeFor } from "../../shared/grades";
import type { Repo } from "./db";
import { hashPassword } from "./auth";
import { newId, type D1PreparedStatement } from "./db";

export type ImportKind = "students" | "lecturers" | "enrollments" | "results";

export interface ImportRowReport {
  /** 1-based line in the file the user uploaded. */
  line: number;
  /** The row's identifying value (name / email / matric number). */
  label: string;
  status: "ok" | "error" | "duplicate";
  message?: string;
}

export interface ImportPreview {
  kind: ImportKind;
  /** Columns the file actually had, so a mismatch is obvious. */
  header: string[];
  /** Columns the import expects. */
  expected: string[];
  rows: ImportRowReport[];
  summary: { total: number; valid: number; errors: number; duplicates: number };
  /** True when `apply` will be accepted. */
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
  /** Optional: create imported people with this password instead of a generated one. */
  defaultPassword?: string;
}

const EXPECTED: Record<ImportKind, string[]> = {
  students: ["name", "email", "matric no", "department", "level"],
  lecturers: ["name", "email", "staff id", "department"],
  enrollments: ["matric no"],
  results: ["matric no", "score"],
};

export function expectedColumns(kind: ImportKind): string[] {
  return EXPECTED[kind];
}

/**
 * The template's header row. Human-facing, so it is title-cased ("Matric No");
 * the reader's `cell()` lookup is case- and separator-insensitive, so a file
 * saved from the template uploads unchanged.
 */
export function templateColumns(kind: ImportKind): string[] {
  return EXPECTED[kind].map((c) => c.replace(/\b[a-z]/g, (m) => m.toUpperCase()));
}

/** A password nobody has to remember, so an imported account is usable at once. */
function generatedPassword(kind: ImportKind, seed: string): string {
  const tail = seed
    .replace(/[^a-z0-9]/gi, "")
    .slice(-4)
    .padStart(4, "0");
  return `${kind === "students" ? "student" : "staff"}-${tail}`;
}

interface Prepared {
  report: ImportRowReport[];
  statements?: D1PreparedStatement[];
  created: number;
  linked: number;
}

/**
 * Validate the whole file against the current database. Pure with respect to the
 * database (reads only), so calling it twice — once for the preview, once for the
 * apply — is safe.
 */
async function prepare(repo: Repo, input: ImportInput): Promise<Prepared> {
  const parsed: CsvParseResult = parseCsv(input.csv);
  const report: ImportRowReport[] = parsed.errors.map((e) => ({
    line: e.line,
    label: "—",
    status: "error" as const,
    message: e.message,
  }));
  if (parsed.header.length === 0) {
    return { report, created: 0, linked: 0 };
  }

  const departments = await repo.listDepartments();
  const departmentByCode = new Map(
    departments.flatMap((d) => [
      [d.code.toUpperCase(), d] as const,
      [d.name.toUpperCase(), d] as const,
    ]),
  );
  const users = await repo.listUsers();
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const userByMatric = new Map(
    users.filter((u) => u.matricNo).map((u) => [u.matricNo!.toUpperCase(), u]),
  );
  const userByStaffId = new Map(
    users.filter((u) => u.staffId).map((u) => [u.staffId!.toUpperCase(), u]),
  );

  const statements: D1PreparedStatement[] = [];
  const seenEmails = new Set<string>();
  const seenMatrics = new Set<string>();
  let created = 0;
  let linked = 0;

  const passwordHashFor = async (email: string) =>
    hashPassword(input.defaultPassword?.trim() || generatedPassword(input.kind, email));

  if (input.kind === "students" || input.kind === "lecturers") {
    const role = input.kind === "students" ? "student" : "lecturer";
    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      const line = parsed.lineNumbers[i];
      const name = cell(row, "name", "full name");
      const email = cell(row, "email", "email address").toLowerCase();
      const departmentCode = cell(row, "department", "dept", "department code");
      const level = cell(row, "level");
      const matric = cell(row, "matric no", "matric", "matriculation number");
      const staffId = cell(row, "staff id", "staff no");
      const label = name || email || `line ${line}`;

      const fail = (message: string) => report.push({ line, label, status: "error", message });

      if (!name || name.length < 2) {
        fail("A name is required");
        continue;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        fail(`"${email || "(blank)"}" is not an email address`);
        continue;
      }
      const department = departmentCode
        ? departmentByCode.get(departmentCode.toUpperCase())
        : undefined;
      if (departmentCode && !department) {
        fail(`Unknown department "${departmentCode}"`);
        continue;
      }
      if (input.kind === "students" && !matric) {
        fail("A matric number is required");
        continue;
      }
      if (seenEmails.has(email)) {
        report.push({
          line,
          label,
          status: "duplicate",
          message: "This email appears twice in the file",
        });
        continue;
      }
      if (matric && seenMatrics.has(matric.toUpperCase())) {
        report.push({
          line,
          label,
          status: "duplicate",
          message: `Matric number ${matric} appears twice in the file`,
        });
        continue;
      }
      const existing = userByEmail.get(email);
      if (existing) {
        // An existing person is linked (and their details refreshed) — never
        // duplicated. Re-running an import must not create a second account.
        report.push({
          line,
          label,
          status: "duplicate",
          message: `An account already exists for ${email} — the row is skipped`,
        });
        seenEmails.add(email);
        continue;
      }
      seenEmails.add(email);
      if (matric) seenMatrics.add(matric.toUpperCase());

      const id = newId();
      const passwordHash = await passwordHashFor(email);
      const now = Date.now();
      statements.push(
        repo.statement(
          `INSERT OR IGNORE INTO users (id, name, email, password_hash, role, matric_no, staff_id,
             department_id, level, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            name,
            email,
            passwordHash,
            role,
            matric || null,
            staffId || null,
            department?.id ?? null,
            level || null,
            now,
          ],
        ),
      );
      created++;
      report.push({ line, label, status: "ok" });
    }
    return { report, statements, created, linked };
  }

  if (input.kind === "enrollments") {
    const course = input.courseId ? await repo.getCourse(input.courseId) : undefined;
    if (!course) {
      report.push({
        line: 1,
        label: "—",
        status: "error",
        message: "Choose the course these students are being enrolled on",
      });
      return { report, created: 0, linked: 0 };
    }
    const enrolled = new Set((await repo.listEnrollments(course.id)).map((id) => id));
    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      const line = parsed.lineNumbers[i];
      const matric = cell(row, "matric no", "matric", "matriculation number");
      const email = cell(row, "email").toLowerCase();
      const label = matric || email || `line ${line}`;
      const student = matric
        ? userByMatric.get(matric.toUpperCase())
        : email
          ? userByEmail.get(email)
          : undefined;
      if (!student) {
        report.push({
          line,
          label,
          status: "error",
          message: `No student found for ${label}`,
        });
        continue;
      }
      if (student.role !== "student") {
        report.push({
          line,
          label,
          status: "error",
          message: `${student.name} is not a student account`,
        });
        continue;
      }
      if (enrolled.has(student.id)) {
        report.push({
          line,
          label,
          status: "duplicate",
          message: `${student.name} is already on ${course.code}`,
        });
        continue;
      }
      enrolled.add(student.id);
      statements.push(
        repo.statement(
          "INSERT OR IGNORE INTO course_enrollments (course_id, student_id, enrolled_at) VALUES (?, ?, ?)",
          [course.id, student.id, Date.now()],
        ),
      );
      linked++;
      report.push({ line, label, status: "ok" });
    }
    return { report, statements, created, linked };
  }

  // kind === "results"
  const exam = input.examId ? await repo.getExam(input.examId) : undefined;
  if (!exam) {
    report.push({
      line: 1,
      label: "—",
      status: "error",
      message: "Choose the assessment these marks belong to",
    });
    return { report, created: 0, linked: 0 };
  }
  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const line = parsed.lineNumbers[i];
    const matric = cell(row, "matric no", "matric", "matriculation number");
    const raw = cell(row, "score", "mark");
    const label = matric || `line ${line}`;
    const student = userByMatric.get(matric.toUpperCase());
    if (!student) {
      report.push({
        line,
        label,
        status: "error",
        message: `No student found for matric number "${matric || "(blank)"}"`,
      });
      continue;
    }
    const score = raw === "" ? null : Number(raw);
    if (score != null && (!Number.isFinite(score) || score < 0 || score > exam.maxScore)) {
      report.push({
        line,
        label,
        status: "error",
        message: `"${raw}" is not a score between 0 and ${exam.maxScore}`,
      });
      continue;
    }
    statements.push(
      repo.statement(
        `INSERT INTO results (id, exam_id, course_id, semester_id, student_id, score, grade, entered_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(exam_id, student_id) DO UPDATE SET
           score = excluded.score, grade = excluded.grade, updated_at = excluded.updated_at`,
        [
          newId(),
          exam.id,
          exam.courseId,
          exam.semesterId ?? null,
          student.id,
          score,
          score == null ? null : gradeFor(score, exam.maxScore),
          null,
          Date.now(),
        ],
      ),
    );
    created++;
    report.push({ line, label, status: "ok" });
  }
  return { report, statements, created, linked };
}

function summarise(kind: ImportKind, report: ImportRowReport[]): ImportPreview["summary"] {
  const dataRows = report.filter((r) => r.label !== "—" || r.status !== "error");
  const errors = report.filter((r) => r.status === "error").length;
  const duplicates = report.filter((r) => r.status === "duplicate").length;
  const valid = report.filter((r) => r.status === "ok").length;
  return { total: dataRows.length || report.length, valid, errors, duplicates };
}

export async function previewImport(repo: Repo, input: ImportInput): Promise<ImportPreview> {
  const parsed = parseCsv(input.csv);
  const { report, created } = await prepare(repo, input);
  const summary = summarise(input.kind, report);
  return {
    kind: input.kind,
    header: parsed.header,
    expected: EXPECTED[input.kind],
    rows: report,
    summary,
    // Duplicates are tolerated (they are skipped, which is what makes a re-run
    // safe); hard errors are not.
    ready: summary.errors === 0 && (created > 0 || summary.duplicates > 0),
  };
}

/**
 * Apply the file. Re-validates first, then writes every statement as one batch —
 * so the "nothing partially applied" promise is enforced by the database, not by
 * the order of the statements.
 */
export async function applyImport(repo: Repo, input: ImportInput): Promise<ImportApplyResult> {
  const { report, statements, created, linked } = await prepare(repo, input);
  const summary = summarise(input.kind, report);
  if (summary.errors > 0) {
    const first = report.find((r) => r.status === "error");
    throw new Error(
      `The file still has ${summary.errors} problem(s): line ${first?.line} — ${first?.message}`,
    );
  }
  if (!statements || statements.length === 0) {
    return { kind: input.kind, created: 0, linked: 0, updated: 0, skipped: summary.duplicates };
  }
  await repo.batch(statements);
  return {
    kind: input.kind,
    created,
    linked,
    updated: 0,
    skipped: summary.duplicates,
  };
}
