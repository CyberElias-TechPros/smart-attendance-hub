// Lecturer and student endpoints: sessions, attendance, reports.

import {
  markAttendanceSchema,
  paginationSchema,
  startSessionSchema,
  submitAttendanceSchema,
} from "../../shared/schemas";
import { audit } from "../lib/audit";
import { requireCsrf, requireUser, type RequestContext } from "../lib/context";
import { ApiError } from "../lib/errors";
import { enforceRateLimit, json, readJson, readQuery } from "../lib/http";
import { Repo } from "../lib/repo";

/** Verifies the caller may act on a course: admins always, lecturers if it's theirs. */
async function assertCourseAccess(
  c: RequestContext,
  repo: Repo,
  courseId: string,
  role: string,
  userId: string,
) {
  const course = await repo.getCourse(courseId);
  if (!course) throw ApiError.notFound("That course no longer exists.");
  if (role === "admin") return course;
  if (course.lecturerId !== userId) {
    throw ApiError.forbidden("You are not assigned to this course.");
  }
  return course;
}

async function assertSessionAccess(
  c: RequestContext,
  repo: Repo,
  sessionId: string,
  role: string,
  userId: string,
) {
  const session = await repo.getSession(sessionId);
  if (!session) throw ApiError.notFound("That session no longer exists.");
  if (role !== "admin" && session.lecturerId !== userId) {
    throw ApiError.forbidden("That session belongs to another lecturer.");
  }
  return session;
}

// ── Lecturer ────────────────────────────────────────────────────────────────

export async function lecturerCourses(c: RequestContext): Promise<Response> {
  const claims = await requireUser(c, ["lecturer"]);
  const repo = new Repo(c.env.DB);
  return json({ items: await repo.lecturerCourses(claims.sub) });
}

export async function lecturerOverview(c: RequestContext): Promise<Response> {
  const claims = await requireUser(c, ["lecturer"]);
  const repo = new Repo(c.env.DB);
  const [stats, courses, sessions] = await Promise.all([
    repo.lecturerOverview(claims.sub),
    repo.lecturerCourses(claims.sub),
    repo.listSessionsForLecturer(claims.sub, 8),
  ]);
  return json({ stats, courses, recentSessions: sessions });
}

export async function lecturerSessions(c: RequestContext): Promise<Response> {
  const claims = await requireUser(c, ["lecturer"]);
  const repo = new Repo(c.env.DB);
  return json({ items: await repo.listSessionsForLecturer(claims.sub) });
}

export async function courseSessions(c: RequestContext, courseId: string): Promise<Response> {
  const claims = await requireUser(c, ["lecturer", "admin"]);
  const repo = new Repo(c.env.DB);
  await assertCourseAccess(c, repo, courseId, claims.role, claims.sub);
  return json({ items: await repo.listSessionsForCourse(courseId) });
}

export async function courseDetail(c: RequestContext, courseId: string): Promise<Response> {
  const claims = await requireUser(c, ["lecturer", "admin"]);
  const repo = new Repo(c.env.DB);
  const course = await assertCourseAccess(c, repo, courseId, claims.role, claims.sub);
  const [sessions, report] = await Promise.all([
    repo.listSessionsForCourse(courseId),
    repo.courseReport(courseId),
  ]);
  return json({ course, sessions, report });
}

export async function startSession(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  const claims = await requireUser(c, ["lecturer"]);
  const body = await readJson(c.request, startSessionSchema);
  const repo = new Repo(c.env.DB);
  await assertCourseAccess(c, repo, body.courseId, claims.role, claims.sub);

  // Two live sessions for one course would mean two valid codes and a split
  // register, so the existing one is returned instead of silently duplicating.
  const live = await repo.findLiveSessionForCourse(body.courseId);
  if (live) {
    throw ApiError.conflict(
      "A session is already running for this course. End it before starting another.",
    );
  }

  const session = await repo.startSession({ ...body, lecturerId: claims.sub });
  audit(c, {
    action: "session.started",
    resource: "session",
    resourceId: session.id,
    metadata: {
      courseId: body.courseId,
      durationMinutes: body.durationMinutes,
      geofenced: body.radiusMeters != null,
    },
  });
  return json({ session }, { status: 201 });
}

export async function endSession(c: RequestContext, sessionId: string): Promise<Response> {
  requireCsrf(c);
  const claims = await requireUser(c, ["lecturer", "admin"]);
  const repo = new Repo(c.env.DB);
  await assertSessionAccess(c, repo, sessionId, claims.role, claims.sub);
  await repo.endSession(sessionId);
  audit(c, { action: "session.ended", resource: "session", resourceId: sessionId });
  return json({ session: await repo.getSession(sessionId) });
}

