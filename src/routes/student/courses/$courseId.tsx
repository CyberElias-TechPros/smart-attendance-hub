import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { useMemo } from "react";

import { PageHeader, StatCard } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { CourseGlyph } from "@/lib/courseIcons";
import { computeMilestones } from "@/lib/milestones";
import { useAtRiskThreshold } from "@/lib/useSiteSettings";

export const Route = createFileRoute("/student/courses/$courseId")({ component: CourseDetailPage });

const TONE_BADGE: Record<string, string> = {
  success: "bg-success/10 text-success",
  warn: "bg-warning/10 text-warning",
  info: "bg-primary/10 text-primary",
  celebrate: "bg-accent/15 text-accent-foreground",
};

function CourseDetailPage() {
  const { courseId } = Route.useParams();
  const threshold = useAtRiskThreshold();

  const detailQuery = useQuery({
    queryKey: ["student", "courses", courseId],
    queryFn: () => api.studentCourseDetail(courseId),
  });
  // Milestones such as streaks need cross-course history, not just this course.
  const historyQuery = useQuery({
    queryKey: ["student", "history", { page: 1, pageSize: 200 }],
    queryFn: () => api.studentHistory({ page: 1, pageSize: 200 }),
  });

  const milestones = useMemo(() => {
    const data = detailQuery.data;
    if (!data) return [];
    return computeMilestones({
      course: {
        id: data.course.id,
        code: data.course.code,
        title: data.course.title,
        percentage: data.course.percentage,
        totalSessions: data.course.totalSessions,
        attendedSessions: data.course.attendedSessions,
      },
      sessions: data.sessions.map((session) => ({
        id: session.id,
        attended: session.attended,
        timestamp: session.timestamp ?? null,
      })),
      history: (historyQuery.data?.items ?? []).map((entry) => ({
        timestamp: entry.timestamp,
        courseId: entry.courseId,
      })),
      threshold,
    });
  }, [detailQuery.data, historyQuery.data, threshold]);

  return (
    <RouteTransition>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link to="/student">
          <ArrowLeft className="mr-2 h-4 w-4" /> My courses
        </Link>
      </Button>

      <QueryBoundary
        isLoading={detailQuery.isPending}
        error={detailQuery.error}
        data={detailQuery.data}
        onRetry={() => detailQuery.refetch()}
        loadingLabel="Loading course"
      >
        {(data) => {
          const low = data.course.percentage < threshold;
          return (
            <>
              <PageHeader
                title={
                  <span className="flex items-center gap-3">
                    <CourseGlyph seed={data.course.code} size="sm" />
                    {data.course.code}
                  </span>
                }
                subtitle={data.course.title}
              />

              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label="Attendance" value={`${data.course.percentage}%`} />
                <StatCard label="Attended" value={data.course.attendedSessions} />
                <StatCard label="Sessions held" value={data.course.totalSessions} />
              </div>

              <div className="mt-4">
                <Progress
                  value={data.course.percentage}
                  aria-label={`${data.course.percentage}% attendance`}
                />
                {low && (
                  <p role="status" className="mt-2 text-sm text-destructive">
                    You are below the {threshold}% requirement for this course.
                  </p>
                )}
              </div>

              {milestones.length > 0 && (
                <section className="mt-8">
                  <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                    <Sparkles className="h-5 w-5 text-primary" aria-hidden /> Milestones
                  </h2>
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                    {milestones.map((milestone) => (
                      <li
                        key={milestone.id}
                        className={`rounded-xl px-4 py-3 ${TONE_BADGE[milestone.tone] ?? TONE_BADGE.info}`}
                      >
                        <div className="text-sm font-semibold">
                          <span aria-hidden>{milestone.emoji}</span> {milestone.title}
                        </div>
                        <p className="mt-0.5 text-xs opacity-90">{milestone.body}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="mt-8">
                <h2 className="font-display text-lg font-semibold">Session history</h2>
                {data.sessions.length === 0 ? (
                  <EmptyState
                    className="mt-3"
                    title="No sessions yet"
                    description="Your lecturer has not run any attendance session for this course."
                  />
                ) : (
                  <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card">
                    {data.sessions.map((session) => (
                      <li key={session.id} className="flex items-center gap-3 px-4 py-3">
                        {session.attended ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
                        ) : (
                          <XCircle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {session.topic ?? "Attendance session"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(session.startedAt).toLocaleString()}
                          </div>
                        </div>
                        <span
                          className={
                            session.attended
                              ? "shrink-0 text-xs font-medium text-success"
                              : "shrink-0 text-xs text-muted-foreground"
                          }
                        >
                          {session.attended
                            ? session.timestamp
                              ? `Present · ${new Date(session.timestamp).toLocaleTimeString()}`
                              : "Present"
                            : "Absent"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          );
        }}
      </QueryBoundary>
    </RouteTransition>
  );
}
