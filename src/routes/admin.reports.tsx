import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileDown, FileSpreadsheet, Loader2, Printer, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, HealthBadge, StatCard } from "@/components/AppShell";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { reports } from "@/lib/api";
import { courseReportQO, courseSessionsQO, coursesQO, coursesReportQO } from "@/lib/queries";
import { exportCourseReportExcel } from "@/lib/exporters";
import { filtersToQuery } from "@/lib/report-filters";
import { useSiteSettings } from "@/lib/useSiteSettings";
import type { ReportFilters } from "@/lib/types";

export const Route = createFileRoute("/admin/reports")({
  beforeLoad: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(coursesQO),
      context.queryClient.ensureQueryData(coursesReportQO({ pageSize: 500 })),
    ]);
  },
  component: ReportsPage,
});

/**
 * Course-level reports.
 *
 * The percentages here are the server's: `weightedRate` is Σ(present + late) ÷
 * Σ expected opportunities. The page used to average the students' individual
 * percentages, which silently over-weighted small cohorts — a 3-student course
 * carried the same weight as a 400-student one. The mean is still displayed,
 * but labelled for what it is (plan P0.5 / brief §8).
 */
function ReportsPage() {
  const { data: all } = useQuery(coursesQO);
  const { data: settings } = useSiteSettings();
  const courses = all ?? [];
  const [courseId, setCourseId] = useState<string>("");
  const activeId = courseId || courses[0]?.id || "";
  const threshold = settings?.atRiskThreshold ?? 75;

  const filters: ReportFilters = {};
  const reportQ = useQuery({ ...courseReportQO(activeId, filters), enabled: Boolean(activeId) });
  const lecturesQ = useQuery({
    ...courseSessionsQO(activeId, filters),
    enabled: Boolean(activeId),
  });
  const catalogueQ = useQuery(coursesReportQO({ courseId: activeId || undefined, pageSize: 1 }));

  const report = reportQ.data;

  const doExport = async (kind: "excel" | "pdf") => {
    if (!report) return;
    try {
      if (kind === "excel") {
        await exportCourseReportExcel(report, lecturesQ.data ?? [], {
          institutionName: settings?.institutionName ?? "SLAMS",
          threshold,
          filters,
        });
        void reports
          .logExport({
            format: "xlsx",
            scope: "course",
            courseId: activeId,
            title: report.course.code,
          })
          .catch(() => undefined);
        toast.success("Course workbook downloaded");
      } else {
        window.open(`/print?${filtersToQuery({ courseId: activeId })}`, "_blank", "noopener");
        toast.success("Opening the print / PDF view");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  const mean = report?.meanOfStudents ?? null;
  const weighted = report?.weightedRate ?? null;

  return (
    <RouteTransition>
      <PageHeader
        title="Reports"
        subtitle="Per-course attendance with per-student detail, Excel workbook and print/PDF export."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/admin/courses">
                <FileSpreadsheet className="mr-2 h-4 w-4" /> All Courses table
              </Link>
            </Button>
            <Button variant="outline" disabled={!report} onClick={() => void doExport("excel")}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
            </Button>
            <Button disabled={!report} onClick={() => void doExport("pdf")}>
              <Printer className="mr-2 h-4 w-4" /> Print / PDF
            </Button>
          </div>
        }
      />

      <div className="mb-4 max-w-md">
        <Select value={activeId} onValueChange={setCourseId}>
          <SelectTrigger aria-label="Choose a course">
            <SelectValue placeholder="Choose a course" />
          </SelectTrigger>
          <SelectContent>
            {courses.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.code} — {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {courses.length === 0 && (
        <div className="rounded-2xl border border-border/70 bg-card p-10 text-center text-sm text-muted-foreground">
          Create a course first to see reports.
        </div>
      )}

      {reportQ.isLoading && (
        <div className="grid h-40 place-items-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {reportQ.isError && (
        <div className="grid h-40 place-items-center text-sm text-destructive">
          Failed to load the report.{" "}
          {reportQ.error instanceof Error ? reportQ.error.message : "Please try again."}
        </div>
      )}

      {report && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Course"
              value={report.course.code}
              hint={report.course.title}
              icon={FileDown}
            />
            <StatCard
              label="Lectures held"
              value={report.totalSessions}
              hint={`${report.students.length} students registered`}
              icon={Users}
            />
            <StatCard
              label="Overall attendance"
              value={weighted === null ? "—" : `${weighted}%`}
              icon={ShieldCheck}
              formula="Σ (present + late) ÷ Σ expected opportunities across this course (brief §8)."
              hint={
                mean !== null && weighted !== null && mean !== weighted
                  ? `Mean of students: ${mean}% — not used`
                  : "Opportunity-weighted"
              }
              trend={weighted !== null && weighted < threshold ? "below target" : "on target"}
              trendTone={weighted !== null && weighted < threshold ? "down" : "up"}
            />
            <StatCard
              label="Tally"
              value={`${report.counts.present + report.counts.late}`}
              hint={`${report.counts.present} present · ${report.counts.late} late · ${report.counts.excused} excused · ${report.counts.absent} absent`}
              icon={ShieldCheck}
            />
          </div>

          {catalogueQ.data && catalogueQ.data.rows[0] && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <Badge variant="secondary">{catalogueQ.data.rows[0].classesHeld} lectures held</Badge>
              <Badge variant="secondary">
                {catalogueQ.data.rows[0].enrolled} registered students
              </Badge>
              <span>
                Period: {catalogueQ.data.meta.period.semester?.name ?? "all semesters"} ·{" "}
                {catalogueQ.data.meta.period.academicSession?.name ?? "all sessions"}
              </span>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elegant">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Matric</TableHead>
                  <TableHead className="text-right">Present</TableHead>
                  <TableHead className="text-right">Absent</TableHead>
                  <TableHead className="text-right">Late</TableHead>
                  <TableHead className="text-right">Excused</TableHead>
                  <TableHead className="text-right">Attended</TableHead>
                  <TableHead className="w-56">Attendance %</TableHead>
                  <TableHead
                    className="text-right"
                    title="Distinct devices this student signed in from. More than one is worth a look."
                  >
                    Devices
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="font-mono text-xs">{s.matricNo}</TableCell>
                    <TableCell className="text-right font-mono text-success">{s.present}</TableCell>
                    <TableCell className="text-right font-mono text-destructive">
                      {s.absent}
                    </TableCell>
                    <TableCell className="text-right font-mono text-warning">{s.late}</TableCell>
                    <TableCell className="text-right font-mono">{s.excused}</TableCell>
                    <TableCell className="text-right font-mono">
                      {s.attended} / {s.expected}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Progress value={s.percentage} className="h-2" />
                        <span className="w-12 shrink-0 text-right">
                          <HealthBadge
                            health={s.percentage >= threshold ? "good" : "at-risk"}
                            rate={s.percentage}
                            threshold={threshold}
                          />
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {s.devices > 1 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 font-mono text-xs font-semibold text-warning"
                          title={`${s.name} signed in from ${s.devices} different devices`}
                        >
                          {s.devices} (!)
                        </span>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">
                          {s.devices || "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {report.students.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      No students enrolled in this course.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Every correction is recorded in the{" "}
            <Link to="/admin/audit" className="underline">
              audit trail
            </Link>{" "}
            with the reason, the author and the time. Attendance is counted from recorded lectures
            only; a lecture that has not started yet is never in these figures.
          </p>
        </div>
      )}
    </RouteTransition>
  );
}
