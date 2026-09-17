import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { lecturerCoursesQO, unassignedCoursesQO } from "@/lib/queries";
import { PageHeader, StatCard } from "@/components/AppShell";
import { BookOpen, Users, PlayCircle, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CourseGlyph } from "@/lib/courseIcons";
import { RouteTransition } from "@/components/RouteTransition";
import { EmptyState } from "@/components/EmptyState";
import { courses as coursesApi } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/lecturer/")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(lecturerCoursesQO);
  },
  component: LecturerDashboard,
});

function LecturerDashboard() {
  const { data: courses } = useSuspenseQuery(lecturerCoursesQO);
  const qc = useQueryClient();
  const totalStudents = courses.reduce((a, c) => a + c.enrolledStudentIds.length, 0);
  const { data: unassigned } = useQuery(unassignedCoursesQO);

  const claim = async (courseId: string) => {
    try {
      await coursesApi.claim(courseId);
      toast.success("Course claimed — it's now in My Courses");
      qc.invalidateQueries({ queryKey: ["lecturer", "courses"] });
      qc.invalidateQueries({ queryKey: ["lecturer", "unassigned-courses"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not claim this course");
    }
  };

  return (
    <>
      <PageHeader title="Welcome back" subtitle="Pick a course to start today's attendance." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="My Courses" value={courses.length} icon={BookOpen} />
        <StatCard label="Total Students" value={totalStudents} icon={Users} />
        <StatCard label="Ready to run" value="Any time" icon={PlayCircle} />
      </div>

      {unassigned && unassigned.length > 0 && (
        <div className="mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-5 shadow-elegant">
          <h2 className="font-display text-lg font-semibold">
            Unassigned courses in your department
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Claim one to start taking attendance — it becomes yours instantly.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {unassigned.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <CourseGlyph icon={c.icon} color={c.color} seed={c.code} size="sm" />
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                    <div className="truncate font-display text-sm font-semibold">{c.title}</div>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => claim(c.id)}>
                  <Check className="mr-1 h-4 w-4" /> Claim
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="mt-10 font-display text-lg font-semibold">Your courses</h2>
      <RouteTransition stagger className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {courses.length === 0 && (
          <EmptyState
            className="col-span-full"
            icon={<BookOpen className="h-7 w-7" />}
            title="No courses yet"
            description="You haven't been assigned to any courses yet."
          />
        )}
        {courses.map((c) => (
          <div
            key={c.id}
            className="group rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition hover:-translate-y-0.5 hover:shadow-lift"
          >
            <div className="flex items-center gap-3">
              <CourseGlyph icon={c.icon} color={c.color} seed={c.code} size="md" />
              <div>
                <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                <div className="font-display font-semibold">{c.title}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {c.enrolledStudentIds.length} students · Level {c.level}
              </span>
              <span>{c.units} units</span>
            </div>
            <Link
              to="/lecturer/courses/$courseId"
              params={{ courseId: c.id }}
              className="mt-4 block"
            >
              <Button className="w-full">
                Open <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        ))}
      </RouteTransition>
    </>
  );
}
