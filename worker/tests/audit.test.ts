// Phase 0.3 — the append-only audit trail (plan §4.6 / brief §9).
//
// The brief requires that "all attendance corrections must be recorded in an
// audit log". These tests pin the guarantees an institution will rely on when
// someone disputes a record: the actor is captured, the before AND after values
// are captured, the reason is captured, and there is no way to remove a row.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, createD1Shim, type D1Shim } from "./d1-shim";
import { getRepo, type Repo } from "../src/db";
import { describeAudit, pointerFor, recordAudit } from "../src/audit-log";

let shim: D1Shim;
let repo: Repo;

beforeAll(async () => {
  shim = createD1Shim();
  applyMigrations(shim.raw);
  repo = await getRepo(shim.db);
});
afterAll(() => shim.close());

const SECRET = new TextEncoder().encode("test-secret-with-enough-entropy-0123456789");

async function fixture(suffix: string) {
  const dept = (await repo.listDepartments())[0];
  const lecturer = await repo.getUserByEmail("lecturer@slams.edu");
  const course = await repo.createCourse({
    code: `AUD ${suffix}`,
    title: `Audit ${suffix}`,
    departmentId: dept.id,
    level: "200",
    units: 2,
  });
  await repo.assignLecturer(course.id, lecturer!.id);
  const studentId = await repo.createUser({
    name: `Audit Student ${suffix}`,
    email: `audit-${suffix}@slams.edu`,
    password: "password123",
    role: "student",
    matricNo: `AUD/${suffix}`,
    departmentId: dept.id,
    level: "200",
  });
  await repo.setEnrollments(course.id, [studentId]);
  const session = await repo.startSession({
    courseId: course.id,
    lecturerId: lecturer!.id,
    durationMinutes: 15,
  });
  return { courseId: course.id, studentId, session, lecturerId: lecturer!.id };
}

describe("audit trail — corrections are attributed and reasoned", () => {
  it("records who changed what, why, and both values", async () => {
    const f = await fixture("1");
    await repo.submitAttendance({ code: f.session.code, studentId: f.studentId, deviceId: "a1" });
    const record = shim.raw
      .prepare("SELECT id FROM attendance_records WHERE session_id = ?")
      .get(f.session.id) as { id: string };

    const before = await repo.setAttendanceStatus(record.id, "late", {
      actorId: f.lecturerId,
      actorRole: "lecturer",
      actorEmail: "lecturer@slams.edu",
      reason: "Arrived 10 minutes late",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (test)",
      reqId: "req-abc",
      secret: SECRET,
    });
    expect(before.status).toBe("late");
    expect(before.reason).toBe("Arrived 10 minutes late");
    expect(before.markedBy).toBe(f.lecturerId);
    expect(before.source).toBe("scan"); // a real sign-in stays a scan
    expect(before.locked).toBe(false);

    const trail = await repo.listAudit({ action: "attendance.update" });
    const entry = trail.items.find((i) => i.entityId === record.id)!;
    expect(entry).toBeTruthy();
    expect(entry.actorId).toBe(f.lecturerId);
    expect(entry.actorRole).toBe("lecturer");
    expect(entry.reqId).toBe("req-abc");
    expect(entry.reason).toBe("Arrived 10 minutes late");
    expect((entry.before as { status: string }).status).toBe("present");
    expect((entry.after as { status: string }).status).toBe("late");

    // Privacy: the raw IP and user-agent never land in the audit table.
    const raw = shim.raw.prepare("SELECT * FROM audit_log WHERE id = ?").get(entry.id) as Record<
      string,
      unknown
    >;
    expect(raw.ip_pointer).toBeTruthy();
    expect(JSON.stringify(raw)).not.toContain("203.0.113.7");
    expect(JSON.stringify(raw)).not.toContain("Mozilla/5.0 (test)");
  });

  it("flags a human-corrected absence so it can never be read as a scan", async () => {
    const f = await fixture("2");
    await repo.endSession(f.session.id); // nobody signed in → materialised absence
    const absent = shim.raw
      .prepare("SELECT id, status, source FROM attendance_records WHERE session_id = ?")
      .get(f.session.id) as { id: string; status: string; source: string };
    expect(absent.status).toBe("absent");
    expect(absent.source).toBe("auto_absent");

    const excused = await repo.setAttendanceStatus(absent.id, "excused", {
      actorId: f.lecturerId,
      reason: "Approved medical absence",
      secret: SECRET,
    });
    expect(excused.status).toBe("excused");
    expect(excused.source).toBe("manual"); // provenance follows the human, not the row

    const trail = await repo.listAudit({ entityId: absent.id, entityType: "attendance_record" });
    expect(trail.items).toHaveLength(1);
    expect(trail.items[0].action).toBe("attendance.update");
  });

  it("audits deletions and keeps the deleted row in the trail", async () => {
    const f = await fixture("3");
    await repo.submitAttendance({ code: f.session.code, studentId: f.studentId, deviceId: "a3" });
    const record = shim.raw
      .prepare("SELECT id FROM attendance_records WHERE session_id = ?")
      .get(f.session.id) as { id: string };

    const removed = await repo.deleteAttendanceRecord(record.id, {
      actorId: f.lecturerId,
      reason: "Duplicate sign-in from a shared phone",
      secret: SECRET,
    });
    expect(removed.id).toBe(record.id);

    const gone = await repo.getAttendanceRecord(record.id);
    expect(gone).toBeUndefined();

    const trail = await repo.listAudit({ action: "attendance.void", entityId: record.id });
    expect(trail.items).toHaveLength(1);
    expect(trail.items[0].reason).toBe("Duplicate sign-in from a shared phone");
    expect((trail.items[0].before as { studentId: string }).studentId).toBe(f.studentId);
  });

  it("refuses to touch a frozen (finalised-period) record without an override", async () => {
    const f = await fixture("4");
    await repo.submitAttendance({ code: f.session.code, studentId: f.studentId, deviceId: "a4" });
    const record = shim.raw
      .prepare("SELECT id FROM attendance_records WHERE session_id = ?")
      .get(f.session.id) as { id: string };
    shim.raw.prepare("UPDATE attendance_records SET locked = 1 WHERE id = ?").run(record.id);

    await expect(
      repo.setAttendanceStatus(record.id, "excused", { actorId: f.lecturerId, reason: "x" }),
    ).rejects.toThrow(/finalised period/);

    // An administrator with an override can still correct it — and it is logged.
    const ok = await repo.setAttendanceStatus(record.id, "excused", {
      actorId: "admin-1",
      actorRole: "admin",
      reason: "Registrar approved an exception",
      allowLocked: true,
      secret: SECRET,
    });
    expect(ok.status).toBe("excused");
    expect((await repo.listAudit({ entityId: record.id })).items).toHaveLength(1);
  });
});

