import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { me } from "@/lib/api.functions";
import { AppShell, type NavItem } from "@/components/AppShell";
import { LayoutDashboard, BookOpen, PlayCircle, Settings } from "lucide-react";

const nav: NavItem[] = [
  { to: "/lecturer", label: "Dashboard", icon: LayoutDashboard },
  { to: "/lecturer/courses", label: "My Courses", icon: BookOpen },
  { to: "/lecturer/sessions", label: "Sessions", icon: PlayCircle },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const Route = createFileRoute("/lecturer")({
  beforeLoad: async () => {
    const user = await me();
    if (!user) throw redirect({ to: "/login" });
    if (user.role !== "lecturer") throw redirect({ to: user.role === "admin" ? "/admin" : "/student" });
    return { user };
  },
  component: LecturerLayout,
});

function LecturerLayout() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell role="Lecturer" userName={user.name} nav={nav}>
      <Outlet />
    </AppShell>
  );
}
