import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BookOpen, Radio, Users } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/AppShell";
import { SearchInput, useDebounced } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

export const Route = createFileRoute("/lecturer/courses/")({ component: CourseList });

function CourseList() {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput);

  const coursesQuery = useQuery({
    queryKey: ["lecturer", "courses"],
    queryFn: () => api.lecturerCourses(),
  });
  const sessionsQuery = useQuery({
    queryKey: ["lecturer", "sessions"],
    queryFn: () => api.lecturerSessions(),
    refetchInterval: 30_000,
  });

  const liveCourseIds = new Set(
    (sessionsQuery.data?.items ?? [])
      .filter((session) => !session.endedAt && session.expiresAt > Date.now())
      .map((session) => session.courseId),
  );

  const items = (coursesQuery.data?.items ?? []).filter((course) =>
    search
      ? course.code.toLowerCase().includes(search.toLowerCase()) ||
        course.title.toLowerCase().includes(search.toLowerCase())
      : true,
  );

  return (
    <RouteTransition>
      <PageHeader
        title="My courses"
        subtitle="Open a course to take attendance or review its report."
      />

      <div className="mb-4">
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Search my courses"
          label="Search my courses"
        />
      </div>

      <QueryBoundary
        isLoading={coursesQuery.isPending}
        error={coursesQuery.error}
        data={items}
        onRetry={() => coursesQuery.refetch()}
        loadingLabel="Loading courses"
        isEmpty={(rows) => rows.length === 0}
        empty={
          <EmptyState
            icon={<BookOpen className="h-7 w-7" />}
            title={search ? "No matching courses" : "No courses assigned"}
            description={
              search
                ? "Try a different search term."
                : "An administrator assigns courses to lecturers. Once assigned, they appear here."
            }
          />
        }
      >
        {(rows) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((course) => (
              <Link
                key={course.id}
                to="/lecturer/courses/$courseId"
                params={{ courseId: course.id }}
                className="group rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lift"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-primary">
                    {course.code}
                  </span>
                  {liveCourseIds.has(course.id) ? (
                    <Badge variant="secondary" className="gap-1 bg-success/15 text-success">
                      <Radio className="h-3 w-3" /> Live
                    </Badge>
                  ) : (
                    <Badge variant="outline">{course.level} level</Badge>
                  )}
                </div>
                <h2 className="mt-2 font-display text-lg font-semibold">{course.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {course.departmentName ?? "No department"}
                </p>
                <div className="mt-4 flex items-center gap-4 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-4 w-4" aria-hidden /> {course.enrolledCount}
                  </span>
                  <span>
                    {course.sessionCount} session{course.sessionCount === 1 ? "" : "s"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </QueryBoundary>
    </RouteTransition>
  );
}
