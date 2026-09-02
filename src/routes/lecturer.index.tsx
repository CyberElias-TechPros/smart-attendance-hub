import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { BookOpen, ClipboardCheck, PlayCircle, Radio, Users } from "lucide-react";

import { PageHeader, StatCard } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export const Route = createFileRoute("/lecturer/")({ component: LecturerDashboard });

function LecturerDashboard() {
  const query = useQuery({
    queryKey: ["lecturer", "overview"],
    queryFn: () => api.lecturerOverview(),
    refetchInterval: 30_000,
  });

  return (
    <RouteTransition>
      <PageHeader
        title="Dashboard"
        subtitle="Your courses, sessions and attendance at a glance."
        actions={
          <Button asChild>
            <Link to="/lecturer/courses">
              <PlayCircle className="mr-2 h-4 w-4" /> Start a session
            </Link>
          </Button>
        }
      />

      <QueryBoundary
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        onRetry={() => query.refetch()}
        loadingLabel="Loading dashboard"
      >
        {(data) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="My courses" value={data.stats.courses} icon={BookOpen} />
              <StatCard label="Students" value={data.stats.enrollments} icon={Users} />
              <StatCard label="Sessions held" value={data.stats.sessions} icon={PlayCircle} />
              <StatCard
                label="Total sign-ins"
                value={data.stats.attendance}
                icon={ClipboardCheck}
              />
            </div>

            {data.stats.liveSessions > 0 && (
              <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-success/40 bg-success/5 px-5 py-4">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                </span>
                <Radio className="h-4 w-4 text-success" aria-hidden />
                <p className="flex-1 text-sm font-medium">
                  You have {data.stats.liveSessions} live{" "}
                  {data.stats.liveSessions === 1 ? "session" : "sessions"} running.
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/lecturer/sessions">View sessions</Link>
                </Button>
              </div>
            )}

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
                <h2 className="font-display text-lg font-semibold">My courses</h2>
                {data.courses.length === 0 ? (
                  <EmptyState
                    className="mt-4 border-0 px-2 py-8"
                    icon={<BookOpen className="h-6 w-6" />}
                    title="No courses assigned"
                    description="An administrator needs to assign you to a course before you can take attendance."
                  />
                ) : (
                  <ul className="mt-4 space-y-2">
                    {data.courses.map((course) => (
                      <li key={course.id}>
                        <Link
                          to="/lecturer/courses/$courseId"
                          params={{ courseId: course.id }}
                          className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3 transition hover:border-primary/50 hover:bg-muted/40"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-sm font-semibold text-primary">
                              {course.code}
                            </div>
                            <div className="truncate text-sm">{course.title}</div>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {course.enrolledCount} enrolled
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
                <h2 className="font-display text-lg font-semibold">Recent sessions</h2>
                {data.recentSessions.length === 0 ? (
                  <EmptyState
                    className="mt-4 border-0 px-2 py-8"
                    icon={<PlayCircle className="h-6 w-6" />}
                    title="No sessions yet"
                    description="Start a session from one of your courses to take attendance."
                  />
                ) : (
                  <ul className="mt-4 space-y-2">
                    {data.recentSessions.map((session) => {
                      const live = !session.endedAt && session.expiresAt > Date.now();
                      return (
                        <li key={session.id}>
                          <Link
                            to="/lecturer/sessions/$sessionId"
                            params={{ sessionId: session.id }}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3 transition hover:border-primary/50 hover:bg-muted/40"
                          >
                            <div className="min-w-0">
                              <div className="font-mono text-sm font-semibold">
                                {session.courseCode}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(session.startedAt).toLocaleString()}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {live && (
                                <Badge variant="secondary" className="bg-success/15 text-success">
                                  Live
                                </Badge>
                              )}
                              <span className="font-mono text-sm">
                                {session.attendedCount ?? 0}/{session.enrolledCount ?? 0}
                              </span>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </QueryBoundary>
    </RouteTransition>
  );
}
