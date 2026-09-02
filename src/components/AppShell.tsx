import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { usePublicSettings } from "@/lib/useSiteSettings";
import { GraduationCap, LogOut, Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar } from "./Avatar";
import { AnimatedNumber } from "./AnimatedNumber";

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { data: settings } = usePublicSettings();
  const institution = settings?.institutionName ?? "SLAMS";
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      toast.success("Signed out");
      await navigate({ to: "/login", replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile top bar */}
        <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur lg:hidden">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <GraduationCap className="h-4 w-4" />
            </div>
            <span className="font-display text-base font-semibold">{institution}</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => setOpen((v) => !v)}
              className="rounded-md p-2 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={open ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={open}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

      <div className="flex">
        {/* Dim + close the drawer when the mobile overlay is tapped. */}
        {open && (
          <div
            className="fixed inset-0 z-20 bg-foreground/40 backdrop-blur-sm lg:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
        )}
        <aside
          aria-label="Main navigation"
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
            <div>
              <div className="font-display text-base font-semibold leading-none">{institution}</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{role}</div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {nav.map((n) => {
              const active = pathname === n.to || (n.to !== "/" && pathname.startsWith(n.to));
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                    active
                      ? "bg-primary text-primary-foreground shadow-elegant"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                >
                  <n.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {n.label}
                </Link>
              );
            })}
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
                disabled={signingOut}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        <main id="main-content" className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-3 border-b border-border/60 pb-6 sm:flex-row sm:items-end">
      <div className="relative">
        <div className="absolute -left-3 top-1 h-9 w-1 rounded-full bg-gradient-to-b from-primary to-accent" />
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
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  trend?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition duration-300 hover:-translate-y-0.5 hover:shadow-lift">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/70 via-teal-400/60 to-accent/70 opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</div>
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
          {trend && <span className="font-medium text-success">{trend}</span>}
        </div>
      )}
    </div>
  );
}
