import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQuery, useQueries } from "@tanstack/react-query";
import {
  studentCourses,
  studentCourseSessions,
  studentHistory,
  listOpenSessionsForStudent,
} from "@/lib/api.functions";
import { PageHeader, StatCard } from "@/components/AppShell";
import { Progress } from "@/components/ui/progress";
import { BookOpen, QrCode, AlertTriangle, CheckCircle2, Radio, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CourseGlyph } from "@/lib/courseIcons";
import { useAtRiskThreshold, useSiteSettings } from "@/lib/useSiteSettings";
import { MilestoneToaster } from "@/components/MilestoneToaster";
import { RouteTransition } from "@/components/RouteTransition";
import { CardSkeleton } from "@/components/Loaders";
import { EmptyState } from "@/components/EmptyState";

const coursesQO = queryOptions({ queryKey: ["student", "courses"], queryFn: () => studentCourses() });
const historyQO = queryOptions({ queryKey: ["student", "history"], queryFn: () => studentHistory() });
const openSessionsQO = queryOptions({ queryKey: ["student", "open-sessions"], queryFn: () => listOpenSessionsForStudent() });

export const Route = createFileRoute("/student/")({
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(coursesQO);
    context.queryClient.ensureQueryData(historyQO);
  },
  component: StudentDashboard,
});

function StudentDashboard() {
  const { data: courses } = useSuspenseQuery(coursesQO);
  const { data: history } = useSuspenseQuery(historyQO);
  const threshold = useAtRiskThreshold();
  const { data: settings } = useSiteSettings();
  const { data: openSessions, isLoading: openLoading } = useQuery(openSessionsQO);

  const sessionQueries = useQueries({
    queries: courses.map((c) => ({
      queryKey: ["student", "sessions", c.id],
      queryFn: () => studentCourseSessions({ data: { courseId: c.id } }),
    })),
  });

  const sessionsByCourse: Record<string, { id: string; attended: boolean; timestamp?: number | null }[]> = {};
  courses.forEach((c, i) => {
    const sessions = (sessionQueries[i].data ?? []) as Array<{ id: string; startedAt: number; expiresAt?: number; endedAt?: number }>;
    sessionsByCourse[c.id] = sessions.map((s) => ({
      id: s.id,
      timestamp: s.startedAt,
      attended: history.some(
        (h) => h.courseCode === c.code && h.timestamp >= s.startedAt && h.timestamp <= (s.expiresAt ?? s.startedAt),
      ),
    }));
  });

  const historyForToast = history.map((h) => ({ timestamp: h.timestamp, courseId: courses.find((c) => c.code === h.courseCode)?.id ?? h.courseCode }));
  const coursesForToast = courses.map((c) => ({
    id: c.id,
    code: c.code,
    title: c.title,
    percentage: c.percentage,
    totalSessions: c.totalSessions,
    attendedSessions: c.attendedSessions,
  }));

  const avg = courses.length === 0 ? 0 : Math.round(courses.reduce((a, c) => a + c.percentage, 0) / courses.length);
  const atRisk = courses.filter((c) => c.percentage < threshold).length;

  return (
    <>
      <MilestoneToaster courses={coursesForToast} sessionsByCourse={sessionsByCourse} history={historyForToast} threshold={threshold} />

      <PageHeader
        title="My Courses"
        subtitle="Your live attendance for the semester."
        actions={
          <Link to="/student/attend">
            <Button>
              <QrCode className="mr-2 h-4 w-4" /> Sign in to a lecture
            </Button>
          </Link>
        }
      />

      {openLoading ? (
        <CardSkeleton className="mb-8" />
      ) : openSessions && openSessions.length > 0 ? (
        <div className="mb-8 grid gap-3 sm:grid-cols-2">
          {openSessions.map((s) => (
            <Link
              key={s.sessionId}
              to="/student/attend"
              className="flex items-center gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-elegant transition hover:bg-primary/10"
            >
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground animate-pulse-ring">
                <Radio className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-muted-foreground">{s.courseCode}</div>
                <div className="truncate font-display font-semibold">{s.courseTitle}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-lg font-semibold tracking-widest">{s.code}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" /> <Countdown expiresAt={s.expiresAt} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Courses" value={courses.length} icon={BookOpen} />
        <StatCard label="Average attendance" value={`${avg}%`} icon={CheckCircle2} hint="Across all courses" />
        <StatCard label={`At risk (< ${threshold}%)`} value={atRisk} icon={AlertTriangle} hint="Below required threshold" />
      </div>

      <h2 className="mt-10 font-display text-lg font-semibold">Course breakdown</h2>
      <RouteTransition stagger className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {courses.map((c) => (
          <Link
            key={c.id}
            to="/student/courses/$courseId"
            params={{ courseId: c.id }}
            className="group rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition duration-300 hover:-translate-y-0.5 hover:shadow-lift"
          >
            <div className="flex items-start gap-4">
              <CourseGlyph icon={c.icon} color={c.color} seed={c.code} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                <div className="truncate font-display font-semibold">{c.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{c.lecturerName}</div>
              </div>
              <div className={`font-display text-2xl font-semibold ${c.percentage < threshold ? "text-destructive" : "text-primary"}`}>
                {c.percentage}%
              </div>
            </div>
            <div className="mt-4">
              <Progress value={c.percentage} className="h-2" />
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{c.attendedSessions} of {c.totalSessions} sessions</span>
                <span>{c.units} units</span>
              </div>
            </div>
          </Link>
        ))}
        {courses.length === 0 && (
          <EmptyState
            className="col-span-full"
            icon={<BookOpen className="h-7 w-7" />}
            title="No courses yet"
            description="You are not enrolled in any courses."
          />
        )}
      </RouteTransition>
    </>
  );
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const { data: now } = useQuery({ queryKey: ["now", expiresAt], queryFn: () => Date.now(), refetchInterval: 1000 });
  const secs = Math.max(0, Math.floor((expiresAt - (now ?? Date.now())) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return <span>{m}:{s.toString().padStart(2, "0")}</span>;
}
