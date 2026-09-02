// SLAMS API — Cloudflare Worker entry point.
//
// Runs on the Workers runtime with no Node built-ins: password hashing and JWT
// signing use Web Crypto, and all state lives in D1 (relational), KV (cache and
// rate-limit counters) and R2 (generated exports).

import { ApiError, toErrorBody } from "./lib/errors";
import { loadClaims, type Env, type RequestContext } from "./lib/context";
import { clientIp, corsHeaders, json, securityHeaders } from "./lib/http";
import { Repo } from "./lib/repo";
import * as auth from "./routes/auth";
import * as admin from "./routes/admin";
import * as teaching from "./routes/teaching";
import * as pub from "./routes/public";

type Handler = (c: RequestContext, ...params: string[]) => Promise<Response>;

interface RouteDef {
  method: string;
  /** Path pattern with `:param` segments, e.g. "/api/sessions/:id". */
  pattern: string;
  handler: Handler;
}

const routes: RouteDef[] = [
  // Public
  { method: "GET", pattern: "/api/health", handler: pub.health },
  { method: "GET", pattern: "/api/public/settings", handler: pub.publicSettings },

  // Auth
  { method: "POST", pattern: "/api/auth/login", handler: auth.handleLogin },
  { method: "POST", pattern: "/api/auth/logout", handler: auth.handleLogout },
  { method: "GET", pattern: "/api/auth/me", handler: auth.handleMe },
  { method: "POST", pattern: "/api/auth/password", handler: auth.handleChangePassword },
  { method: "POST", pattern: "/api/auth/profile", handler: auth.handleUpdateProfile },

  // Reference data (any signed-in user)
  { method: "GET", pattern: "/api/departments", handler: withAuth(pub.listDepartments) },
  { method: "GET", pattern: "/api/courses", handler: withAuth(pub.listCourses) },

  // Admin — people
  { method: "GET", pattern: "/api/admin/users", handler: admin.listUsers },
  { method: "GET", pattern: "/api/admin/students/options", handler: admin.listStudentOptions },
  { method: "GET", pattern: "/api/admin/lecturers/options", handler: admin.listLecturerOptions },
  { method: "POST", pattern: "/api/admin/students", handler: admin.createStudent },
  { method: "POST", pattern: "/api/admin/students/update", handler: admin.updateStudent },
  { method: "POST", pattern: "/api/admin/lecturers", handler: admin.createLecturer },
  { method: "POST", pattern: "/api/admin/lecturers/update", handler: admin.updateLecturer },
  { method: "DELETE", pattern: "/api/admin/users/:id", handler: admin.deleteUser },

  // Admin — structure
  { method: "POST", pattern: "/api/admin/departments", handler: admin.createDepartment },
  { method: "PATCH", pattern: "/api/admin/departments/:id", handler: admin.updateDepartment },
  { method: "DELETE", pattern: "/api/admin/departments/:id", handler: admin.deleteDepartment },
  { method: "POST", pattern: "/api/admin/courses", handler: admin.createCourse },
  { method: "POST", pattern: "/api/admin/courses/update", handler: admin.updateCourse },
  { method: "DELETE", pattern: "/api/admin/courses/:id", handler: admin.deleteCourse },
  { method: "PATCH", pattern: "/api/admin/courses/:id/archive", handler: admin.setCourseArchived },
  { method: "POST", pattern: "/api/admin/courses/assign-lecturer", handler: admin.assignLecturer },
  { method: "POST", pattern: "/api/admin/courses/enroll", handler: admin.enrollStudents },

  // Admin — insight
  { method: "GET", pattern: "/api/admin/overview", handler: admin.adminOverview },
  { method: "GET", pattern: "/api/admin/reports/faculty", handler: admin.facultyReport },
  { method: "GET", pattern: "/api/admin/audit", handler: admin.listAudit },
  { method: "POST", pattern: "/api/admin/settings", handler: admin.updateSiteSettings },

  // Lecturer
  { method: "GET", pattern: "/api/lecturer/overview", handler: teaching.lecturerOverview },
  { method: "GET", pattern: "/api/lecturer/courses", handler: teaching.lecturerCourses },
  { method: "GET", pattern: "/api/lecturer/sessions", handler: teaching.lecturerSessions },
  { method: "GET", pattern: "/api/courses/:id/detail", handler: teaching.courseDetail },
  { method: "GET", pattern: "/api/courses/:id/sessions", handler: teaching.courseSessions },
  { method: "GET", pattern: "/api/courses/:id/report", handler: teaching.courseReport },
  { method: "POST", pattern: "/api/sessions", handler: teaching.startSession },
  { method: "GET", pattern: "/api/sessions/:id", handler: teaching.sessionDetail },
  { method: "POST", pattern: "/api/sessions/:id/end", handler: teaching.endSession },
  { method: "POST", pattern: "/api/sessions/:id/extend", handler: teaching.extendSession },
  { method: "POST", pattern: "/api/attendance/mark", handler: teaching.markAttendance },
  { method: "DELETE", pattern: "/api/attendance/:id", handler: teaching.deleteAttendanceRecord },

  // Student
  { method: "GET", pattern: "/api/student/courses", handler: teaching.studentCourses },
  { method: "GET", pattern: "/api/student/courses/:id", handler: teaching.studentCourseDetail },
  { method: "GET", pattern: "/api/student/history", handler: teaching.studentHistory },
  { method: "GET", pattern: "/api/student/open-sessions", handler: teaching.studentOpenSessions },
  { method: "POST", pattern: "/api/student/attendance", handler: teaching.submitAttendance },
];

