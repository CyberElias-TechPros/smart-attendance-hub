// TanStack Query options shared across routes.
//
// Route `beforeLoad` functions call `queryClient.ensureQueryData(qo)` to
// preload data before the page renders (the SPA equivalent of the old
// TanStack Start `loader`s), and page components then use
// `useSuspenseQuery` for the same data.

import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { auth, courses, departments, reports, sessions, settings, student, users } from "./api";
import type { Role, User } from "./types";

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

export const courseReportQO = (courseId: string) =>
  queryOptions({
    queryKey: ["report", courseId],
    queryFn: () => reports.course(courseId),
    enabled: Boolean(courseId),
  });

export const adminOverviewQO = queryOptions({
  queryKey: ["admin", "overview"],
  queryFn: () => reports.adminOverview(),
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
