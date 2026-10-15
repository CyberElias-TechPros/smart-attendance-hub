import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/timetable")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/admin/timetable"!</div>;
}
