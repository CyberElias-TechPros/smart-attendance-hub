import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole } from "@/lib/queries";
import { AppShell, type NavItem } from "@/components/AppShell";
import { LayoutDashboard, BookOpen, PlayCircle, Settings } from "lucide-react";

const nav: NavItem[] = [
  { to: "/lecturer", label: "Dashboard", icon: LayoutDashboard },
  { to: "/lecturer/courses", label: "My Courses", icon: BookOpen },
  { to: "/lecturer/sessions", label: "Sessions", icon: PlayCircle },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const Route = createFileRoute("/lecturer")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Lecturer — SLAMS" }],
  }),
  beforeLoad: async ({ context }) => {
    const user = await requireRole(context, "lecturer");
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
