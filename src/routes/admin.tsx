import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { me } from "@/lib/api.functions";
import { AppShell, type NavItem } from "@/components/AppShell";
import { LayoutDashboard, GraduationCap, Users, Building2, BookOpen, FileBarChart, Settings, Settings2 } from "lucide-react";

const nav: NavItem[] = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/students", label: "Students", icon: GraduationCap },
  { to: "/admin/lecturers", label: "Lecturers", icon: Users },
  { to: "/admin/departments", label: "Departments", icon: Building2 },
  { to: "/admin/courses", label: "Courses", icon: BookOpen },
  { to: "/admin/reports", label: "Reports", icon: FileBarChart },
  { to: "/admin/settings", label: "Branding", icon: Settings2 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const user = await me();
    if (!user) throw redirect({ to: "/login" });
    if (user.role !== "admin") throw redirect({ to: user.role === "lecturer" ? "/lecturer" : "/student" });
    return { user };
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell role="Administrator" userName={user.name} nav={nav}>
      <Outlet />
    </AppShell>
  );
}

