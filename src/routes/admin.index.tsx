import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { adminOverview } from "@/lib/api.functions";
import { PageHeader, StatCard } from "@/components/AppShell";
import { GraduationCap, Users, BookOpen, Building2, PlayCircle, ClipboardCheck } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const overviewQO = queryOptions({
  queryKey: ["admin", "overview"],
  queryFn: () => adminOverview(),
});

export const Route = createFileRoute("/admin/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQO),
  component: AdminOverviewPage,
});

function AdminOverviewPage() {
  const { data } = useSuspenseQuery(overviewQO);
  return (
    <>
      <PageHeader title="Overview" subtitle="Faculty-wide attendance at a glance." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Students" value={data.counts.students} icon={GraduationCap} />
        <StatCard label="Lecturers" value={data.counts.lecturers} icon={Users} />
        <StatCard label="Courses" value={data.counts.courses} icon={BookOpen} />
        <StatCard label="Departments" value={data.counts.departments} icon={Building2} />
        <StatCard label="Sessions" value={data.counts.sessions} icon={PlayCircle} />
        <StatCard label="Sign-ins" value={data.counts.attendance} icon={ClipboardCheck} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant lg:col-span-2">
          <h2 className="font-display text-lg font-semibold">Attendance this week</h2>
          <p className="text-xs text-muted-foreground">Sign-ins across all courses (last 7 days)</p>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.weeklyAttendance} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.44 0.11 165)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="oklch(0.44 0.11 165)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.01 165)" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid oklch(0.9 0.01 165)", fontSize: 12 }}
                />
                <Area type="monotone" dataKey="count" stroke="oklch(0.44 0.11 165)" strokeWidth={2} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
          <h2 className="font-display text-lg font-semibold">Recent sessions</h2>
          <ul className="mt-4 divide-y divide-border/60">
            {data.recentSessions.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">No sessions yet</li>
            )}
            {data.recentSessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-medium">{s.courseCode}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.startedAt).toLocaleString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm">{s.attended}/{s.enrolled}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {s.endedAt ? "closed" : "open"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
