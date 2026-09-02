import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { History, LayoutDashboard, QrCode, Settings } from "lucide-react";

import { AppShell, type NavItem } from "@/components/AppShell";

const nav: NavItem[] = [
  { to: "/student", label: "My courses", icon: LayoutDashboard },
  { to: "/student/attend", label: "Sign in", icon: QrCode },
  { to: "/student/history", label: "History", icon: History },
  { to: "/settings", label: "My account", icon: Settings },
];

export const Route = createFileRoute("/student")({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    if (context.auth.user!.role !== "student") {
      throw redirect({ to: context.auth.user!.role === "admin" ? "/admin" : "/lecturer" });
    }
  },
  component: StudentLayout,
});

function StudentLayout() {
  const { auth } = Route.useRouteContext();
  return (
    <AppShell role="Student" userName={auth.user!.name} nav={nav}>
      <Outlet />
    </AppShell>
  );
}
