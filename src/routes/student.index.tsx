import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, BookOpen, QrCode, Radio } from "lucide-react";

import { PageHeader, StatCard } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { useAtRiskThreshold } from "@/lib/useSiteSettings";

export const Route = createFileRoute("/student/")({ component: StudentDashboard });

function StudentDashboard() {
  const threshold = useAtRiskThreshold();

  const coursesQuery = useQuery({
    queryKey: ["student", "courses"],
    queryFn: () => api.studentCourses(),
  });
  const openQuery = useQuery({
    queryKey: ["student", "openSessions"],
    queryFn: () => api.studentOpenSessions(),
    refetchInterval: 30_000,
  });

  const courses = coursesQuery.data?.items ?? [];
  const overall =
    courses.length > 0
      ? Math.round(courses.reduce((sum, course) => sum + course.percentage, 0) / courses.length)
      : 0;
  const atRisk = courses.filter((course) => course.percentage < threshold);
  const openSessions = (openQuery.data?.items ?? []).filter(
    (session) => !session.alreadySignedIn && session.expiresAt > Date.now(),
  );

  return (
    <RouteTransition>
      <PageHeader
        title="My courses"
        subtitle="Track your attendance and sign in to live sessions."
        actions={
          <Button asChild>
            <Link to="/student/attend">
              <QrCode className="mr-2 h-4 w-4" /> Sign in to a session
            </Link>
          </Button>
        }
      />

      {openSessions.length > 0 && (
        <div className="mb-6 rounded-2xl border border-success/40 bg-success/5 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-success">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <Radio className="h-4 w-4" aria-hidden />
            {openSessions.length} session{openSessions.length === 1 ? " is" : "s are"} open right
            now
          </div>
          <ul className="mt-3 space-y-2">
            {openSessions.map((session) => (
              <li
                key={session.sessionId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-3"
              >
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold">{session.courseCode}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {session.topic ?? session.courseTitle}
                  </div>
                </div>
                <Button size="sm" asChild>
                  <Link to="/student/attend">Sign in</Link>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <QueryBoundary
        isLoading={coursesQuery.isPending}
        error={coursesQuery.error}
        data={courses}
        onRetry={() => coursesQuery.refetch()}
        loadingLabel="Loading your courses"
        isEmpty={(rows) => rows.length === 0}
        empty={
          <EmptyState
            icon={<BookOpen className="h-7 w-7" />}
            title="You are not enrolled in any course"
            description="Contact your department if you believe this is a mistake — administrators manage enrolment."
          />
        }
      >
        {(rows) => (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Courses" value={rows.length} icon={BookOpen} />
              <StatCard label="Overall attendance" value={`${overall}%`} />
              <StatCard label="Below threshold" value={atRisk.length} icon={AlertTriangle} />
            </div>

            {atRisk.length > 0 && (
              <div
                role="status"
                className="mt-6 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <p>
                  Your attendance is below the {threshold}% requirement in{" "}
                  <strong>{atRisk.map((course) => course.code).join(", ")}</strong>. Speak to your
                  lecturer as soon as possible.
                </p>
              </div>
            )}

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((course) => {
                const low = course.percentage < threshold;
                return (
                  <Link
                    key={course.id}
                    to="/student/courses/$courseId"
                    params={{ courseId: course.id }}
                    className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lift"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-primary">
                        {course.code}
                      </span>
                      <Badge variant={low ? "destructive" : "secondary"}>
                        {course.percentage}%
                      </Badge>
                    </div>
                    <h2 className="mt-2 font-display text-base font-semibold">{course.title}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {course.attendedSessions} of {course.totalSessions} sessions attended
                    </p>
                    <Progress
                      className="mt-4"
                      value={course.percentage}
                      aria-label={`${course.percentage}% attendance in ${course.code}`}
                    />
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </QueryBoundary>
    </RouteTransition>
  );
}
