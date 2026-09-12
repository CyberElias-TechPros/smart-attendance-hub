import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/queries";
import { AppShell, type NavItem } from "@/components/AppShell";
import { LayoutDashboard, QrCode, History, Settings } from "lucide-react";

const nav: NavItem[] = [
  { to: "/student", label: "My Courses", icon: LayoutDashboard },
  { to: "/student/attend", label: "Sign In", icon: QrCode },
  { to: "/student/history", label: "History", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const Route = createFileRoute("/student")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Student — SLAMS" }],
  }),
  beforeLoad: async ({ context }) => {
    const user = await requireRole(context, "student");
    return { user };
  },
  component: StudentLayout,
});

function StudentLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell role="Student" userName={user.name} nav={nav}>
      <Outlet />
    </AppShell>
  );
}
