import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { BookOpen, LayoutDashboard, PlayCircle, Settings } from "lucide-react";

import { AppShell, type NavItem } from "@/components/AppShell";

const nav: NavItem[] = [
  { to: "/lecturer", label: "Dashboard", icon: LayoutDashboard },
  { to: "/lecturer/courses", label: "My courses", icon: BookOpen },
  { to: "/lecturer/sessions", label: "Sessions", icon: PlayCircle },
  { to: "/settings", label: "My account", icon: Settings },
];

export const Route = createFileRoute("/lecturer")({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    if (context.auth.user!.role !== "lecturer") {
      throw redirect({ to: context.auth.user!.role === "admin" ? "/admin" : "/student" });
    }
  },
  component: LecturerLayout,
});

function LecturerLayout() {
  const { auth } = Route.useRouteContext();
  return (
    <AppShell role="Lecturer" userName={auth.user!.name} nav={nav}>
      <Outlet />
    </AppShell>
  );
}
