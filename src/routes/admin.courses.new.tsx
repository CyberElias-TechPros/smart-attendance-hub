import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * "Add Course" in the sidebar.
 *
 * Course creation is a dialog on the manage screen (with the roster, lecturer
 * and venue controls that a course needs). Rather than duplicate that form —
 * two copies of a ten-field form is how the two quietly drift apart — this
 * destination opens the manage screen with the form already open.
 */
export const Route = createFileRoute("/admin/courses/new")({
  component: () => <Navigate to="/admin/courses/manage" search={{ new: "1" }} replace />,
});
