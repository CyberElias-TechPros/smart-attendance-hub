// TanStack Query options shared across routes.
//
// Route `beforeLoad` functions call `queryClient.ensureQueryData(qo)` to
// preload data before the page renders (the SPA equivalent of the old
// TanStack Start `loader`s), and page components then use
// `useSuspenseQuery` for the same data.

import { keepPreviousData, queryOptions, type QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import {
  academics,
  audit,
  auth,
  courses,
  departments,
  faculties,
  notifications,
  reports,
  schedules,
  sessions,
  settings,
  student,
  users,
} from "./api";
import type { ReportFilters, Role, User } from "./types";

export const meQO = queryOptions({
  queryKey: ["me"],
  queryFn: () => auth.me(),
  staleTime: 10_000,
});

export const publicSettingsQO = queryOptions({
  queryKey: ["publicSettings"],
  queryFn: () => settings.public(),
  staleTime: 60_000,
  retry: 1,
});

export const siteSettingsQO = queryOptions({
  queryKey: ["siteSettings"],
  queryFn: () => settings.get(),
  staleTime: 60_000,
});

export const deptsQO = queryOptions({
  queryKey: ["departments"],
  queryFn: () => departments.list(),
});

export const coursesQO = queryOptions({
  queryKey: ["courses"],
  queryFn: () => courses.list(),
});

export const lecturerCoursesQO = queryOptions({
  queryKey: ["lecturer", "courses"],
  queryFn: () => courses.lecturer(),
});

export const unassignedCoursesQO = queryOptions({
  queryKey: ["lecturer", "unassigned-courses"],
  queryFn: () => courses.unassigned(),
});

export const studentCoursesQO = queryOptions({
  queryKey: ["student", "courses"],
  queryFn: () => student.courses(),
});

export const studentHistoryQO = queryOptions({
  queryKey: ["student", "history"],
  queryFn: () => student.history(),
});

export const openSessionsQO = queryOptions({
  queryKey: ["student", "open-sessions"],
  queryFn: () => student.openSessions(),
  staleTime: 5_000,
});

export const courseReportQO = (courseId: string, filters: ReportFilters = {}) =>
  queryOptions({
    queryKey: ["report", courseId, filters],
    queryFn: () => reports.course(courseId, filters),
    enabled: Boolean(courseId),
  });

export const sessionDetailQO = (sessionId: string) =>
  queryOptions({
    queryKey: ["session", sessionId],
    queryFn: () => sessions.detail(sessionId),
    enabled: Boolean(sessionId),
  });

/** A student's history inside one course — loaded only when a row is opened. */
export const courseStudentHistoryQO = (courseId: string, studentId: string) =>
  queryOptions({
    queryKey: ["report", "student", courseId, studentId],
    queryFn: () => reports.courseStudentHistory(courseId, studentId),
    enabled: Boolean(courseId && studentId),
  });

export const adminOverviewQO = queryOptions({
  queryKey: ["admin", "overview"],
  queryFn: () => reports.adminOverview(),
});

export const facultiesQO = queryOptions({
  queryKey: ["faculties"],
  queryFn: () => faculties.list(),
  staleTime: 60_000,
});

export const academicPeriodQO = queryOptions({
  queryKey: ["academics", "period"],
  queryFn: () => academics.period(),
  staleTime: 60_000,
});

/** The All-Courses table (brief §4). Keyed by the full filter object so a
 *  filter change is a cache miss, never a stale table. */
export const coursesReportQO = (filters: ReportFilters) =>
  queryOptions({
    queryKey: ["reports", "courses", filters],
    queryFn: () => reports.courses(filters),
    // Keep the previous page visible while the next one loads: a table that
    // blanks out on every sort click feels broken.
    placeholderData: keepPreviousData,
  });

export const courseSessionsQO = (courseId: string, filters: ReportFilters = {}) =>
  queryOptions({
    queryKey: ["reports", "course-sessions", courseId, filters],
    queryFn: () => reports.courseSessions(courseId, filters),
    enabled: Boolean(courseId),
  });

export const auditQO = (query: Record<string, string | number | undefined> = {}) =>
  queryOptions({
    queryKey: ["audit", query],
    queryFn: () => audit.list(query as Parameters<typeof audit.list>[0]),
  });

// ─── Notifications (plan §4.5 / P4.5) ───────────────────────────────────────

export const schedulesQO = queryOptions({
  queryKey: ["schedules"],
  queryFn: () => schedules.list(),
});

export const sessionRegisterQO = (filters: ReportFilters = {}) =>
  queryOptions({
    queryKey: ["reports", "sessions", filters],
    queryFn: () => reports.sessions(filters),
    placeholderData: keepPreviousData,
  });

export const notificationsQO = (opts: { page?: number; unreadOnly?: boolean } = {}) =>
  queryOptions({
    queryKey: ["notifications", opts],
    queryFn: () => notifications.list(opts),
    placeholderData: keepPreviousData,
  });

/**
 * Unread badge. Polled rather than pushed: at this scale one cheap COUNT every
 * 30 s costs far less than a socket per tab, and the badge is allowed to be
 * half a minute stale. `refetchIntervalInBackground: false` keeps a forgotten
 * tab quiet.
 */
export const notificationSummaryQO = queryOptions({
  queryKey: ["notifications", "summary"],
  queryFn: () => notifications.summary(),
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  staleTime: 15_000,
});

export const usersQO = (role?: Role) =>
  queryOptions({
    queryKey: ["users", role ?? "all"],
    queryFn: () => users.list(role),
  });

// ─── Guards ─────────────────────────────────────────────────────────────────

export function roleHome(role: Role): string {
  return role === "admin" ? "/admin" : role === "lecturer" ? "/lecturer" : "/student";
}

/** Load the current user (fresh from the API) and redirect if absent. */
export async function loadCurrentUser(context: { queryClient: QueryClient }): Promise<User | null> {
  try {
    return await context.queryClient.ensureQueryData(meQO);
  } catch {
    return null;
  }
}

/** beforeLoad guard: requires the given role, otherwise redirects. */
export async function requireRole(
  context: { queryClient: QueryClient },
  role: Role,
): Promise<User> {
  const user = await loadCurrentUser(context);
  if (!user) throw redirect({ to: "/login" });
  if (user.role !== role) throw redirect({ to: roleHome(user.role) });
  return user;
}
