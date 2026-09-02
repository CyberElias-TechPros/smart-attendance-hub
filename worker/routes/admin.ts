import {
  courseInputSchema,
  createLecturerSchema,
  createStudentSchema,
  departmentInputSchema,
  enrollStudentsSchema,
  assignLecturerSchema,
  listAuditSchema,
  listUsersSchema,
  siteSettingsSchema,
  updateCourseSchema,
  updateLecturerSchema,
  updateStudentSchema,
} from "../../shared/schemas";
import { audit } from "../lib/audit";
import { requireCsrf, requireUser, type RequestContext } from "../lib/context";
import { ApiError } from "../lib/errors";
import { json, readJson, readQuery } from "../lib/http";
import { Repo } from "../lib/repo";
import { invalidateSettingsCache } from "./public";

export async function listUsers(c: RequestContext): Promise<Response> {
  await requireUser(c, ["admin"]);
  const query = readQuery(c.url, listUsersSchema);
  const repo = new Repo(c.env.DB);
  return json(await repo.listUsers(query));
}

export async function listStudentOptions(c: RequestContext): Promise<Response> {
  await requireUser(c, ["admin"]);
  const repo = new Repo(c.env.DB);
  return json({ items: await repo.listAllStudents() });
}

export async function listLecturerOptions(c: RequestContext): Promise<Response> {
  await requireUser(c, ["admin"]);
  const repo = new Repo(c.env.DB);
  return json({ items: await repo.listLecturers() });
}

export async function createStudent(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, createStudentSchema);
  const repo = new Repo(c.env.DB);
  const id = await repo.createUser({ ...body, role: "student" });
  audit(c, {
    action: "user.created",
    resource: "user",
    resourceId: id,
    metadata: { role: "student", email: body.email },
  });
  return json({ id }, { status: 201 });
}

export async function createLecturer(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, createLecturerSchema);
  const repo = new Repo(c.env.DB);
  const id = await repo.createUser({ ...body, role: "lecturer" });
  audit(c, {
    action: "user.created",
    resource: "user",
    resourceId: id,
    metadata: { role: "lecturer", email: body.email },
  });
  return json({ id }, { status: 201 });
}

export async function updateStudent(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, updateStudentSchema);
  const repo = new Repo(c.env.DB);
  const target = await repo.getUser(body.id);
  if (!target) throw ApiError.notFound("That student no longer exists.");
  if (target.role !== "student") throw ApiError.validation("That account is not a student.");
  await repo.updateUser(body.id, { ...body, password: body.password || undefined });
  audit(c, {
    action: "user.updated",
    resource: "user",
    resourceId: body.id,
    metadata: { role: "student", passwordReset: !!body.password },
  });
  return json({ ok: true });
}

export async function updateLecturer(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, updateLecturerSchema);
  const repo = new Repo(c.env.DB);
  const target = await repo.getUser(body.id);
  if (!target) throw ApiError.notFound("That lecturer no longer exists.");
  if (target.role !== "lecturer") throw ApiError.validation("That account is not a lecturer.");
  await repo.updateUser(body.id, { ...body, password: body.password || undefined });
  audit(c, {
    action: "user.updated",
    resource: "user",
    resourceId: body.id,
    metadata: { role: "lecturer", passwordReset: !!body.password },
  });
  return json({ ok: true });
}

export async function deleteUser(c: RequestContext, id: string): Promise<Response> {
  requireCsrf(c);
  const claims = await requireUser(c, ["admin"]);
  const repo = new Repo(c.env.DB);
  const target = await repo.getUser(id);
  if (!target) throw ApiError.notFound("That user no longer exists.");
  // Guard rails: an admin cannot lock themselves out or remove the last admin.
  if (target.id === claims.sub) throw ApiError.conflict("You cannot delete your own account.");
  if (target.role === "admin" && (await repo.countAdmins()) <= 1) {
    throw ApiError.conflict("At least one administrator must remain.");
  }
  await repo.softDeleteUser(id);
  audit(c, {
    action: "user.deleted",
    resource: "user",
    resourceId: id,
    metadata: { role: target.role },
  });
  return json({ ok: true });
}

// ── Departments ─────────────────────────────────────────────────────────────

