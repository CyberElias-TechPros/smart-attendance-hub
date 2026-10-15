import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Courses section layout (brief §2A).
 *
 * The sidebar's "Courses" group has three destinations:
 *   /admin/courses             → All Courses attendance table (the section's home)
 *   /admin/courses/manage      → create / edit courses, rosters, lecturers
 *   /admin/courses/categories  → catalogue grouping
 * plus /admin/courses/$courseId for a single course's attendance report.
 *
 * This layout exists so those four share one nesting level: the sidebar can
 * highlight the group, and deep links keep the parent section active.
 */
export const Route = createFileRoute("/admin/courses")({
  component: () => <Outlet />,
});
