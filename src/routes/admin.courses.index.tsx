import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileSpreadsheet,
  FileText,
  Layers,
  Users,
  Percent,
  CalendarCheck,
  TriangleAlert,
} from "lucide-react";

import { PageHeader, HealthBadge, StatCard } from "@/components/AppShell";
import { FilterBar } from "@/components/reports/FilterBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { RouteTransition } from "@/components/RouteTransition";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { coursesReportQO, deptsQO, facultiesQO, usersQO } from "@/lib/queries";
import { cleanFilters, filtersToQuery, normaliseFilters } from "@/lib/report-filters";
import { useSiteSettings } from "@/lib/useSiteSettings";
import { exportCoursesExcel } from "@/lib/exporters";
import type { ReportFilters, ReportSortKey } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** The filters travel in the URL, so a filtered view is shareable, survives a
 *  refresh, and is exactly what an export receives (brief §6 + §7). */
export const Route = createFileRoute("/admin/courses/")({
  validateSearch: (search: Record<string, unknown>): ReportFilters => normaliseFilters(search),
  component: AllCoursesPage,
});

const COLUMNS: Array<{
  key: ReportSortKey | "index" | "actions";
  label: string;
  align?: "right";
  hint?: string;
  sortable?: boolean;
}> = [
  { key: "index", label: "#" },
  { key: "code", label: "Course Code", sortable: true },
  { key: "title", label: "Course Title", sortable: true },
  { key: "department", label: "Department", sortable: true },
  { key: "enrolled", label: "Students", align: "right", sortable: true },
  {
    key: "classesHeld",
    label: "Classes Held",
    align: "right",
    sortable: true,
    hint: "Lectures that actually ran in the selected period.",
  },
  {
    key: "classesAttended",
    label: "Classes Attended",
    align: "right",
    sortable: true,
    hint: "Average lectures attended per student — the attendance rate applied to the lectures held.",
  },
  { key: "rate", label: "Attendance", align: "right", sortable: true },
  {
    key: "present",
    label: "Present",
    align: "right",
    sortable: true,
    hint: "Total present sign-ins across every student and lecture.",
  },
  { key: "absent", label: "Absent", align: "right", sortable: true },
  { key: "late", label: "Late", align: "right", sortable: true },
  { key: "actions", label: "Action", align: "right" },
];

