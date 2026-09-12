import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/queries";
import { AppShell, type NavItem } from "@/components/AppShell";
import {
  LayoutDashboard,
  GraduationCap,
  Users,
  Building2,
  BookOpen,
  FileBarChart,
  Settings,
  Settings2,
} from "lucide-react";

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
  beforeLoad: async ({ context }) => {
    const user = await requireRole(context, "admin");
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
