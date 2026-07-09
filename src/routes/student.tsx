import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { me } from "@/lib/api.functions";
import { AppShell, type NavItem } from "@/components/AppShell";
import { LayoutDashboard, QrCode, History } from "lucide-react";

const nav: NavItem[] = [
  { to: "/student", label: "My Courses", icon: LayoutDashboard },
  { to: "/student/attend", label: "Sign In", icon: QrCode },
  { to: "/student/history", label: "History", icon: History },
];

export const Route = createFileRoute("/student")({
  beforeLoad: async () => {
    const user = await me();
    if (!user) throw redirect({ to: "/login" });
    if (user.role !== "student") throw redirect({ to: user.role === "admin" ? "/admin" : "/lecturer" });
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