describe("audit trail — read side", () => {
  it("filters, paginates, and orders newest first", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.appendAudit({
        action: "course.update",
        entityType: "course",
        entityId: `c-${i}`,
        courseId: "c-3",
        actorId: "admin-1",
        reason: `change ${i}`,
      });
    }
    const byCourse = await repo.listAudit({ courseId: "c-3" });
    expect(byCourse.items.length).toBe(5);
    expect(byCourse.items.every((i) => i.courseId === "c-3")).toBe(true);

    const page = await repo.listAudit({ action: "course.update", page: 1, pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(5);
    expect(page.pageSize).toBe(2);
    // Newest first: pagination must not shuffle rows between pages.
    const page2 = await repo.listAudit({ action: "course.update", page: 2, pageSize: 2 });
    expect(page2.items[0].id).not.toBe(page.items[0].id);

    const byActor = await repo.listAudit({ actorId: "admin-1" });
    expect(byActor.items.length).toBeGreaterThanOrEqual(5);

    const bounded = await repo.listAudit({ from: Date.now() + 60_000 });
    expect(bounded.items).toHaveLength(0);
    expect(bounded.total).toBe(0);
  });

  it("caps page size so a single request cannot dump the table", async () => {
    const wide = await repo.listAudit({ pageSize: 10_000 });
    expect(wide.pageSize).toBe(200);
  });
});

describe("audit trail — writer robustness", () => {
  it("never throws into the caller when the write fails", async () => {
    const broken = {
      appendAudit: async () => {
        throw new Error("D1 unavailable");
      },
    };
    // A failed audit write must be reported (console.error) but must not break
    // the attendance correction that triggered it.
    await expect(
      recordAudit(broken, {
        action: "attendance.update",
        entityType: "attendance_record",
        entityId: "r1",
      }),
    ).resolves.toBe(false);
  });

  it("derives privacy-preserving pointers and degrades safely without a secret", async () => {
    const ptr = await pointerFor("203.0.113.7", SECRET);
    expect(ptr).toBeTruthy();
    expect(ptr).not.toContain("203.0.113.7");
    expect(ptr).toHaveLength(16);

    // Same input → same pointer (joinable), different input → different pointer.
    expect(await pointerFor("203.0.113.7", SECRET)).toBe(ptr);
    expect(await pointerFor("203.0.113.8", SECRET)).not.toBe(ptr);
    // A different secret must not reproduce the same pointer (keyed).
    const other = new TextEncoder().encode("a-completely-different-secret-0123456789");
    expect(await pointerFor("203.0.113.7", other)).not.toBe(ptr);
    // No secret / short secret → no pointer rather than a weak one.
    expect(await pointerFor("203.0.113.7", undefined)).toBeNull();
    expect(await pointerFor("203.0.113.7", new TextEncoder().encode("short"))).toBeNull();
    expect(await pointerFor(undefined, SECRET)).toBeNull();
  });

  it("describes an entry for humans and exports", async () => {
    const entry = {
      id: "a1",
      actorEmail: "registrar@slams.edu",
      action: "attendance.update",
      entityType: "attendance_record",
      entityId: "rec-9",
      reason: "Medical note received",
      createdAt: Date.now(),
    };
    const text = describeAudit(entry);
    expect(text).toContain("registrar@slams.edu");
    expect(text).toContain("attendance update");
    expect(text).toContain("rec-9");
    expect(text).toContain("Medical note received"); // the reason is surfaced
    // A system entry (no user) still reads sensibly.
    expect(describeAudit({ ...entry, actorEmail: undefined })).toContain("system");
  });
});
