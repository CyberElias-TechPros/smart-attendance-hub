import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { courseReportQO, courseSessionsQO, coursesReportQO, requireRole } from "@/lib/queries";
import { normaliseFilters, describeFilters } from "@/lib/report-filters";
import { buildReportDataset, reportFileBase } from "@/lib/report-dataset";
import { exportReportPdf } from "@/lib/exporters/pdf-document";
import { reports as reportsApi } from "@/lib/api";
import { useSiteSettings } from "@/lib/useSiteSettings";
import type { ReportFilters } from "@/lib/types";

interface PrintSearch extends ReportFilters {
  auto?: "pdf";
}

/**
 * Print preview / PDF view (brief §7).
 *
 * Deliberately outside the admin shell: no sidebar, no top bar, A4-ish margins
 * and `thead` table headings that the browser repeats on every printed page.
 * Everything on this page comes from the same report endpoints the screen uses,
 * so "what you see is what prints" and both honour the current filters.
 */
export const Route = createFileRoute("/print")({
  validateSearch: (search: Record<string, unknown>): PrintSearch => ({
    ...normaliseFilters(search),
    auto: search.auto === "pdf" ? "pdf" : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const user = await requireRole(context, "admin");
    return { user };
  },
  component: PrintPage,
});

function PrintPage() {
  const search = Route.useSearch();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const { data: settings } = useSiteSettings();

  const filters = useMemo<ReportFilters>(() => {
    const { auto: _auto, ...rest } = search;
    void _auto;
    return rest;
  }, [search]);

  // Every matching course, not just the first page: a printed report is not
  // paginated by the screen's page size.
  const reportQ = useQuery(coursesReportQO({ ...filters, page: 1, pageSize: 500 }));
  const courseQ = useQuery({
    ...courseReportQO(filters.courseId ?? "", filters),
    enabled: Boolean(filters.courseId),
  });
  const lecturesQ = useQuery({
    ...courseSessionsQO(filters.courseId ?? "", filters),
    enabled: Boolean(filters.courseId),
  });

  const report = reportQ.data;
  const threshold = settings?.atRiskThreshold ?? 75;

  const dataset = useMemo(() => {
    if (!report) return null;
    const labels = describeFilters(filters, {
      session: report.meta.period.academicSession?.name,
      semester: report.meta.period.semester?.name,
      course: courseQ.data
        ? `${courseQ.data.course.code} — ${courseQ.data.course.title}`
        : undefined,
    });
    return buildReportDataset(report, {
      institutionName: settings?.institutionName ?? "SLAMS",
      logoUrl: settings?.logoUrl ?? undefined,
      footerNote: settings?.reportFooterNote ?? undefined,
      threshold,
      generatedBy: user.name,
      courseName: courseQ.data
        ? `${courseQ.data.course.code} — ${courseQ.data.course.title}`
        : undefined,
      courseReport: courseQ.data,
      lectures: lecturesQ.data,
      filterLabels: labels,
    });
  }, [report, courseQ.data, lecturesQ.data, filters, settings, threshold, user.name]);

  // Log the export once, after the data is in hand (brief §9: who took data out).
  useEffect(() => {
    if (!report) return;
    void reportsApi
      .logExport({
        format: "print",
        scope: dataset?.scope === "course" ? "course" : filters.courseId ? "course" : "all",
        courseId: filters.courseId,
        title: dataset?.title,
        rowCount: dataset?.rows.length,
        filters: Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v !== undefined && v !== null) as Array<
            [string, string | number | boolean]
          >,
        ),
      })
      .catch(() => undefined);
  }, [report, dataset, filters]);

  // `?auto=pdf` lets a button trigger the real PDF download in one click while
  // still landing the administrator on the preview.
  useEffect(() => {
    if (search.auto === "pdf" && dataset) {
      void exportReportPdf(dataset).catch(() => undefined);
      void navigate({ to: "/print", search: { ...filters, auto: undefined }, replace: true });
    }
  }, [search.auto, dataset, navigate, filters]);

  if (reportQ.isLoading || !dataset) {
    return <p className="p-10 text-sm text-muted-foreground">Preparing the report…</p>;
  }

  const { totals } = dataset;
  const average = (v: number | null, suffix = "") => (v === null ? "—" : `${v}${suffix}`);

  return (
    <div className="min-h-screen bg-white text-slate-900 print:bg-white">
      {/* Toolbar — never printed */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur print:hidden">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => window.close()}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Close preview
          </Button>
          <span className="text-sm text-muted-foreground">
            {dataset.rows.length} course{dataset.rows.length === 1 ? "" : "s"} ·{" "}
            {dataset.filterLabels.length ? dataset.filterLabels.join(" · ") : "no filters"}
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void exportReportPdf(dataset)}>
            <Download className="mr-1.5 h-4 w-4" /> Download PDF
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      {/* The report itself: A4 margins, repeated table headings, totals row */}
      <article className="mx-auto max-w-[210mm] px-10 py-8 print:max-w-none print:px-[12mm] print:py-[10mm]">
        <header className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-4">
          <div className="flex items-center gap-4">
            {dataset.logoUrl ? (
              <img src={dataset.logoUrl} alt="" className="h-14 w-14 object-contain" />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-lg bg-slate-900 text-lg font-bold text-white">
                {dataset.institution.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {dataset.institution}
              </h1>
              <p className="text-sm text-slate-600">{dataset.title}</p>
            </div>
          </div>
          <div className="text-right text-xs text-slate-600">
            <div className="font-medium text-slate-900">{dataset.periodLabel}</div>
            <div>Generated {new Date(dataset.generatedAt).toLocaleString()}</div>
            <div>By {dataset.generatedBy ?? user.name}</div>
          </div>
        </header>

        <section className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-slate-700 sm:grid-cols-3">
          <Meta label="Courses included" value={String(totals.courses)} />
          <Meta label="Students on rosters" value={String(totals.enrolled)} />
          <Meta label="Lectures held" value={String(totals.classesHeld)} />
          <Meta label="Present" value={String(totals.present)} />
          <Meta label="Late" value={String(totals.late)} />
          <Meta label="Absent" value={String(totals.absent)} />
          <Meta label="Excused" value={String(totals.excused)} />
          <Meta label="Overall attendance" value={average(totals.rate, "%")} />
          <Meta label={`Target`} value={`${dataset.threshold}%`} />
          {dataset.filterLabels.length > 0 && (
            <div className="col-span-2 sm:col-span-3">
              <span className="font-semibold">Filters applied: </span>
              {dataset.filterLabels.join(" · ")}
            </div>
          )}
        </section>

        <table className="mt-6 w-full border-collapse text-[11px]">
          <caption className="sr-only">
            Attendance summary per course with totals. Column headings repeat on every printed page.
          </caption>
          <thead>
            <tr className="bg-slate-900 text-left text-white">
              {[
                "#",
                "Course code",
                "Course title",
                "Department",
                "Students",
                "Classes held",
                "Classes attended",
                "Attendance %",
                "Present",
                "Absent",
                "Late",
              ].map((heading) => (
                <th key={heading} className="border border-slate-300 px-2 py-1.5 font-semibold">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataset.rows.map((row, index) => (
              <tr key={row.id} className="break-inside-avoid odd:bg-slate-50">
                <td className="border border-slate-300 px-2 py-1">{index + 1}</td>
                <td className="border border-slate-300 px-2 py-1 font-mono font-semibold">
                  {row.code}
                </td>
                <td className="border border-slate-300 px-2 py-1">{row.title}</td>
                <td className="border border-slate-300 px-2 py-1">{row.departmentCode ?? "—"}</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{row.enrolled}</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{row.classesHeld}</td>
                <td className="border border-slate-300 px-2 py-1 text-right">
                  {row.classesAttended}
                </td>
                <td className="border border-slate-300 px-2 py-1 text-right font-semibold">
                  {row.rate === null ? "—" : `${row.rate}%`}
                </td>
                <td className="border border-slate-300 px-2 py-1 text-right">{row.present}</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{row.absent}</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{row.late}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-200 font-semibold">
              <td className="border border-slate-300 px-2 py-1.5" colSpan={3}>
                TOTAL — {totals.courses} courses
              </td>
              <td className="border border-slate-300 px-2 py-1.5" />
              <td className="border border-slate-300 px-2 py-1.5 text-right">{totals.enrolled}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">
                {totals.classesHeld}
              </td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">
                {totals.classesAttended}
              </td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">
                {totals.rate === null ? "—" : `${totals.rate}%`}
              </td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">{totals.present}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">{totals.absent}</td>
              <td className="border border-slate-300 px-2 py-1.5 text-right">{totals.late}</td>
            </tr>
          </tfoot>
        </table>

        {dataset.course && (
          <>
            <h2 className="mt-8 border-b border-slate-300 pb-1 font-display text-lg font-semibold">
              {dataset.course.report.course.code} — {dataset.course.report.course.title}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              {[
                dataset.course.report.course.departmentName,
                dataset.course.report.course.facultyName,
                dataset.course.report.course.lecturerName
                  ? `Lecturer: ${dataset.course.report.course.lecturerName}`
                  : "No lecturer assigned",
                `Lectures held: ${dataset.course.report.totalSessions}`,
                `Overall attendance: ${
                  dataset.course.report.weightedRate === null
                    ? "—"
                    : `${dataset.course.report.weightedRate}%`
                }`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>

            <table className="mt-4 w-full border-collapse text-[11px]">
              <thead>
                <tr className="bg-slate-800 text-left text-white">
                  {[
                    "#",
                    "Student",
                    "Matric no.",
                    "Present",
                    "Absent",
                    "Late",
                    "Excused",
                    "Attended",
                    "Expected",
                    "%",
                  ].map((heading) => (
                    <th key={heading} className="border border-slate-300 px-2 py-1.5">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataset.course.report.students.map((student, index) => (
                  <tr key={student.id} className="break-inside-avoid odd:bg-slate-50">
                    <td className="border border-slate-300 px-2 py-1">{index + 1}</td>
                    <td className="border border-slate-300 px-2 py-1">{student.name}</td>
                    <td className="border border-slate-300 px-2 py-1 font-mono">
                      {student.matricNo}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-right">
                      {student.present}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-right">
                      {student.absent}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-right">{student.late}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right">
                      {student.excused}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-right">
                      {student.attended}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-right">
                      {student.expected}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-right font-semibold">
                      {student.percentage}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {lecturesQ.data && lecturesQ.data.length > 0 && (
              <table className="mt-6 w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-800 text-left text-white">
                    {["Lecture", "Date", "Topic", "Expected", "Present", "Late", "Absent", "%"].map(
                      (heading) => (
                        <th key={heading} className="border border-slate-300 px-2 py-1.5">
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lecturesQ.data.map((lecture, index) => (
                    <tr key={lecture.sessionId} className="break-inside-avoid odd:bg-slate-50">
                      <td className="border border-slate-300 px-2 py-1">{index + 1}</td>
                      <td className="border border-slate-300 px-2 py-1">
                        {new Date(lecture.startedAt).toLocaleDateString()}
                      </td>
                      <td className="border border-slate-300 px-2 py-1">{lecture.topic ?? "—"}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">
                        {lecture.expected}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-right">
                        {lecture.present}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-right">
                        {lecture.late}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-right">
                        {lecture.absent}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-right font-semibold">
                        {lecture.rate === null ? "—" : `${lecture.rate}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        <div className="mt-10 grid grid-cols-2 gap-12 text-xs">
          <div>
            <div className="border-t border-slate-400 pt-1">Prepared by (Examinations Officer)</div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-1">Approved by (Dean / HOD)</div>
          </div>
        </div>

        <footer className="mt-6 border-t border-slate-200 pt-2 text-[10px] text-slate-500">
          {dataset.footerNote ? <div>{dataset.footerNote}</div> : null}
          <div>
            {dataset.institution} · {reportFileBase(dataset.institution, dataset.scope)} ·
            Attendance computed from recorded lecture data (present + late ÷ expected
            opportunities).
          </div>
        </footer>
      </article>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-dotted border-slate-200 pb-0.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
