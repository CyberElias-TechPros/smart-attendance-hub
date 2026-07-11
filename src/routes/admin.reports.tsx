import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useQuery } from "@tanstack/react-query";
import { listCourses, courseReport } from "@/lib/api.functions";
import { PageHeader } from "@/components/AppShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { FileDown, FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";
import { exportPDF, exportExcel } from "@/lib/exporters";
import { useAtRiskThreshold } from "@/lib/useSiteSettings";

const coursesQO = queryOptions({ queryKey: ["courses"], queryFn: () => listCourses() });

export const Route = createFileRoute("/admin/reports")({
  loader: ({ context }) => context.queryClient.ensureQueryData(coursesQO),
  component: ReportsPage,
});

function ReportsPage() {
  const { data: courses } = useSuspenseQuery(coursesQO);
  const threshold = useAtRiskThreshold();
  const [courseId, setCourseId] = useState<string>(courses[0]?.id ?? "");

  const reportQ = useQuery({
    queryKey: ["report", courseId],
    queryFn: () => courseReport({ data: { courseId } }),
    enabled: Boolean(courseId),
  });

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Course-level attendance breakdown with PDF & Excel export."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!reportQ.data}
              onClick={() => reportQ.data && exportPDF(reportQ.data)}
            >
              <FileDown className="mr-2 h-4 w-4" /> PDF
            </Button>
            <Button
              disabled={!reportQ.data}
              onClick={() => reportQ.data && exportExcel(reportQ.data)}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
            </Button>
          </div>
        }
      />
      <div className="mb-4 max-w-md">
        <Select value={courseId} onValueChange={setCourseId}>
          <SelectTrigger><SelectValue placeholder="Choose a course" /></SelectTrigger>
          <SelectContent>
            {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {reportQ.isLoading && (
        <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      )}

      {reportQ.data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard label="Course" value={`${reportQ.data.course.code}`} sub={reportQ.data.course.title} />
            <SummaryCard label="Sessions held" value={String(reportQ.data.totalSessions)} sub={`${reportQ.data.students.length} students enrolled`} />
            <SummaryCard
              label="Average attendance"
              value={`${Math.round(reportQ.data.students.reduce((a, s) => a + s.percentage, 0) / Math.max(1, reportQ.data.students.length))}%`}
              sub="Across all enrolled"
            />
          </div>
          <div className="rounded-2xl border border-border/70 bg-card shadow-elegant">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Matric</TableHead>
                  <TableHead className="text-right">Attended</TableHead>
                  <TableHead className="w-64">Attendance %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportQ.data.students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="font-mono text-xs">{s.matricNo}</TableCell>
                    <TableCell className="text-right">{s.attended} / {reportQ.data!.totalSessions}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Progress value={s.percentage} className="h-2" />
                        <span className={s.percentage < threshold ? "text-destructive font-mono text-sm" : "font-mono text-sm"}>{s.percentage}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant">
      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
