import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppShell";
import { Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { lecturerCourses } from "@/lib/api.functions";
import { PlayCircle, BookOpen } from "lucide-react";
import { CourseGlyph } from "@/lib/courseIcons";
import { RouteTransition } from "@/components/RouteTransition";
import { EmptyState } from "@/components/EmptyState";

const coursesQO = queryOptions({ queryKey: ["lecturer", "courses"], queryFn: () => lecturerCourses() });

export const Route = createFileRoute("/lecturer/sessions")({
  loader: ({ context }) => context.queryClient.ensureQueryData(coursesQO),
  component: SessionsIndex,
});

function SessionsIndex() {
  const { data: courses } = useSuspenseQuery(coursesQO);
  return (
    <>
      <PageHeader title="Sessions" subtitle="Pick a course to start or review sessions." />
      <RouteTransition stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {courses.length === 0 && (
          <EmptyState
            className="col-span-full"
            icon={<BookOpen className="h-7 w-7" />}
            title="No courses yet"
            description="You haven't been assigned to any courses yet."
          />
        )}
        {courses.map((c) => (
          <Link
            key={c.id}
            to="/lecturer/courses/$courseId"
            params={{ courseId: c.id }}
            className="group rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition hover:-translate-y-0.5 hover:shadow-lift"
          >
            <div className="flex items-center gap-3">
              <CourseGlyph icon={c.icon} color={c.color} seed={c.code} size="md" />
              <div>
                <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                <div className="font-display font-semibold">{c.title}</div>
              </div>
            </div>
            <div className="mt-4 inline-flex items-center gap-2 text-sm text-primary group-hover:underline">
              <PlayCircle className="h-4 w-4" /> Start / review
            </div>
          </Link>
        ))}
      </RouteTransition>
    </>
  );
}
