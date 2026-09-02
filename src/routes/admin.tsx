import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import {
  Building2,
  BookOpen,
  FileBarChart,
  GraduationCap,
  LayoutDashboard,
  ScrollText,
  Settings,
  Settings2,
  Users,
} from "lucide-react";

import { AppShell, type NavItem } from "@/components/AppShell";

const nav: NavItem[] = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/students", label: "Students", icon: GraduationCap },
  { to: "/admin/lecturers", label: "Lecturers", icon: Users },
  { to: "/admin/departments", label: "Departments", icon: Building2 },
  { to: "/admin/courses", label: "Courses", icon: BookOpen },
  { to: "/admin/reports", label: "Reports", icon: FileBarChart },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText },
  { to: "/admin/settings", label: "Branding", icon: Settings2 },
  { to: "/settings", label: "My account", icon: Settings },
];

export const Route = createFileRoute("/admin")({
  // Guard is presentational: it decides what to render, while the Worker
  // independently rejects any request from a non-admin.
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    if (context.auth.user!.role !== "admin") {
      throw redirect({ to: context.auth.user!.role === "lecturer" ? "/lecturer" : "/student" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { auth } = Route.useRouteContext();
  return (
    <AppShell role="Administrator" userName={auth.user!.name} nav={nav}>
      <Outlet />
    </AppShell>
  );
}
