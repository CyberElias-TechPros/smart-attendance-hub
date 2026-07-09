import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { lecturerCourses } from "@/lib/api.functions";
import { PageHeader } from "@/components/AppShell";
import { BookOpen, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const coursesQO = queryOptions({ queryKey: ["lecturer", "courses"], queryFn: () => lecturerCourses() });

export const Route = createFileRoute("/lecturer/courses")({
  loader: ({ context }) => context.queryClient.ensureQueryData(coursesQO),
  component: LecturerCoursesPage,
});

function LecturerCoursesPage() {
  const { data: courses } = useSuspenseQuery(coursesQO);
  return (
    <>
      <PageHeader title="My Courses" subtitle="Every course assigned to you this semester." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {courses.map((c) => (
          <Link
            key={c.id}
            to="/lecturer/courses/$courseId"
            params={{ courseId: c.id }}
            className="group rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition hover:-translate-y-0.5 hover:shadow-lift"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><BookOpen className="h-5 w-5" /></div>
              <div>
                <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                <div className="font-display font-semibold">{c.title}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{c.enrolledStudentIds.length} students</span>
              <Button variant="ghost" size="sm">Open <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
