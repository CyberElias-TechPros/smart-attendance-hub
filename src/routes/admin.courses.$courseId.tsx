import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Percent,
  Printer,
  TriangleAlert,
  UserCheck,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader, HealthBadge, StatCard } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { weightedPercentage } from "@/lib/attendance-math";
import { exportCourseReportExcel } from "@/lib/exporters";
import { courseReportQO, courseSessionsQO, courseStudentHistoryQO } from "@/lib/queries";
import { cleanFilters, filtersToQuery, normaliseFilters } from "@/lib/report-filters";
import type { CourseReportStudent, ReportFilters } from "@/lib/types";
import { useSiteSettings } from "@/lib/useSiteSettings";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CourseDetailSearch extends ReportFilters {
  session?: string;
  student?: string;
  tab?: "lectures" | "students" | "trends";
}

export const Route = createFileRoute("/admin/courses/$courseId")({
  validateSearch: (search: Record<string, unknown>): CourseDetailSearch => ({
    ...normaliseFilters(search),
    session: typeof search.session === "string" ? search.session : undefined,
    student: typeof search.student === "string" ? search.student : undefined,
    tab:
      search.tab === "students" || search.tab === "trends" || search.tab === "lectures"
        ? search.tab
        : undefined,
  }),
  component: CourseDetailPage,
});

