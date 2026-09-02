import { Outlet, createFileRoute } from "@tanstack/react-router";

/** Pathless shell so `/lecturer/sessions` and its `$sessionId` child share a nav entry. */
export const Route = createFileRoute("/lecturer/sessions")({ component: () => <Outlet /> });