/** Wraps a handler so it requires any authenticated user. */
function withAuth(handler: Handler): Handler {
  return async (c, ...params) => {
    const { requireUser } = await import("./lib/context");
    await requireUser(c);
    return handler(c, ...params);
  };
}

interface MatchResult {
  route: RouteDef;
  params: string[];
}

function matchRoute(method: string, pathname: string): MatchResult | "method_mismatch" | null {
  const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  let pathMatched = false;
  for (const route of routes) {
    const patternSegments = route.pattern.split("/").filter(Boolean);
    if (patternSegments.length !== segments.length) continue;
    const params: string[] = [];
    let ok = true;
    for (let i = 0; i < patternSegments.length; i++) {
      const p = patternSegments[i];
      if (p.startsWith(":")) {
        if (!segments[i]) {
          ok = false;
          break;
        }
        params.push(decodeURIComponent(segments[i]));
      } else if (p !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  return pathMatched ? "method_mismatch" : null;
}

function makeLogger(requestId: string, url: URL, method: string) {
  return (event: string, data: Record<string, unknown> = {}) => {
    // Structured single-line JSON so Workers Logs / Logpush stay queryable.
    console.log(
      JSON.stringify({
        level: "info",
        event,
        requestId,
        method,
        path: url.pathname,
        ...data,
      }),
    );
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();
    const started = Date.now();
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const finish = (response: Response, extra?: Headers): Response => {
      const headers = new Headers(response.headers);
      cors.forEach((value, key) => headers.set(key, value));
      for (const [key, value] of Object.entries(securityHeaders())) headers.set(key, value);
      extra?.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") headers.append(key, value);
        else headers.set(key, value);
      });
      headers.set("x-request-id", requestId);
      return new Response(response.body, { status: response.status, headers });
    };

    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      // Fail closed: a missing/short signing secret means forgeable sessions.
      console.error(JSON.stringify({ level: "error", event: "missing_session_secret", requestId }));
      return finish(
        json(
          {
            error: {
              code: "INTERNAL_ERROR",
              message: "The server is not configured correctly.",
              requestId,
            },
          },
          { status: 500 },
        ),
      );
    }

    const responseHeaders = new Headers();
    const log = makeLogger(requestId, url, request.method);

    try {
      const match = matchRoute(request.method, url.pathname);
      if (match === null) {
        return finish(
          json(
            { error: { code: "NOT_FOUND", message: "Unknown endpoint.", requestId } },
            { status: 404 },
          ),
        );
      }
      if (match === "method_mismatch") {
        return finish(
          json(
            {
              error: {
                code: "NOT_FOUND",
                message: `${request.method} is not supported here.`,
                requestId,
              },
            },
            { status: 405 },
          ),
        );
      }

      const claims = await loadClaims(request, env);
      const c: RequestContext = {
        env,
        requestId,
        url,
        request,
        ctx,
        claims,
        responseHeaders,
        clientIp: clientIp(request),
        log,
      };

      const response = await match.route.handler(c, ...match.params);
      log("request", {
        status: response.status,
        durationMs: Date.now() - started,
        userId: claims?.sub,
      });
      return finish(response, responseHeaders);
    } catch (error) {
      const { status, body } = toErrorBody(error, requestId);
      if (!(error instanceof ApiError) && status >= 500) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "unhandled_error",
            requestId,
            path: url.pathname,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }),
        );
      } else {
        log("handled_error", { status, code: body.error.code });
      }
      return finish(json(body, { status }), responseHeaders);
    }
  },

  /**
   * Scheduled maintenance. Sessions whose window elapsed are closed so reports
   * and "live session" counters stay accurate even if a lecturer never pressed
   * End, and audit entries are pruned to a 180-day retention window.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const repo = new Repo(env.DB);
        const closed = await repo.closeExpiredSessions();
        const pruned = await repo.pruneAudit(180);
        console.log(JSON.stringify({ level: "info", event: "cron_maintenance", closed, pruned }));
      })(),
    );
  },
};
