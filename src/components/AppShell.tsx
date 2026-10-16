import { Link, useRouterState, useRouter, useNavigate } from "@tanstack/react-router";
import { auth, clearToken } from "@/lib/api";
import { Bell, ChevronDown, GraduationCap, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "./Avatar";
import { AnimatedNumber } from "./AnimatedNumber";
import { CommandPalette, PaletteTrigger, type PaletteNavItem } from "./CommandPalette";
import { PeriodSelector } from "./PeriodSelector";
import { useQuery } from "@tanstack/react-query";
import { notificationSummaryQO } from "@/lib/queries";
import { useSiteSettings } from "@/lib/useSiteSettings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** A single destination, or a group ("Courses") that expands (brief §2A). */
export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Present = an expandable group. Clicking the parent opens the first child. */
  children?: NavItem[];
  /** Hide on small screens (used for sub-items that live in a drawer). */
  hideOnMobile?: boolean;
  /** Match the path exactly — needed when a sibling child is a prefix of this
   *  one (e.g. "All Courses" at /admin/courses vs /admin/courses/manage). */
  exact?: boolean;
}

/** Flatten groups for the command palette and for "which section am I in?". */
function flattenNav(nav: NavItem[]): NavItem[] {
  return nav.flatMap((n) => (n.children?.length ? [n, ...flattenNav(n.children)] : [n]));
}

function isActivePath(pathname: string, to: string, exact = false): boolean {
  if (to === "/" || exact) return pathname === to || pathname === `${to}/`;
  return pathname === to || pathname.startsWith(`${to}/`);
}

const GROUP_STORAGE_KEY = "slams.nav.expanded";

function readExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(GROUP_STORAGE_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function AppShell({
  role,
  userName,
  nav,
  children,
}: {
  role: string;
  userName: string;
  nav: NavItem[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => readExpanded());
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const router = useRouter();
  const navigate = useNavigate();
  const { data: settings } = useSiteSettings();

  const isAdmin = role.toLowerCase().startsWith("admin");
  const institutionName = settings?.institutionName ?? "SLAMS";
  // Unread badge: a polled COUNT, not a socket per tab (see notificationSummaryQO).
  const { data: unreadData } = useQuery({ ...notificationSummaryQO, enabled: isAdmin });
  const unread = unreadData?.unread ?? 0;

  // A group is open if the user opened it, or if the current route lives inside
  // it — so a deep link (or the palette) leaves the sidebar in a sensible state.
  useEffect(() => {
    setExpanded((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of nav) {
        if (
          item.children?.length &&
          item.children.some((c) => isActivePath(pathname, c.to, c.exact))
        ) {
          if (!next[item.to]) {
            next[item.to] = true;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [pathname, nav]);

  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode: expansion just won't persist */
      }
      return next;
    });

  const paletteNav: PaletteNavItem[] = useMemo(
    () =>
      flattenNav(nav).map((n) => ({
        to: n.to,
        label: n.label,
        icon: n.icon,
      })),
    [nav],
  );

  const handleLogout = async () => {
    // Server call is best-effort (stateless tokens); the client drops its token
    // regardless so the UI signs out immediately.
    try {
      await auth.logout();
    } catch {
      /* ignore network failures on logout */
    }
    clearToken();
    router.invalidate();
    toast.success("Signed out");
    navigate({ to: "/login", replace: true });
  };

  const renderLink = (n: NavItem, depth = 0) => {
    const active = isActivePath(pathname, n.to, n.exact);
    return (
      <Link
        key={n.to}
        to={n.to}
        onClick={() => setOpen(false)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
          depth > 0 && "ml-3 py-1.5 text-[13px]",
          active
            ? "bg-primary text-primary-foreground shadow-elegant"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
          n.hideOnMobile && "hidden lg:flex",
        )}
      >
        <n.icon className={cn(depth > 0 ? "h-3.5 w-3.5" : "h-4 w-4")} />
        {n.label}
      </Link>
    );
  };

  const renderGroup = (n: NavItem) => {
    const children = n.children ?? [];
    const active =
      isActivePath(pathname, n.to) || children.some((c) => isActivePath(pathname, c.to));
    const isOpen = expanded[n.to] ?? false;
    return (
      <div key={n.to}>
        <div className="flex items-stretch gap-1">
          {/* The label navigates to the group's landing page — the brief's
              "clicking Courses opens All Courses" behaviour. */}
          <Link
            to={n.to}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
              active
                ? "bg-primary text-primary-foreground shadow-elegant"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            <n.icon className="h-4 w-4" />
            {n.label}
          </Link>
          <button
            type="button"
            onClick={() => toggleGroup(n.to)}
            aria-expanded={isOpen}
            aria-controls={`nav-group-${n.to.replace(/\W+/g, "-")}`}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${n.label}`}
            className={cn(
              "grid w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-sidebar-accent",
              active && "text-primary",
            )}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition", isOpen && "rotate-180")} />
          </button>
        </div>
        {isOpen && (
          <div id={`nav-group-${n.to.replace(/\W+/g, "-")}`} className="mt-1 space-y-1">
            {children.map((c) => renderLink(c, 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <GraduationCap className="h-4 w-4" />
          </div>
          <span className="font-display text-base font-semibold">{institutionName}</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPaletteOpen(true)}
            className="rounded-md p-2 hover:bg-accent/40"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </button>
          <ThemeToggle />
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-md p-2 hover:bg-accent/40"
            aria-label="menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <div className="flex">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-border/60 bg-sidebar transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="relative hidden h-20 items-center gap-3 border-b border-border/60 px-6 lg:flex">
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary-gradient text-primary-foreground shadow-glow">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-display text-base font-semibold leading-none">
                {institutionName}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {role}
              </div>
            </div>
          </div>
          <div className="px-3 pt-3">
            <PaletteTrigger onClick={() => setPaletteOpen(true)} />
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {nav.map((n) => (n.children?.length ? renderGroup(n) : renderLink(n)))}
          </nav>
          <div className="border-t border-border/60 p-4">
            <div className="flex items-center gap-3">
              <Avatar name={userName} seed={userName} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{userName}</div>
                <div className="text-xs capitalize text-muted-foreground">{role}</div>
              </div>
              <ThemeToggle />
              <button
                onClick={handleLogout}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {/* Top bar: institution, search, reporting period, notifications,
              account menu (brief §2B). */}
          <div className="sticky top-0 z-20 hidden h-16 items-center justify-between gap-4 border-b border-border/60 bg-background/85 px-6 backdrop-blur lg:flex">
            <div className="flex min-w-0 items-center gap-3">
              <span className="truncate font-display text-base font-semibold">
                {institutionName}
              </span>
              <span className="hidden rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground xl:inline">
                {role}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPaletteOpen(true)}
                className="flex w-64 items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-1.5 text-left text-xs text-muted-foreground transition hover:border-primary/40 xl:w-80"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="flex-1 truncate">Search courses, students, staff…</span>
                <kbd className="rounded border border-border/70 px-1 font-mono text-[10px]">⌘K</kbd>
              </button>
              <PeriodSelector canEdit={isAdmin} />
              <Link
                to={isAdmin ? "/admin/notifications" : "/settings"}
                className="relative grid h-9 w-9 place-items-center rounded-lg border border-border/70 bg-card/60 text-muted-foreground transition hover:text-foreground"
                aria-label={
                  unread > 0 ? `Notifications, ${unread} unread` : "Notifications, nothing unread"
                }
              >
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 py-1 pl-1 pr-2 transition hover:border-primary/40"
                    aria-label="Account menu"
                  >
                    <Avatar name={userName} seed={userName} size="sm" />
                    <span className="hidden max-w-[10rem] truncate text-xs font-medium xl:inline">
                      {userName}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="flex flex-col">
                    <span className="text-sm font-semibold">{userName}</span>
                    <span className="text-xs capitalize text-muted-foreground">{role}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center gap-2">
                      <Settings className="h-4 w-4" /> Account settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void handleLogout()} className="gap-2">
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="mx-auto max-w-[100rem] px-4 py-6 sm:px-8 sm:py-8">{children}</div>
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        nav={paletteNav}
        onLogout={() => void handleLogout()}
      />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-3 border-b border-border/60 pb-6 sm:flex-row sm:items-end">
      <div className="relative">
        <div className="absolute -left-3 top-1 h-9 w-1 rounded-full bg-gradient-to-b from-primary to-accent" />
        {breadcrumb && <div className="mb-2">{breadcrumb}</div>}
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  trendTone = "up",
  formula,
  footer,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  trend?: string;
  trendTone?: "up" | "down" | "flat";
  /** Plain-language explanation of the figure, shown on hover. Always present
   *  for computed numbers: an administrator should be able to see exactly what
   *  a percentage means without reading the code (brief §3). */
  formula?: string;
  footer?: ReactNode;
}) {
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition duration-300 hover:-translate-y-0.5 hover:shadow-lift"
      title={formula}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/70 via-teal-400/60 to-accent/70 opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        {Icon && (
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="mt-3 font-display text-3xl font-semibold tracking-tight">
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </div>
      {(hint || trend) && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          {hint && <span className="text-muted-foreground">{hint}</span>}
          {trend && (
            <span
              className={cn(
                "font-medium",
                trendTone === "up" && "text-success",
                trendTone === "down" && "text-destructive",
                trendTone === "flat" && "text-muted-foreground",
              )}
            >
              {trend}
            </span>
          )}
        </div>
      )}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

/** Small coloured chip used for attendance health everywhere (never colour
 *  alone — the label is always rendered too, for WCAG AA). */
export function HealthBadge({
  health,
  rate,
  threshold,
}: {
  health: "good" | "watch" | "at-risk" | "critical" | null;
  rate: number | null;
  threshold?: number;
}) {
  const label = rate === null ? "—" : `${rate}%`;
  const tone =
    health === "good"
      ? "bg-success/15 text-success"
      : health === "watch"
        ? "bg-warning/15 text-warning"
        : health === "at-risk" || health === "critical"
          ? "bg-destructive/12 text-destructive"
          : "bg-muted text-muted-foreground";
  const name =
    health === "good"
      ? "On track"
      : health === "watch"
        ? "Watch"
        : health === "at-risk"
          ? "At risk"
          : health === "critical"
            ? "Critical"
            : "No lectures yet";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        tone,
      )}
      title={threshold ? `${name} (target ${threshold}%)` : name}
    >
      <span className="font-mono">{label}</span>
    </span>
  );
}
