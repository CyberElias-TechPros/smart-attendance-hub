import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/queries";
import { AppShell, type NavItem } from "@/components/AppShell";
import {
  Bell,
  CalendarCheck,
  CalendarClock,
  CirclePlus,
  LayoutDashboard,
  GraduationCap,
  History,
  Users,
  Building2,
  BookOpen,
  FileBarChart,
  Landmark,
  ListTree,
  ScrollText,
  Settings,
  Settings2,
  Tags,
} from "lucide-react";

// The brief's sidebar. "Courses" is the expandable group: clicking the label
// opens its landing page (All Courses) while the caret toggles the children.
const nav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/students", label: "Students", icon: GraduationCap },
  { to: "/admin/lecturers", label: "Lecturers / Staff", icon: Users },
  { to: "/admin/departments", label: "Departments", icon: Building2 },
  { to: "/admin/faculties", label: "Faculties", icon: Landmark },
  {
    to: "/admin/courses",
    label: "Courses",
    icon: BookOpen,
    children: [
      { to: "/admin/courses", label: "All Courses", icon: ScrollText, exact: true },
      { to: "/admin/courses/manage", label: "Add Course", icon: CirclePlus },
      { to: "/admin/courses/categories", label: "Course Categories", icon: Tags },
    ],
  },
  { to: "/admin/timetable", label: "Timetable", icon: CalendarClock },
  { to: "/admin/attendance", label: "Attendance", icon: CalendarCheck },
  { to: "/admin/notifications", label: "Notifications", icon: Bell },
  { to: "/admin/reports", label: "Reports", icon: FileBarChart },
  { to: "/admin/audit", label: "Audit trail", icon: History },
  { to: "/admin/settings", label: "Branding", icon: Settings2 },
  { to: "/settings", label: "Settings", icon: Settings },
];
void ListTree;

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Admin — SLAMS" }],
  }),
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
