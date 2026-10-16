import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/attendance")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/admin/attendance"!</div>;
}
