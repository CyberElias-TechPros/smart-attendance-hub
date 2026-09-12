import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { student } from "@/lib/api";
import { studentCoursesQO } from "@/lib/queries";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";
import { CourseGlyph } from "@/lib/courseIcons";
import { burstSuccess } from "@/lib/confetti";
import { computeMilestones, type Milestone } from "@/lib/milestones";
import { useAtRiskThreshold } from "@/lib/useSiteSettings";
import { CardSkeleton } from "@/components/Loaders";
import { EmptyState } from "@/components/EmptyState";

const searchSchema = z.object({ signed: z.string().optional() });

const courseSessionsQO = (courseId: string) =>
  queryOptions({
    queryKey: ["student-sessions", courseId],
    queryFn: () => student.courseSessions(courseId),
    enabled: Boolean(courseId),
  });

export const Route = createFileRoute("/student/courses/$courseId")({
  validateSearch: (s) => searchSchema.parse(s),
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(studentCoursesQO);
  },
  component: CourseDetailPage,
});

const TONE_BADGE: Record<string, string> = {
  success: "bg-success/10 text-success",
  warn: "bg-warning/10 text-warning",
  info: "bg-primary/10 text-primary",
  celebrate: "bg-accent/15 text-accent-foreground",
};

function CourseDetailPage() {
  const { courseId } = Route.useParams();
  const search = useSearch({ from: "/student/courses/$courseId" });
  const { data: courses } = useSuspenseQuery(studentCoursesQO);
  const qc = useQueryClient();
  const threshold = useAtRiskThreshold();
  const course = courses.find((c) => c.id === courseId);
  const navigate = useNavigate();

  const sessionsQ = useQuery(courseSessionsQO(courseId));

  useEffect(() => {
    if (search.signed === "1") {
      burstSuccess();
      qc.invalidateQueries({ queryKey: ["student"] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.signed]);

  if (!course)
    return (
      <div className="mx-auto grid max-w-lg place-items-center gap-4 px-6 py-20 text-center">
        <div>
          <div className="font-display text-lg font-semibold">Course not found</div>
          <p className="mt-1 text-sm text-muted-foreground">
            You may not be enrolled in this course.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/student" })}>
          Back to my courses
        </Button>
      </div>
    );

  const sessions = sessionsQ.data ?? [];
  const milestones: Milestone[] = computeMilestones({
    course: {
      id: course.id,
      code: course.code,
      title: course.title,
      percentage: course.percentage,
      totalSessions: course.totalSessions,
      attendedSessions: course.attendedSessions,
    },
    sessions: sessions.map((s) => ({
      id: s.id,
      attended: s.attended,
      timestamp: s.attendedAt ?? s.startedAt,
    })),
    history: sessions
      .filter((s) => s.attended && s.attendedAt != null)
      .map((s) => ({ timestamp: s.attendedAt as number, courseId: course.id })),
    threshold,
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate({ to: "/student" })}
          aria-label="Back to my courses"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-start gap-4">
        <CourseGlyph icon={course.icon} color={course.color} seed={course.code} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-muted-foreground">{course.code}</div>
          <h1 className="font-display text-2xl font-semibold">{course.title}</h1>
          {course.description && (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{course.description}</p>
          )}
          {course.category && (
            <span className="mt-2 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {course.category}
            </span>
          )}
        </div>
      </div>

      {milestones.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {milestones.map((m) => (
            <span
              key={m.id}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${TONE_BADGE[m.tone]}`}
            >
              <span>{m.emoji}</span>
              {m.title}
            </span>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant">
          <div className="text-xs text-muted-foreground">Attendance</div>
          <div className="mt-1 font-display text-3xl font-bold">
            {course.attendedSessions}/{course.totalSessions}
          </div>
          <div className="mt-2">
            <Progress value={course.percentage} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{course.percentage}% attended</div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant md:col-span-2">
          <div className="text-xs text-muted-foreground">Level & units</div>
          <div className="mt-1 font-display text-xl font-semibold">
            Level {course.level} · {course.units} units
          </div>
          <div className="mt-2 text-sm text-muted-foreground">Lecturer: {course.lecturerName}</div>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> Sessions
        </h2>
        {sessionsQ.isLoading ? (
          <CardSkeleton className="mt-4" />
        ) : sessionsQ.isError ? (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
            Failed to load sessions.{" "}
            {sessionsQ.error instanceof Error ? sessionsQ.error.message : ""}
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={<Sparkles className="h-7 w-7" />}
            title="No sessions yet"
            description="Attendance sessions for this course will appear here."
          />
        ) : (
          <div className="mt-4 grid gap-3">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-xl border border-border/70 bg-card p-4"
              >
                <div>
                  <div className="text-sm font-medium">
                    {new Date(s.startedAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.endedAt ? `Ended ${new Date(s.endedAt).toLocaleTimeString()}` : "Live"}
                    {s.topic ? ` · ${s.topic}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {s.attended ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success">
                      <CheckCircle2 className="h-3 w-3" /> Attended
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-1 text-xs font-medium text-muted-foreground">
                      <XCircle className="h-3 w-3" /> Missed
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