function AllCoursesPage() {
  const filters = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: settings } = useSiteSettings();
  const [exporting, setExporting] = useState<null | "excel" | "pdf">(null);

  const reportQ = useQuery(coursesReportQO(filters));
  const facultiesQ = useQuery(facultiesQO);
  const deptsQ = useQuery(deptsQO);
  const lecturersQ = useQuery(usersQO("lecturer"));
  const report = reportQ.data;

  const patch = (next: Partial<ReportFilters>) =>
    void navigate({ to: "/admin/courses", search: cleanFilters({ ...filters, ...next }) });

  const reset = () => void navigate({ to: "/admin/courses", search: {} });
  const toggleSort = (key: ReportSortKey) =>
    patch({
      sort: key,
      dir: filters.sort === key && filters.dir !== "desc" ? "desc" : "asc",
      page: 1,
    });

  const page = report?.page ?? 1;
  const pageSize = report?.pageSize ?? 25;
  const total = report?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  const totals = report?.totals;
  const threshold = report?.meta.threshold ?? settings?.atRiskThreshold ?? 75;

  const atRiskCourses = useMemo(
    () => (report?.rows ?? []).filter((r) => (r.rate ?? 100) < threshold).length,
    [report?.rows, threshold],
  );

  const doExport = async (kind: "excel" | "pdf") => {
    if (!report) return;
    setExporting(kind);
    try {
      if (kind === "excel") {
        await exportCoursesExcel(report, {
          institutionName: settings?.institutionName ?? "SLAMS",
          threshold,
        });
        toast.success("Excel report downloaded");
      } else {
        // Print preview first (repeated headings, page margins, sign-off block);
        // the preview offers both the browser's print dialog and a real PDF
        // download drawn with jsPDF (numbered pages).
        window.open(`/print?${filtersToQuery(filters)}`, "_blank", "noopener");
      }
      qc.invalidateQueries({ queryKey: ["audit"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  return (
    <RouteTransition>
      <PageHeader
        title="All Courses — Attendance Management"
        subtitle="Every course in the institution, with attendance computed from real lecture records."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void doExport("excel")}
              disabled={exporting !== null || !report || report.rows.length === 0}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              {exporting === "excel" ? "Preparing…" : "Export to Excel"}
            </Button>
            <Button
              onClick={() => void doExport("pdf")}
              disabled={exporting !== null || !report || report.rows.length === 0}
            >
              <FileText className="mr-2 h-4 w-4" />
              Print / Export to PDF
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total Courses"
          value={totals?.courses ?? 0}
          icon={BookOpen}
          hint={report?.meta.period.semester?.name ?? "All periods"}
        />
        <StatCard
          label="Registered Students"
          value={totals?.enrolled ?? 0}
          icon={Users}
          hint="Across the filtered courses"
        />
        <StatCard
          label="Classes Held"
          value={totals?.classesHeld ?? 0}
          icon={CalendarCheck}
          hint="Lectures that ran"
        />
        <StatCard
          label="Overall Attendance"
          value={totals?.rate === null || totals?.rate === undefined ? "—" : `${totals.rate}%`}
          icon={Percent}
          formula="Attended opportunities ÷ all expected opportunities across the filtered courses (opportunity-weighted, not an average of course percentages)."
          hint="Weighted across courses"
        />
        <StatCard
          label="Courses below target"
          value={atRiskCourses}
          icon={TriangleAlert}
          hint={`Below ${threshold}%`}
          trendTone={atRiskCourses > 0 ? "down" : "up"}
          trend={atRiskCourses > 0 ? "needs attention" : "all on track"}
        />
      </div>

      <div className="mt-6">
        <FilterBar
          filters={filters}
          onChange={patch}
          onReset={reset}
          faculties={facultiesQ.data ?? []}
          departments={deptsQ.data ?? []}
          lecturers={lecturersQ.data ?? []}
          period={{
            semesterName: report?.meta.period.semester?.name,
            finalized: Boolean(report?.meta.period.semester?.finalizedAt),
          }}
          resultCount={reportQ.isLoading ? undefined : total}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elegant">
        {reportQ.isError && (
          <div className="p-8 text-center text-sm text-destructive">
            Could not load the report.{" "}
            {reportQ.error instanceof Error ? reportQ.error.message : "Please retry."}
          </div>
        )}

        {reportQ.isLoading && !report && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {report && report.rows.length === 0 && (
          <EmptyState
            className="m-4"
            icon={<Layers className="h-7 w-7" />}
            title="No courses match these filters"
            description="Adjust or reset the filters above. If the institution has no courses yet, create the first one in Manage Courses."
            action={
              <Button variant="outline" onClick={reset}>
                Reset filters
              </Button>
            }
          />
        )}

        {report && report.rows.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">
                Attendance per course: students, classes held and attended, attendance rate, and
                present, absent and late totals.
              </caption>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  {COLUMNS.map((col) => (
                    <TableHead
                      key={col.key}
                      className={cn(col.align === "right" && "text-right")}
                      title={col.hint}
                      aria-sort={
                        filters.sort === col.key
                          ? filters.dir === "desc"
                            ? "descending"
                            : "ascending"
                          : undefined
                      }
                    >
                      {col.sortable ? (
                        <button
                          onClick={() => toggleSort(col.key as ReportSortKey)}
                          className={cn(
                            "inline-flex items-center gap-1 transition hover:text-foreground",
                            filters.sort === col.key && "text-foreground",
                          )}
                        >
                          {col.label}
                          {filters.sort === col.key ? (
                            filters.dir === "desc" ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <ArrowUp className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        col.label
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row, index) => (
                  <TableRow key={row.id} className="hover:bg-muted/40">
                    <TableCell className="text-xs text-muted-foreground">
                      {(page - 1) * pageSize + index + 1}
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{row.code}</TableCell>
                    <TableCell className="max-w-[18rem]">
                      <div className="truncate font-medium" title={row.title}>
                        {row.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {row.level} Level · {row.units} units
                        {row.lecturerName ? ` · ${row.lecturerName}` : " · no lecturer"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">{row.departmentCode ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {row.facultyName ?? row.departmentName ?? ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{row.enrolled}</TableCell>
                    <TableCell className="text-right font-mono">{row.classesHeld}</TableCell>
                    <TableCell className="text-right font-mono">{row.classesAttended}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden h-2 w-24 overflow-hidden rounded-full bg-muted sm:block">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              row.health === "good"
                                ? "bg-success"
                                : row.health === "watch"
                                  ? "bg-warning"
                                  : "bg-destructive",
                            )}
                            style={{ width: `${Math.min(100, Math.max(0, row.rate ?? 0))}%` }}
                          />
                        </div>
                        <HealthBadge health={row.health} rate={row.rate} threshold={threshold} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{row.present}</TableCell>
                    <TableCell className="text-right font-mono">{row.absent}</TableCell>
                    <TableCell className="text-right font-mono">{row.late}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/admin/courses/$courseId" params={{ courseId: row.id }}>
                          <Eye className="mr-1.5 h-3.5 w-3.5" /> View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <TableRow className="border-t-2 border-border bg-muted/30 font-semibold">
                  <TableCell />
                  <TableCell colSpan={3} className="text-xs uppercase tracking-widest">
                    Totals ({totals?.courses ?? 0} courses)
                  </TableCell>
                  <TableCell className="text-right font-mono">{totals?.enrolled ?? 0}</TableCell>
                  <TableCell className="text-right font-mono">{totals?.classesHeld ?? 0}</TableCell>
                  <TableCell className="text-right font-mono">
                    {totals?.classesAttended ?? 0}
                  </TableCell>
                  <TableCell className="text-right">
                    <HealthBadge
                      health={
                        totals?.rate === null || totals?.rate === undefined
                          ? null
                          : totals.rate >= threshold
                            ? "good"
                            : "at-risk"
                      }
                      rate={totals?.rate ?? null}
                      threshold={threshold}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono">{totals?.present ?? 0}</TableCell>
                  <TableCell className="text-right font-mono">{totals?.absent ?? 0}</TableCell>
                  <TableCell className="text-right font-mono">{totals?.late ?? 0}</TableCell>
                  <TableCell />
                </TableRow>
              </tfoot>
            </Table>
          </div>
        )}

        {report && total > pageSize && (
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
            <span>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => patch({ page: page - 1 })}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="font-mono">
                {page} / {lastPage}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage}
                onClick={() => patch({ page: page + 1 })}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">Opportunity-weighted</Badge>
        <span>
          Attendance = attended opportunities ÷ expected opportunities across the filtered courses.
          Present, absent, late and excused are counted independently, so the totals always
          reconcile with the underlying records.
        </span>
      </div>
    </RouteTransition>
  );
}
