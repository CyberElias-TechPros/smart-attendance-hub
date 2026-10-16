import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BarChart3,
  ExternalLink,
  Gauge,
  GraduationCap,
  Percent,
  Printer,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { PageHeader, StatCard } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { coursesReportQO, resultAnalyticsQO } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { ResultAnalyticsRow } from "@/lib/types";

/**
 * Results (brief §2 sidebar, plan P4.4).
 *
 * The point of this page is the join: attendance and performance side by side,
 * per student, with the institution's own policy applied. It answers the two
 * questions a senate actually asks — "is attendance tracking performance?" and
 * "who is at risk of being barred?" — and it answers them from the same weighted
 * attendance figures every other page uses, not from a second implementation.
 */
export const Route = createFileRoute("/admin/results")({
  component: ResultsPage,
});

const ALL = "__all__";

/** Quadrant of the scatter: attendance against performance, split at 50%/threshold. */
function quadrant(row: ResultAnalyticsRow, threshold: number): string {
  const strong = (row.finalPercent ?? 0) >= 50;
  const attending = (row.attendanceRate ?? 0) >= threshold;
  if (strong && attending) return "Committed";
  if (strong && !attending) return "At risk";
  if (!strong && attending) return "Needs support";
  return "Both at risk";
}

function ResultsPage() {
  const coursesQ = useQuery(coursesReportQO({ pageSize: 500 }));
  const courses = coursesQ.data?.rows ?? [];
  const [courseId, setCourseId] = useState<string>(ALL);

  const effectiveCourseId = courseId === ALL ? (courses[0]?.id ?? "") : courseId;
  const analyticsQ = useQuery(resultAnalyticsQO(effectiveCourseId, {}));
  const data = analyticsQ.data;

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    // Ranked by attendance, because that is the axis the institution can act on.
    list.sort(
      (a, b) =>
        (a.attendanceRate ?? -1) - (b.attendanceRate ?? -1) ||
        a.studentName.localeCompare(b.studentName),
    );
    return list;
  }, [data]);

  const scatterPoints = rows
    .filter((r) => r.attendanceRate != null && r.finalPercent != null)
    .map((r) => ({ x: r.attendanceRate as number, y: r.finalPercent as number, row: r }));

  if (coursesQ.isLoading) {
    return (
      <RouteTransition>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-4 h-96 w-full" />
      </RouteTransition>
    );
  }

  if (courses.length === 0) {
    return (
      <RouteTransition>
        <PageHeader title="Results" subtitle="Attendance and performance, side by side." />
        <EmptyState
          icon={<GraduationCap className="h-7 w-7" />}
          title="No courses yet"
          description="Results are analysed per course. Create a course and schedule an assessment to see the join."
          action={
            <Button asChild variant="outline">
              <Link to="/admin/courses">Go to All Courses</Link>
            </Button>
          }
        />
      </RouteTransition>
    );
  }

  return (
    <RouteTransition>
      <PageHeader
        title="Results & attendance"
        subtitle="Every student's attendance rate against their weighted score, with the institution's policy applied — computed from the same attendance figures the rest of the dashboard shows."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="rounded-lg border border-border/70 bg-background px-2 py-1.5 text-xs"
              aria-label="Course"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> Print
            </Button>
          </div>
        }
      />

      {analyticsQ.isLoading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Students"
              value={data.summary.students}
              icon={GraduationCap}
              hint={data.course.code}
            />
            <StatCard
              label="Assessments"
              value={data.exams.length}
              icon={BarChart3}
              hint={
                data.exams.some((e) => e.weight)
                  ? "Weighted final score"
                  : "Equal weighting (no weights set)"
              }
            />
            <StatCard
              label="Attendance ↔ score"
              value={data.summary.correlation == null ? "—" : data.summary.correlation.toFixed(2)}
              icon={Sparkles}
              hint="Pearson r across students with both figures"
              formula="1.00 = attendance and performance move perfectly together; 0 = no linear relationship. Shown as — when fewer than three students have both figures."
            />
            <StatCard
              label={`Above ${data.threshold}%`}
              value={data.summary.meanAbove == null ? "—" : `${data.summary.meanAbove}%`}
              icon={Percent}
              hint="Mean final score"
            />
            <StatCard
              label={`Below ${data.threshold}%`}
              value={data.summary.meanBelow == null ? "—" : `${data.summary.meanBelow}%`}
              icon={Gauge}
              hint={data.policyEnabled ? "Barred from the examination" : "Policy not applied"}
              trend={data.summary.barred > 0 ? `${data.summary.barred} affected` : undefined}
              trendTone={data.summary.barred > 0 ? "down" : "up"}
            />
          </div>

          {data.summary.barred > 0 && (
            <div
              className={cn(
                "mt-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm",
                data.policyEnabled
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-warning/40 bg-warning/5",
              )}
            >
              <ShieldAlert className="h-4 w-4" />
              <span>
                <strong>{data.summary.barred}</strong> student(s) fall below the {data.threshold}%
                attendance threshold
                {data.policyEnabled
                  ? " and are barred from the examination under the institution's policy."
                  : " — the policy flag is off, so this is reported but not enforced."}
              </span>
              {data.summary.barredButPassing > 0 && (
                <Badge variant="outline">
                  {data.summary.barredButPassing} would pass on score alone
                </Badge>
              )}
              {data.summary.barredButPassing > 0 && (
                <span className="text-xs text-muted-foreground">
                  These are the students a barred-from-exam policy actually changes the outcome for,
                  which is why they are called out separately.
                </span>
              )}
            </div>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Attendance vs performance ({scatterPoints.length} students)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {scatterPoints.length < 2 ? (
                  <p className="text-sm text-muted-foreground">
                    Not enough marked students to plot yet. Record marks on the{" "}
                    <Link
                      to="/admin/examinations"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Examinations
                    </Link>{" "}
                    page and the relationship appears here.
                  </p>
                ) : (
                  <Scatter
                    points={scatterPoints}
                    threshold={data.threshold}
                    courseCode={data.course.code}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cohorts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {["Committed", "Needs support", "At risk", "Both at risk"].map((label) => {
                  const members = rows.filter((r) => quadrant(r, data.threshold) === label);
                  const tone =
                    label === "Committed"
                      ? "success"
                      : label === "Needs support"
                        ? "warning"
                        : "destructive";
                  return (
                    <div key={label} className="rounded-xl border border-border/70 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              tone === "success"
                                ? "bg-success"
                                : tone === "warning"
                                  ? "bg-warning"
                                  : "bg-destructive",
                            )}
                          />
                          {label}
                        </span>
                        <span className="font-mono text-sm">{members.length}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {label === "Committed"
                          ? `Attending ≥ ${data.threshold}% and scoring ≥ 50%.`
                          : label === "Needs support"
                            ? `Attending ≥ ${data.threshold}% but scoring < 50%.`
                            : label === "At risk"
                              ? `Scoring ≥ 50% while attending < ${data.threshold}%.`
                              : `Attending < ${data.threshold}% and scoring < 50%.`}
                      </p>
                      {members.length > 0 && members.length <= 4 && (
                        <p className="mt-1 text-[11px]">
                          {members.map((m) => m.studentName).join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted-foreground">
                  Quadrants split at the attendance threshold and a 50% pass mark. The correlation
                  above is computed over the same students.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">
                Per-student detail — {data.course.code} {data.course.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <caption className="sr-only">
                    Each student&apos;s attendance rate, attended lectures, per-assessment scores,
                    weighted final percentage and grade
                  </caption>
                  <TableHeader className="bg-card">
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead className="text-right">Attendance</TableHead>
                      <TableHead className="text-right">Attended</TableHead>
                      {data.exams.map((exam) => (
                        <TableHead key={exam.id} className="text-right" title={exam.title}>
                          {exam.kind.toUpperCase()} /{exam.maxScore}
                          {exam.weight ? ` · ${exam.weight}%` : ""}
                        </TableHead>
                      ))}
                      <TableHead className="text-right">Final</TableHead>
                      <TableHead className="text-right">Grade</TableHead>
                      <TableHead className="text-right">Risk</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.studentId} className="hover:bg-muted/40">
                        <TableCell>
                          <div className="text-sm font-medium">{row.studentName}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {row.matricNo}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          <span className={cn(row.barred && "font-semibold text-destructive")}>
                            {row.attendanceRate == null ? "—" : `${row.attendanceRate}%`}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.attended}/{row.expected}
                        </TableCell>
                        {data.exams.map((exam) => (
                          <TableCell key={exam.id} className="text-right font-mono text-xs">
                            {row.scores[exam.id] == null ? "—" : row.scores[exam.id]}
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-mono text-xs font-semibold">
                          {row.finalPercent == null ? "—" : `${row.finalPercent}%`}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {row.letterGrade ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.barred ? (
                            <Badge variant="destructive" className="text-[10px]">
                              Barred
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              {quadrant(row, data.threshold)}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="secondary">Weighted</Badge>
            <span>
              Final score is the weighted mean of each assessment&apos;s percentage (an assessment
              without a weight counts once). A missing mark is excluded, never treated as zero.
            </span>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/examinations" className="flex items-center gap-1.5 text-primary">
                Enter or correct marks <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </>
      )}
    </RouteTransition>
  );
}

/**
 * Hand-drawn scatter: attendance (x) against final score (y), with the threshold
 * line where the institution's policy bites. SVG rather than a chart library so
 * the print stylesheet and the screen cannot diverge.
 */
function Scatter({
  points,
  threshold,
  courseCode,
}: {
  points: Array<{ x: number; y: number; row: ResultAnalyticsRow }>;
  threshold: number;
  courseCode: string;
}) {
  const width = 520;
  const height = 300;
  const pad = { top: 16, right: 16, bottom: 34, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const sx = (x: number) => pad.left + (Math.min(100, Math.max(0, x)) / 100) * innerW;
  const sy = (y: number) => pad.top + innerH - (Math.min(100, Math.max(0, y)) / 100) * innerH;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Scatter plot of attendance against final score for ${courseCode}, ${points.length} students`}
      >
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={sy(tick)}
              y2={sy(tick)}
              className="stroke-border"
              strokeWidth="1"
              strokeDasharray={tick === 0 ? undefined : "3 4"}
            />
            <text
              x={pad.left - 6}
              y={sy(tick) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[9px]"
            >
              {tick}
            </text>
            <text
              x={sx(tick)}
              y={height - pad.bottom + 14}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px]"
            >
              {tick}%
            </text>
          </g>
        ))}

        {/* Threshold: the line the policy is drawn at. */}
        <line
          x1={sx(threshold)}
          x2={sx(threshold)}
          y1={pad.top}
          y2={pad.top + innerH}
          className="stroke-destructive"
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />
        <text x={sx(threshold) + 4} y={pad.top + 10} className="fill-destructive text-[9px]">
          policy {threshold}%
        </text>
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={sy(50)}
          y2={sy(50)}
          className="stroke-warning"
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />
        <text
          x={width - pad.right - 4}
          y={sy(50) - 4}
          textAnchor="end"
          className="fill-warning text-[9px]"
        >
          pass 50%
        </text>

        {points.map((p) => (
          <circle
            key={p.row.studentId}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={5}
            className={p.row.barred ? "fill-destructive/80" : "fill-primary/80"}
          >
            <title>
              {`${p.row.studentName} (${p.row.matricNo}) — attendance ${p.x}%, final ${p.y}%${
                p.row.letterGrade ? `, grade ${p.row.letterGrade}` : ""
              }`}
            </title>
          </circle>
        ))}

        <text
          x={width / 2}
          y={height - 4}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          Attendance rate (%)
        </text>
      </svg>
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-primary/80" /> attending
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/80" /> below the attendance
          policy
        </span>
        <span>Hover a point for the student and their figures.</span>
      </div>
    </div>
  );
}