export async function extendSession(c: RequestContext, sessionId: string): Promise<Response> {
  requireCsrf(c);
  const claims = await requireUser(c, ["lecturer", "admin"]);
  const { z } = await import("zod");
  const { minutes } = await readJson(
    c.request,
    z.object({ minutes: z.coerce.number().int().min(1).max(120) }),
  );
  const repo = new Repo(c.env.DB);
  const session = await assertSessionAccess(c, repo, sessionId, claims.role, claims.sub);
  if (session.endedAt) throw ApiError.conflict("That session has already ended.");
  const updated = await repo.extendSession(sessionId, minutes);
  audit(c, {
    action: "session.extended",
    resource: "session",
    resourceId: sessionId,
    metadata: { minutes },
  });
  return json({ session: updated });
}

export async function sessionDetail(c: RequestContext, sessionId: string): Promise<Response> {
  const claims = await requireUser(c, ["lecturer", "admin"]);
  const repo = new Repo(c.env.DB);
  await assertSessionAccess(c, repo, sessionId, claims.role, claims.sub);
  const detail = await repo.sessionDetail(sessionId);
  if (!detail) throw ApiError.notFound("That session no longer exists.");
  return json(detail);
}

export async function markAttendance(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  const claims = await requireUser(c, ["lecturer", "admin"]);
  const body = await readJson(c.request, markAttendanceSchema);
  const repo = new Repo(c.env.DB);
  await assertSessionAccess(c, repo, body.sessionId, claims.role, claims.sub);
  await repo.markAttendance(body.sessionId, body.studentId, claims.sub);
  audit(c, {
    action: "attendance.marked",
    resource: "session",
    resourceId: body.sessionId,
    metadata: { studentId: body.studentId },
  });
  return json({ ok: true }, { status: 201 });
}

export async function deleteAttendanceRecord(
  c: RequestContext,
  recordId: string,
): Promise<Response> {
  requireCsrf(c);
  const claims = await requireUser(c, ["lecturer", "admin"]);
  const repo = new Repo(c.env.DB);
  const record = await repo.getAttendanceRecord(recordId);
  if (!record) throw ApiError.notFound("That attendance record no longer exists.");
  await assertSessionAccess(c, repo, record.session_id, claims.role, claims.sub);
  await repo.deleteAttendanceRecord(recordId);
  audit(c, {
    action: "attendance.deleted",
    resource: "attendance_record",
    resourceId: recordId,
    metadata: { sessionId: record.session_id, studentId: record.student_id },
  });
  return json({ ok: true });
}

export async function courseReport(c: RequestContext, courseId: string): Promise<Response> {
  const claims = await requireUser(c, ["lecturer", "admin"]);
  const repo = new Repo(c.env.DB);
  await assertCourseAccess(c, repo, courseId, claims.role, claims.sub);
  const report = await repo.courseReport(courseId);
  if (!report) throw ApiError.notFound("That course no longer exists.");
  return json(report);
}

// ── Student ─────────────────────────────────────────────────────────────────

export async function studentCourses(c: RequestContext): Promise<Response> {
  const claims = await requireUser(c, ["student"]);
  const repo = new Repo(c.env.DB);
  return json({ items: await repo.studentCourses(claims.sub) });
}

export async function studentCourseDetail(
  c: RequestContext,
  courseId: string,
): Promise<Response> {
  const claims = await requireUser(c, ["student"]);
  const repo = new Repo(c.env.DB);
  if (!(await repo.isEnrolled(courseId, claims.sub))) {
    throw ApiError.forbidden("You are not enrolled in this course.");
  }
  const courses = await repo.studentCourses(claims.sub);
  const course = courses.find((x) => x.id === courseId);
  if (!course) throw ApiError.notFound("That course no longer exists.");
  const sessions = await repo.studentCourseSessions(claims.sub, courseId);
  return json({ course, sessions });
}

export async function studentHistory(c: RequestContext): Promise<Response> {
  const claims = await requireUser(c, ["student"]);
  const query = readQuery(c.url, paginationSchema);
  const repo = new Repo(c.env.DB);
  return json(await repo.studentHistory(claims.sub, query));
}

export async function studentOpenSessions(c: RequestContext): Promise<Response> {
  const claims = await requireUser(c, ["student"]);
  const repo = new Repo(c.env.DB);
  return json({ items: await repo.listOpenSessionsForStudent(claims.sub) });
}

export async function submitAttendance(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  const claims = await requireUser(c, ["student"]);
  // Brute-forcing 6-digit codes is the main attack on this endpoint.
  await enforceRateLimit(c, { key: "attend", limit: 12, windowSeconds: 300 }, claims.sub);
  const body = await readJson(c.request, submitAttendanceSchema);
  const repo = new Repo(c.env.DB);
  const result = await repo.submitAttendance({ ...body, studentId: claims.sub });
  audit(c, {
    action: "attendance.submitted",
    resource: "session",
    resourceId: result.sessionId,
    metadata: { courseCode: result.course.code, geo: body.latitude != null },
  });
  return json(result, { status: 201 });
}
