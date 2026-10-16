import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  GraduationCap,
  Percent,
  TrendingDown,
  Users,
  CalendarCheck,
  FileBarChart,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader, StatCard, HealthBadge } from "@/components/AppShell";
import { RouteTransition } from "@/components/RouteTransition";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminOverviewQO, coursesReportQO } from "@/lib/queries";
import { useSiteSettings } from "@/lib/useSiteSettings";
import { cn } from "@/lib/utils";

/**
 * Dashboard (brief §3).
 *
 * Every card is derived from stored records — nothing is a placeholder — and
 * the query refetches on an interval, so a lecture that closes on a lecturer's
 * phone updates the administrator's totals without a manual reload.
 */
export const Route = createFileRoute("/admin/")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(adminOverviewQO);
  },
  component: AdminOverviewPage,
});

function AdminOverviewPage() {
  const { data, isError, error } = useQuery({
    ...adminOverviewQO,
    refetchInterval: 60_000,
  });
  const reportQ = useQuery({
    ...coursesReportQO({ pageSize: 500 }),
    refetchInterval: 60_000,
  });
  const { data: settings } = useSiteSettings();
  const primary = settings?.primaryColor ?? "oklch(0.44 0.11 165)";
  const threshold = reportQ.data?.meta.threshold ?? settings?.atRiskThreshold ?? 75;

  const rows = reportQ.data?.rows ?? [];
  const totals = reportQ.data?.totals;
  const atRisk = rows
    .filter((r) => r.classesHeld > 0 && (r.rate ?? 100) < threshold)
    .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));

  if (isError) {
    return (
      <div className="p-8 text-sm text-destructive">
        Could not load the dashboard. {error instanceof Error ? error.message : ""}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  return (
    <RouteTransition>
      <PageHeader
        title="Dashboard"
        subtitle={`Institution-wide attendance as at ${data.today.label} (${settings?.timezone ?? "Africa/Lagos"}).`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/admin/courses">All Courses</Link>
            </Button>
            <Button asChild>
              <Link to="/admin/reports">
                <FileBarChart className="mr-2 h-4 w-4" /> Reports
              </Link>
            </Button>
          </div>
        }
      />

      {/* The brief's five dashboard cards, all DB-derived */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total Courses"
          value={data.counts.courses}
          icon={BookOpen}
          hint={`${data.counts.departments} departments`}
          formula="Courses in the catalogue that have a lecture or a roster in the active period."
        />
        <StatCard
          label="Total Students"
          value={data.counts.students}
          icon={GraduationCap}
          hint={`${data.counts.lecturers} lecturers / staff`}
        />
        <StatCard
          label="Total Classes Held"
          value={data.counts.sessions}
          icon={CalendarCheck}
          hint="Lectures that have started"
          formula="Counted once a lecture starts; scheduled future lectures are excluded."
        />
        <StatCard
          label="Overall Attendance"
          value={totals?.rate === null || totals?.rate === undefined ? "—" : `${totals.rate}%`}
          icon={Percent}
          formula="Σ (present + late) ÷ Σ expected opportunities across every course. Never the average of course percentages."
          hint={`Target ${threshold}%`}
          trend={
            totals?.rate == null
              ? undefined
              : totals.rate >= threshold
                ? "on target"
                : "below target"
          }
          trendTone={totals?.rate != null && totals.rate >= threshold ? "up" : "down"}
        />
        <StatCard
          label="Students Present Today"
          value={data.today.present + data.today.late}
          icon={Users}
          hint={`${data.today.present} present · ${data.today.late} late · ${data.today.absent} absent`}
          formula="Sign-ins and auto-recorded absences for lectures that started today, in the institution's timezone."
          footer={
            data.today.rate === null ? undefined : (
              <span className="text-xs text-muted-foreground">
                Today's attendance rate:{" "}
                <span className="font-semibold text-foreground">{data.today.rate}%</span> of{" "}
                {data.today.expected} expected
              </span>
            )
          }
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Attendance this week</CardTitle>
            <p className="text-xs text-muted-foreground">
              Sign-ins per day across all courses, excluding auto-recorded absences.
            </p>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.weeklyAttendance}
                margin={{ left: -20, right: 8, top: 8, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="dashboard-week" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={primary} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    fontSize: 12,
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={primary}
                  strokeWidth={2}
                  fill="url(#dashboard-week)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent lectures</CardTitle>
            <Link
              to="/admin/courses"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            <ul className="mt-2 divide-y divide-border/60">
              {data.recentSessions.length === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">No lectures yet</li>
              )}
              {data.recentSessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.courseCode}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.startedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm">
                      {s.attended}/{s.enrolled}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {s.endedAt ? "closed" : "live"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-4 w-4 text-destructive" /> Courses needing attention
            </CardTitle>
            <span className="text-xs text-muted-foreground">below {threshold}%</span>
          </CardHeader>
          <CardContent className="p-0">
            {reportQ.isLoading && <Skeleton className="m-4 h-24" />}
            {!reportQ.isLoading && atRisk.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">
                Every course with lectures held is at or above the {threshold}% target.
              </p>
            )}
            <ul className="divide-y divide-border/60">
              {atRisk.slice(0, 6).map((row) => (
                <li key={row.id}>
                  <Link
                    to="/admin/courses/$courseId"
                    params={{ courseId: row.id }}
                    className="flex items-center justify-between px-6 py-3 transition hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold">{row.code}</div>
                      <div className="truncate text-sm text-muted-foreground">{row.title}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{row.enrolled} students</span>
                      <HealthBadge health={row.health} rate={row.rate} threshold={threshold} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today at a glance</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MiniStat label="Lectures today" value={data.today.classesHeld} />
            <MiniStat label="Present" value={data.today.present} tone="success" />
            <MiniStat label="Late" value={data.today.late} tone="warning" />
            <MiniStat label="Absent" value={data.today.absent} tone="destructive" />
            <MiniStat label="Excused" value={data.today.excused} />
            <MiniStat label="Recorded sign-ins" value={data.counts.attendance} />
          </CardContent>
        </Card>
      </div>
    </RouteTransition>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "destructive";
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 font-display text-xl font-semibold",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}
