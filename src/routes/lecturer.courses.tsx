import { Outlet, createFileRoute } from "@tanstack/react-router";

/** Pathless shell so `/lecturer/courses` and its `$courseId` child share a nav entry. */
export const Route = createFileRoute("/lecturer/courses")({ component: () => <Outlet /> });
