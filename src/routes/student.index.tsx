import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { studentCourses } from "@/lib/api.functions";
import { PageHeader, StatCard } from "@/components/AppShell";
import { Progress } from "@/components/ui/progress";
import { BookOpen, QrCode, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const coursesQO = queryOptions({ queryKey: ["student", "courses"], queryFn: () => studentCourses() });

export const Route = createFileRoute("/student/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(coursesQO),
  component: StudentDashboard,
});

function StudentDashboard() {
  const { data: courses } = useSuspenseQuery(coursesQO);
  const avg = courses.length === 0 ? 0 : Math.round(courses.reduce((a, c) => a + c.percentage, 0) / courses.length);
  const atRisk = courses.filter((c) => c.percentage < 70).length;

  return (
    <>
      <PageHeader
        title="My Courses"
        subtitle="Your live attendance for the semester."
        actions={
          <Link to="/student/attend">
            <Button><QrCode className="mr-2 h-4 w-4" /> Sign in to a lecture</Button>
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Courses" value={courses.length} icon={BookOpen} />
        <StatCard label="Average attendance" value={`${avg}%`} icon={CheckCircle2} hint="Across all courses" />
        <StatCard label="At risk (< 70%)" value={atRisk} icon={AlertTriangle} hint="Below required threshold" />
      </div>

      <h2 className="mt-10 font-display text-lg font-semibold">Course breakdown</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {courses.map((c) => (
          <div key={c.id} className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                <div className="font-display font-semibold">{c.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{c.lecturerName}</div>
              </div>
              <div className={`font-display text-2xl font-semibold ${c.percentage < 70 ? "text-destructive" : "text-primary"}`}>
                {c.percentage}%
              </div>
            </div>
            <div className="mt-4">
              <Progress value={c.percentage} className="h-2" />
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{c.attendedSessions} of {c.totalSessions} sessions</span>
                <span>{c.units} units</span>
              </div>
            </div>
          </div>
        ))}
        {courses.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            You are not enrolled in any courses yet.
          </div>
        )}
      </div>
    </>
  );
}