function CourseDetailPage() {
  const { courseId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { data: settings } = useSiteSettings();
  const [studentQuery, setStudentQuery] = useState("");
  const [exporting, setExporting] = useState(false);

  const filters = useMemo<ReportFilters>(
    () =>
      cleanFilters({ ...search, session: undefined, student: undefined, tab: undefined } as never),
    [search],
  );

  const reportQ = useQuery(courseReportQO(courseId, filters));
  const sessionsQ = useQuery(courseSessionsQO(courseId, filters));
  const report = reportQ.data;
  const lectures = useMemo(() => sessionsQ.data ?? [], [sessionsQ.data]);
  const threshold = settings?.atRiskThreshold ?? 75;

  const patch = (next: Partial<CourseDetailSearch>) =>
    void navigate({
      to: "/admin/courses/$courseId",
      params: { courseId },
      search: { ...search, ...next },
    });

  // ── Derived, from server-computed rows only (no maths is re-invented here) ──
  const weekly = useMemo(() => {
    const buckets = new Map<string, { label: string; attended: number; expected: number }>();
    for (const lecture of lectures) {
      const d = new Date(lecture.startedAt);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = monday.toISOString().slice(0, 10);
      const bucket = buckets.get(key) ?? {
        label: `w/c ${monday.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`,
        attended: 0,
        expected: 0,
      };
      bucket.attended += lecture.present + lecture.late;
      bucket.expected += lecture.expected;
      buckets.set(key, bucket);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({
        week: v.label,
        rate: weightedPercentage([{ attended: v.attended, expected: v.expected }], 1) ?? 0,
        attended: v.attended,
        expected: v.expected,
      }));
  }, [lectures]);

  const cumulative = useMemo(() => {
    let attended = 0;
    let expected = 0;
    return [...lectures]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((lecture, index) => {
        attended += lecture.present + lecture.late;
        expected += lecture.expected;
        return {
          label: `L${index + 1}`,
          rate: weightedPercentage([{ attended, expected }], 1) ?? 0,
          date: new Date(lecture.startedAt).toLocaleDateString(),
        };
      });
  }, [lectures]);

  const students = useMemo(() => report?.students ?? [], [report]);
  const filteredStudents = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.matricNo.toLowerCase().includes(q),
    );
  }, [students, studentQuery]);

  const belowTarget = students.filter((s) => s.percentage < threshold).length;
  const neverAttended = students.filter((s) => s.attended === 0).length;

  const doExport = async () => {
    if (!report) return;
    setExporting(true);
    try {
      await exportCourseReportExcel(report, lectures, {
        institutionName: settings?.institutionName ?? "SLAMS",
        threshold,
        filters,
      });
      toast.success("Course report downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (reportQ.isLoading && !report) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (reportQ.isError || !report) {
    return (
      <EmptyState
        icon={<BookOpen className="h-7 w-7" />}
        title="Course not found"
        description="This course may have been removed, or you may not have access to it."
        action={
          <Button asChild variant="outline">
            <Link to="/admin/courses">Back to all courses</Link>
          </Button>
        }
      />
    );
  }

  const { course, counts } = report;

  return (
    <RouteTransition>
      <PageHeader
        breadcrumb={
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/admin/courses" className="transition hover:text-foreground">
              All Courses
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="font-mono">{course.code}</span>
          </div>
        }
        title={`${course.code} — ${course.title}`}
        subtitle={[
          course.departmentName,
          course.facultyName,
          report.course.lecturerName
            ? `Lecturer: ${report.course.lecturerName}`
            : "No lecturer assigned",
          report.term ? `${report.term.name}` : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" asChild>
              <Link to="/admin/courses">
                <ArrowLeft className="mr-1.5 h-4 w-4" /> All courses
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void doExport()} disabled={exporting}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {exporting ? "Preparing…" : "Export to Excel"}
            </Button>
            <Button
              onClick={() =>
                window.open(
                  `/print?${filtersToQuery({ ...filters, courseId })}`,
                  "_blank",
                  "noopener",
                )
              }
            >
              <Printer className="mr-2 h-4 w-4" />
              Print / PDF
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Registered Students"
          value={students.length}
          icon={Users}
          hint={
            neverAttended > 0 ? `${neverAttended} never attended` : "All students have attended"
          }
          formula="Students on the course roster, including those who have not signed in yet."
        />
        <StatCard
          label="Lectures Held"
          value={report.totalSessions}
          icon={CalendarDays}
          hint="Started lectures in the selected period"
        />
        <StatCard
          label="Overall Attendance"
          value={report.weightedRate === null ? "—" : `${report.weightedRate}%`}
          icon={Percent}
          formula="attended opportunities ÷ expected opportunities across this course (brief §8)."
          hint={
            report.meanOfStudents !== null && report.meanOfStudents !== report.weightedRate
              ? `Mean of students: ${report.meanOfStudents}%`
              : "Opportunity-weighted"
          }
        />
        <StatCard
          label="Present / Late"
          value={`${counts.present} / ${counts.late}`}
          icon={UserCheck}
          hint={`${counts.excused} excused · ${counts.absent} absent`}
        />
        <StatCard
          label={`Students below ${threshold}%`}
          value={belowTarget}
          icon={TriangleAlert}
          trend={belowTarget > 0 ? "at risk of exclusion" : "none"}
          trendTone={belowTarget > 0 ? "down" : "up"}
        />
      </div>

      <Tabs
        value={search.tab ?? "lectures"}
        onValueChange={(value) => patch({ tab: value as CourseDetailSearch["tab"] })}
        className="mt-6"
      >
        <TabsList>
          <TabsTrigger value="lectures">By lecture ({lectures.length})</TabsTrigger>
          <TabsTrigger value="students">By student ({students.length})</TabsTrigger>
          <TabsTrigger value="trends">Weekly trends</TabsTrigger>
        </TabsList>

        {/* ── Per-lecture breakdown, with a selectable date ── */}
        <TabsContent value="lectures" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Lecture-by-lecture attendance</CardTitle>
              <span className="text-xs text-muted-foreground">
                Select a lecture to see who attended it
              </span>
            </CardHeader>
            <CardContent className="p-0">
              {lectures.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No lectures have run in this period yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Lecture date</TableHead>
                        <TableHead>Topic</TableHead>
                        <TableHead className="text-right">Expected</TableHead>
                        <TableHead className="text-right">Present</TableHead>
                        <TableHead className="text-right">Late</TableHead>
                        <TableHead className="text-right">Excused</TableHead>
                        <TableHead className="text-right">Absent</TableHead>
                        <TableHead className="text-right">Attendance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lectures.map((lecture, index) => {
                        const selected = search.session === lecture.sessionId;
                        return (
                          <TableRow
                            key={lecture.sessionId}
                            onClick={() =>
                              patch({ session: selected ? undefined : lecture.sessionId })
                            }
                            className={cn("cursor-pointer", selected && "bg-primary/5")}
                          >
                            <TableCell className="text-xs text-muted-foreground">
                              {index + 1}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2 text-sm">
                                <ChevronDown
                                  className={cn(
                                    "h-3.5 w-3.5 text-muted-foreground transition",
                                    selected ? "rotate-180" : "-rotate-90",
                                  )}
                                />
                                {formatDay(lecture.startedAt)}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground">
                              {lecture.topic ?? "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {lecture.expected}
                            </TableCell>
                            <TableCell className="text-right font-mono text-success">
                              {lecture.present}
                            </TableCell>
                            <TableCell className="text-right font-mono text-warning">
                              {lecture.late}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {lecture.excused}
                            </TableCell>
                            <TableCell className="text-right font-mono text-destructive">
                              {lecture.absent}
                            </TableCell>
                            <TableCell className="text-right">
                              <HealthBadge
                                health={
                                  lecture.rate === null
                                    ? null
                                    : lecture.rate >= threshold
                                      ? "good"
                                      : "at-risk"
                                }
                                rate={lecture.rate}
                                threshold={threshold}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {search.session && (
            <LectureAttendancePanel
              sessionId={search.session}
              courseId={courseId}
              onClose={() => patch({ session: undefined })}
            />
          )}
        </TabsContent>

        {/* ── Per-student history (brief §5 + §4's twelve columns) ── */}
        <TabsContent value="students" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">Student attendance</CardTitle>
              <Input
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="Filter by name or matric number…"
                className="sm:w-72"
                aria-label="Filter students"
              />
            </CardHeader>
            <CardContent className="p-0">
              {filteredStudents.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  {students.length === 0
                    ? "No students are enrolled in this course yet."
                    : "No student matches that filter."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Student</TableHead>
                        <TableHead>Matric no.</TableHead>
                        <TableHead className="text-right">Present</TableHead>
                        <TableHead className="text-right">Absent</TableHead>
                        <TableHead className="text-right">Late</TableHead>
                        <TableHead className="text-right">Excused</TableHead>
                        <TableHead className="text-right">Attended</TableHead>
                        <TableHead className="text-right">Expected</TableHead>
                        <TableHead className="text-right">%</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStudents.map((student, index) => (
                        <StudentRow
                          key={student.id}
                          index={index + 1}
                          student={student}
                          courseId={courseId}
                          threshold={threshold}
                          open={search.student === student.id}
                          onToggle={() =>
                            patch({
                              student: search.student === student.id ? undefined : student.id,
                            })
                          }
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Weekly trends + semester summary ── */}
        <TabsContent value="trends" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Weekly attendance rate</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {weekly.length === 0 ? (
                <p className="text-sm text-muted-foreground">No lectures to plot yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                      vertical={false}
                    />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <RechartsTooltip
                      formatter={(value: number) => [`${value}%`, "Attendance"]}
                      labelStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="rate" className="fill-primary" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cumulative rate over the semester</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {cumulative.length === 0 ? (
                <p className="text-sm text-muted-foreground">No lectures to plot yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cumulative} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                      vertical={false}
                    />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <RechartsTooltip
                      formatter={(value: number) => [`${value}%`, "Cumulative"]}
                      labelFormatter={(label) => String(label)}
                    />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      className="stroke-primary"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Semester summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryTile label="Lectures held" value={report.totalSessions} />
              <SummaryTile
                label="Expected opportunities"
                value={counts.expected ?? students.reduce((a, s) => a + s.expected, 0)}
                hint="Students on the roster for each lecture"
              />
              <SummaryTile
                label="Attended opportunities"
                value={counts.attended}
                hint={`${counts.present} present + ${counts.late} late`}
              />
              <SummaryTile
                label="Unmet opportunities"
                value={counts.absent}
                hint={`${counts.excused} excused`}
              />
              <SummaryTile label="Weighted rate" value={`${report.weightedRate ?? "—"}%`} />
              <SummaryTile
                label="Mean of student %"
                value={`${report.meanOfStudents ?? "—"}%`}
                hint="Shown for comparison — the official figure is the weighted rate"
              />
              <SummaryTile
                label="At-risk students"
                value={belowTarget}
                hint={`Below ${threshold}%`}
              />
              <SummaryTile
                label="Best student"
                value={
                  students[0]
                    ? `${students[0].name.split(" ")[0]} — ${students[0].percentage}%`
                    : "—"
                }
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </RouteTransition>
  );
}

/** "Mon 14 Oct 2025" — unambiguous for a printed or exported report. */
function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
      <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** The "select a lecture date" panel: who was present, absent, late, excused. */
function LectureAttendancePanel({
  sessionId,
  courseId,
  onClose,
}: {
  sessionId: string;
  courseId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => import("@/lib/api").then((m) => m.sessions.detail(sessionId)),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          Lecture on {formatDay(data?.session.startedAt ?? Date.now())}
          {data?.session.topic ? ` — ${data.session.topic}` : ""}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Matric no.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recorded at</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.attendance ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm">{row.name}</TableCell>
                    <TableCell className="font-mono text-xs">{row.matricNo}</TableCell>
                    <TableCell>
                      <StatusPill status={row.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.timestamp ? new Date(row.timestamp).toLocaleTimeString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.status === "absent"
                        ? "Auto-recorded absence"
                        : row.distanceMeters != null
                          ? `${Math.round(row.distanceMeters)} m from venue`
                          : row.evidence
                            ? `Device check: ${row.evidence.class}`
                            : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(data?.attendance ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="p-6 text-sm text-muted-foreground">
                      Nothing recorded for this lecture —{" "}
                      <Link
                        to="/admin/courses/$courseId"
                        params={{ courseId }}
                        className="underline"
                      >
                        check the roster
                      </Link>
                      .
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StudentRow({
  index,
  student,
  courseId,
  threshold,
  open,
  onToggle,
}: {
  index: number;
  student: CourseReportStudent;
  courseId: string;
  threshold: number;
  open: boolean;
  onToggle: () => void;
}) {
  const historyQ = useQuery({ ...courseStudentHistoryQO(courseId, student.id), enabled: open });
  return (
    <>
      <TableRow
        className={cn("cursor-pointer", open && "bg-primary/5")}
        onClick={onToggle}
        aria-expanded={open}
      >
        <TableCell className="text-xs text-muted-foreground">{index}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <ChevronDown
              className={cn("h-3.5 w-3.5 text-muted-foreground", !open && "-rotate-90")}
            />
            <span className="text-sm font-medium">{student.name}</span>
            {student.devices > 1 && (
              <Badge variant="outline" className="text-[10px]">
                {student.devices} devices
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="font-mono text-xs">{student.matricNo}</TableCell>
        <TableCell className="text-right font-mono text-success">{student.present}</TableCell>
        <TableCell className="text-right font-mono text-destructive">{student.absent}</TableCell>
        <TableCell className="text-right font-mono text-warning">{student.late}</TableCell>
        <TableCell className="text-right font-mono">{student.excused}</TableCell>
        <TableCell className="text-right font-mono">{student.attended}</TableCell>
        <TableCell className="text-right font-mono text-muted-foreground">
          {student.expected}
        </TableCell>
        <TableCell className="text-right font-mono font-semibold">{student.percentage}%</TableCell>
        <TableCell className="text-right">
          <HealthBadge
            health={student.percentage >= threshold ? "good" : "at-risk"}
            rate={student.percentage}
            threshold={threshold}
          />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={11} className="p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Lecture history — {student.name}
            </div>
            {historyQ.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">Present {historyQ.data?.summary.present ?? 0}</Badge>
                  <Badge variant="secondary">Late {historyQ.data?.summary.late ?? 0}</Badge>
                  <Badge variant="secondary">Excused {historyQ.data?.summary.excused ?? 0}</Badge>
                  <Badge variant="secondary">Absent {historyQ.data?.summary.absent ?? 0}</Badge>
                  <Badge variant="outline">
                    {student.attended}/{student.expected} = {student.percentage}%
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(historyQ.data?.rows ?? [])
                    .slice()
                    .sort((a, b) => a.startedAt - b.startedAt)
                    .map((row, i) => (
                      <span
                        key={row.id}
                        title={`${new Date(row.startedAt).toLocaleDateString()} — ${row.status}`}
                        className={cn(
                          "grid h-7 w-9 place-items-center rounded text-[10px] font-semibold uppercase",
                          row.status === "present" && "bg-success/20 text-success",
                          row.status === "late" && "bg-warning/20 text-warning",
                          row.status === "excused" && "bg-muted text-muted-foreground",
                          row.status === "absent" && "bg-destructive/15 text-destructive",
                        )}
                      >
                        {i + 1}·{row.status.slice(0, 1).toUpperCase()}
                      </span>
                    ))}
                </div>
              </>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "present"
      ? "bg-success/15 text-success"
      : status === "late"
        ? "bg-warning/15 text-warning"
        : status === "excused"
          ? "bg-muted text-muted-foreground"
          : "bg-destructive/12 text-destructive";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold capitalize", tone)}>
      {status}
    </span>
  );
}
