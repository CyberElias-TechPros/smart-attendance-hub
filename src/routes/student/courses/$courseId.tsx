import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  studentCourses,
  studentCourseSessions,
  studentHistory,
} from "@/lib/api.functions";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { CourseGlyph } from "@/lib/courseIcons";
import { burstSuccess } from "@/lib/confetti";
import { computeMilestones, type Milestone } from "@/lib/milestones";
import { useAtRiskThreshold } from "@/lib/useSiteSettings";
import { CardSkeleton } from "@/components/Loaders";
import { EmptyState } from "@/components/EmptyState";

const coursesQO = queryOptions({ queryKey: ["student", "courses"], queryFn: () => studentCourses() });
const historyQO = queryOptions({ queryKey: ["student", "history"], queryFn: () => studentHistory() });

export const Route = createFileRoute("/student/courses/$courseId")({
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(coursesQO);
    context.queryClient.ensureQueryData(historyQO);
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
  const { signed } = Route.useSearch({ strict: false }) as { signed?: string };
  const { data: courses } = useSuspenseQuery(coursesQO);
  const { data: history } = useSuspenseQuery(historyQO);
  const threshold = useAtRiskThreshold();
  const course = courses.find((c) => c.id === courseId);
  const navigate = useNavigate();
  const sessionsFn = useServerFn(studentCourseSessions);

  const sessionsQ = useQuery({
    queryKey: ["student-sessions", courseId],
    queryFn: () => sessionsFn({ data: { courseId } }),
    enabled: Boolean(courseId),
  });

  useEffect(() => {
    if (signed === "1") {
      burstSuccess();
    }
  }, [signed]);

  if (!course)
    return (
      <div className="grid h-40 place-items-center text-muted-foreground">Course not found.</div>
    );

  const sessions = (sessionsQ.data ?? []) as Array<{ id: string; startedAt: number; expiresAt?: number; endedAt?: number; topic?: string }>;
  const sessionsForMs = sessions.map((s) => {
    const attended = history.some(
      (h) => h.courseCode === course.code && h.timestamp >= s.startedAt && h.timestamp <= (s.expiresAt ?? s.startedAt),
    );
    return { id: s.id, attended, timestamp: s.startedAt };
  });
  const historyForMs = history.map((h) => ({ timestamp: h.timestamp, courseId: course.id }));
  const milestones: Milestone[] = computeMilestones({
    course: {
      id: course.id,
      code: course.code,
      title: course.title,
      percentage: course.percentage,
      totalSessions: course.totalSessions,
      attendedSessions: course.attendedSessions,
    },
    sessions: sessionsForMs,
    history: historyForMs,
    threshold,
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/student" })}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-start gap-4">
        <CourseGlyph icon={course.icon} color={course.color} seed={course.code} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-muted-foreground">{course.code}</div>
          <h1 className="font-display text-2xl font-semibold">{course.title}</h1>
          {course.description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{course.description}</p>}
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
            <span key={m.id} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${TONE_BADGE[m.tone]}`}>
              <span>{m.emoji}</span>
              {m.title}
            </span>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant">
          <div className="text-xs text-muted-foreground">Attendance</div>
          <div className="mt-1 font-display text-3xl font-bold">{course.attendedSessions}/{course.totalSessions}</div>
          <div className="mt-2">
            <Progress value={course.percentage} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{course.percentage}% attended</div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant md:col-span-2">
          <div className="text-xs text-muted-foreground">Department / Level</div>
          <div className="mt-1 font-display text-xl font-semibold">{course.departmentId} · {course.level}</div>
          <div className="mt-2 text-sm text-muted-foreground">Lecturer: {course.lecturerName}</div>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> Sessions
        </h2>
        {sessionsQ.isLoading ? (
          <CardSkeleton className="mt-4" />
        ) : sessions.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={<Sparkles className="h-7 w-7" />}
            title="No sessions yet"
            description="Attendance sessions for this course will appear here."
          />
        ) : (
          <div className="mt-4 grid gap-3">
            {sessions.map((s) => {
              const attended = history.some(
                (h) => h.courseCode === course.code && h.timestamp >= s.startedAt && h.timestamp <= (s.expiresAt ?? s.startedAt),
              );
              return (
                <div key={s.id} className="flex items-center justify-between rounded-xl border border-border/70 bg-card p-4">
                  <div>
                    <div className="text-sm font-medium">{new Date(s.startedAt).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.endedAt ? `Ended ${new Date(s.endedAt).toLocaleTimeString()}` : "Live"}
                      {s.topic ? ` · ${s.topic}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {attended ? (
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
