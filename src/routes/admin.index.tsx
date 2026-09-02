import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BookOpen,
  Building2,
  ClipboardCheck,
  GraduationCap,
  PlayCircle,
  Radio,
  Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { PageHeader, StatCard } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { usePublicSettings } from "@/lib/useSiteSettings";

export const Route = createFileRoute("/admin/")({ component: AdminOverviewPage });

function AdminOverviewPage() {
  const query = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.adminOverview(),
    // The overview shows live session counts, so keep it reasonably fresh.
    refetchInterval: 60_000,
  });
  const { data: settings } = usePublicSettings();
  const primary = settings?.primaryColor ?? "oklch(0.44 0.11 165)";

  return (
    <RouteTransition>
      <PageHeader title="Overview" subtitle="Faculty-wide attendance at a glance." />
      <QueryBoundary
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        onRetry={() => query.refetch()}
        loadingLabel="Loading overview"
      >
        {(data) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Students" value={data.counts.students} icon={GraduationCap} />
              <StatCard label="Lecturers" value={data.counts.lecturers} icon={Users} />
              <StatCard label="Courses" value={data.counts.courses} icon={BookOpen} />
              <StatCard label="Departments" value={data.counts.departments} icon={Building2} />
              <StatCard label="Sessions" value={data.counts.sessions} icon={PlayCircle} />
              <StatCard label="Sign-ins" value={data.counts.attendance} icon={ClipboardCheck} />
            </div>

            {data.counts.liveSessions > 0 && (
              <div className="mt-6 flex items-center gap-3 rounded-2xl border border-success/40 bg-success/5 px-5 py-4">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                </span>
                <Radio className="h-4 w-4 text-success" aria-hidden />
                <p className="text-sm font-medium">
                  {data.counts.liveSessions} live{" "}
                  {data.counts.liveSessions === 1 ? "session is" : "sessions are"} running right now.
                </p>
              </div>
            )}

            <div className="mt-8 grid gap-6 lg:grid-cols-3">
              <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant lg:col-span-2">
                <h2 className="font-display text-lg font-semibold">Attendance this week</h2>
                <p className="text-xs text-muted-foreground">
                  Sign-ins across all courses (last 7 days)
                </p>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data.weeklyAttendance}
                      margin={{ left: -20, right: 8, top: 8, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={primary} stopOpacity={0.5} />
                          <stop offset="100%" stopColor={primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.01 165)" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid oklch(0.9 0.01 165)",
                          fontSize: 12,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="Sign-ins"
                        stroke={primary}
                        strokeWidth={2}
                        fill="url(#attendanceFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
                <h2 className="font-display text-lg font-semibold">Recent sessions</h2>
                {data.recentSessions.length === 0 ? (
                  <EmptyState
                    className="mt-4 border-0 px-2 py-8"
                    icon={<PlayCircle className="h-6 w-6" />}
                    title="No sessions yet"
                    description="Sessions appear here once lecturers start taking attendance."
                  />
                ) : (
                  <ul className="mt-4 space-y-3">
                    {data.recentSessions.map((session) => {
                      const rate =
                        session.enrolled === 0
                          ? 0
                          : Math.round((session.attended / session.enrolled) * 100);
                      return (
                        <li
                          key={session.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{session.courseCode}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(session.startedAt).toLocaleString()}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {!session.endedAt && (
                              <Badge variant="secondary" className="bg-success/15 text-success">
                                Live
                              </Badge>
                            )}
                            <span className="font-mono text-sm">
                              {session.attended}/{session.enrolled}
                            </span>
                            <span className="text-xs text-muted-foreground">{rate}%</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Link
                  to="/admin/reports"
                  className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
                >
                  View full reports →
                </Link>
              </div>
            </div>
          </>
        )}
      </QueryBoundary>
    </RouteTransition>
  );
}