export async function createDepartment(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, departmentInputSchema);
  const repo = new Repo(c.env.DB);
  const id = await repo.createDepartment(body);
  audit(c, { action: "department.created", resource: "department", resourceId: id, metadata: body });
  return json({ id }, { status: 201 });
}

export async function updateDepartment(c: RequestContext, id: string): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, departmentInputSchema);
  const repo = new Repo(c.env.DB);
  await repo.updateDepartment(id, body);
  audit(c, { action: "department.updated", resource: "department", resourceId: id, metadata: body });
  return json({ ok: true });
}

export async function deleteDepartment(c: RequestContext, id: string): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const repo = new Repo(c.env.DB);
  await repo.deleteDepartment(id);
  audit(c, { action: "department.deleted", resource: "department", resourceId: id });
  return json({ ok: true });
}

// ── Courses ─────────────────────────────────────────────────────────────────

export async function createCourse(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, courseInputSchema);
  const repo = new Repo(c.env.DB);
  const id = await repo.createCourse(body);
  audit(c, {
    action: "course.created",
    resource: "course",
    resourceId: id,
    metadata: { code: body.code },
  });
  return json({ id }, { status: 201 });
}

export async function updateCourse(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, updateCourseSchema);
  const repo = new Repo(c.env.DB);
  await repo.updateCourse(body.id, body);
  audit(c, {
    action: "course.updated",
    resource: "course",
    resourceId: body.id,
    metadata: { code: body.code },
  });
  return json({ ok: true });
}

export async function deleteCourse(c: RequestContext, id: string): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const repo = new Repo(c.env.DB);
  await repo.deleteCourse(id);
  audit(c, { action: "course.deleted", resource: "course", resourceId: id });
  return json({ ok: true });
}

export async function setCourseArchived(c: RequestContext, id: string): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const { archived } = await readJson(
    c.request,
    (await import("zod")).z.object({ archived: (await import("zod")).z.boolean() }),
  );
  const repo = new Repo(c.env.DB);
  await repo.setCourseArchived(id, archived);
  audit(c, {
    action: archived ? "course.archived" : "course.restored",
    resource: "course",
    resourceId: id,
  });
  return json({ ok: true });
}

export async function assignLecturer(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, assignLecturerSchema);
  const repo = new Repo(c.env.DB);
  await repo.assignLecturer(body.courseId, body.lecturerId);
  audit(c, {
    action: "course.lecturer_assigned",
    resource: "course",
    resourceId: body.courseId,
    metadata: { lecturerId: body.lecturerId },
  });
  return json({ ok: true });
}

export async function enrollStudents(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, enrollStudentsSchema);
  const repo = new Repo(c.env.DB);
  await repo.setEnrollments(body.courseId, body.studentIds);
  audit(c, {
    action: "course.enrollments_set",
    resource: "course",
    resourceId: body.courseId,
    metadata: { count: body.studentIds.length },
  });
  return json({ ok: true });
}

// ── Reports & settings ──────────────────────────────────────────────────────

export async function adminOverview(c: RequestContext): Promise<Response> {
  await requireUser(c, ["admin"]);
  const repo = new Repo(c.env.DB);
  return json(await repo.adminOverview());
}

export async function facultyReport(c: RequestContext): Promise<Response> {
  await requireUser(c, ["admin"]);
  const repo = new Repo(c.env.DB);
  return json(await repo.facultyReport());
}

export async function updateSiteSettings(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  await requireUser(c, ["admin"]);
  const body = await readJson(c.request, siteSettingsSchema);
  const repo = new Repo(c.env.DB);
  const next = await repo.saveSiteSettings({
    ...body,
    contactEmail: body.contactEmail === "" ? null : body.contactEmail,
  });
  // Public settings are cached in KV; drop the entry so the change is visible.
  c.ctx.waitUntil(invalidateSettingsCache(c.env));
  audit(c, { action: "settings.updated", resource: "site_settings", resourceId: "site" });
  return json(next);
}

export async function listAudit(c: RequestContext): Promise<Response> {
  await requireUser(c, ["admin"]);
  const query = readQuery(c.url, listAuditSchema);
  const repo = new Repo(c.env.DB);
  return json(await repo.listAudit(query));
}
