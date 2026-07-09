import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { lecturerCourses } from "@/lib/api.functions";
import { PageHeader, StatCard } from "@/components/AppShell";
import { BookOpen, Users, PlayCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const coursesQO = queryOptions({ queryKey: ["lecturer", "courses"], queryFn: () => lecturerCourses() });

export const Route = createFileRoute("/lecturer/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(coursesQO),
  component: LecturerDashboard,
});

function LecturerDashboard() {
  const { data: courses } = useSuspenseQuery(coursesQO);
  const totalStudents = courses.reduce((a, c) => a + c.enrolledStudentIds.length, 0);
  return (
    <>
      <PageHeader
        title={`Welcome back`}
        subtitle="Pick a course to start today's attendance."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="My Courses" value={courses.length} icon={BookOpen} />
        <StatCard label="Total Students" value={totalStudents} icon={Users} />
        <StatCard label="Ready to run" value="Any time" icon={PlayCircle} />
      </div>

      <h2 className="mt-10 font-display text-lg font-semibold">Your courses</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {courses.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            You haven't been assigned to any courses yet.
          </div>
        )}
        {courses.map((c) => (
          <div key={c.id} className="group rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition hover:-translate-y-0.5 hover:shadow-lift">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><BookOpen className="h-5 w-5" /></div>
              <div>
                <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                <div className="font-display font-semibold">{c.title}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>{c.enrolledStudentIds.length} students · Level {c.level}</span>
              <span>{c.units} units</span>
            </div>
            <Link to="/lecturer/courses/$courseId" params={{ courseId: c.id }} className="mt-4 block">
              <Button className="w-full">Open <ArrowRight className="ml-2 h-4 w-4" /></Button>
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
