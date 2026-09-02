import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Download, FileBarChart, FileSpreadsheet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader, StatCard } from "@/components/AppShell";
import { Column, DataTable, SearchInput, useDebounced } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FacultyReport } from "../../shared/schemas";
import { api, errorMessage } from "@/lib/api";
import { useAtRiskThreshold } from "@/lib/useSiteSettings";

export const Route = createFileRoute("/admin/reports")({ component: ReportsPage });

type StudentRow = FacultyReport["students"][number];
type CourseRow = FacultyReport["courses"][number];

function ReportsPage() {
  const threshold = useAtRiskThreshold();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput);
  const [riskFilter, setRiskFilter] = useState<"all" | "at-risk">("all");
  const [exporting, setExporting] = useState(false);

  const query = useQuery({
    queryKey: ["admin", "reports", "faculty"],
    queryFn: () => api.facultyReport(),
  });

  const students = useMemo(() => {
    let rows = query.data?.students ?? [];
    if (search) {
      const needle = search.toLowerCase();
      rows = rows.filter(
        (student) =>
          student.name.toLowerCase().includes(needle) ||
          student.matricNo.toLowerCase().includes(needle),
      );
    }
    if (riskFilter === "at-risk") rows = rows.filter((student) => student.percentage < threshold);
    return rows;
  }, [query.data, search, riskFilter, threshold]);

  const atRiskCount = (query.data?.students ?? []).filter(
    (student) => student.percentage < threshold,
  ).length;

  const overallAverage = useMemo(() => {
    const rows = query.data?.students ?? [];
    if (rows.length === 0) return 0;
    return Math.round(rows.reduce((sum, s) => sum + s.percentage, 0) / rows.length);
  }, [query.data]);

  // The export libraries are heavy (jsPDF + xlsx ≈ 900 kB); load them only when
  // the user actually exports rather than in the initial bundle.
  const runExport = async (format: "pdf" | "excel") => {
    if (!query.data) return;
    setExporting(true);
    try {
      const { exportFacultyPDF, exportFacultyExcel } = await import("@/lib/exporters");
      if (format === "pdf") await exportFacultyPDF(query.data, threshold);
      else await exportFacultyExcel(query.data);
      toast.success(`Report exported as ${format === "pdf" ? "PDF" : "Excel"}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const studentColumns: Column<StudentRow>[] = [
    {
      key: "name",
      header: "Student",
      render: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "matric",
      header: "Matric no.",
      render: (row) => <span className="font-mono text-xs">{row.matricNo}</span>,
    },
    { key: "courses", header: "Courses", hideOnMobile: true, render: (row) => row.courses },
    {
      key: "attended",
      header: "Attended",
      hideOnMobile: true,
      render: (row) => `${row.attended} / ${row.total}`,
    },
    {
      key: "percentage",
      header: "Attendance",
      render: (row) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div
              className={row.percentage < threshold ? "h-full bg-destructive" : "h-full bg-primary"}
              style={{ width: `${Math.min(100, row.percentage)}%` }}
            />
          </div>
          <span
            className={
              row.percentage < threshold
                ? "font-semibold text-destructive"
                : "font-semibold text-foreground"
            }
          >
            {row.percentage}%
          </span>
        </div>
      ),
    },
  ];

  const courseColumns: Column<CourseRow>[] = [
    {
      key: "code",
      header: "Course",
      render: (row) => (
        <div>
          <span className="font-mono text-sm font-semibold text-primary">{row.code}</span>
          <span className="block truncate text-xs text-muted-foreground">{row.title}</span>
        </div>
      ),
    },
    { key: "enrolled", header: "Enrolled", render: (row) => row.enrolled },
    { key: "sessions", header: "Sessions", render: (row) => row.sessions },
    {
      key: "avg",
      header: "Average",
      render: (row) => (
        <Badge variant={row.avg < threshold ? "destructive" : "secondary"}>{row.avg}%</Badge>
      ),
    },
  ];

  return (
    <RouteTransition>
      <PageHeader
        title="Reports"
        subtitle="Faculty-wide attendance analysis and exports."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => runExport("pdf")}
              disabled={exporting || !query.data}
            >
              <Download className="mr-2 h-4 w-4" /> PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => runExport("excel")}
              disabled={exporting || !query.data}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
            </Button>
          </div>
        }
      />

      <QueryBoundary
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        onRetry={() => query.refetch()}
        loadingLabel="Building reports"
        isEmpty={(data) => data.courses.length === 0 && data.students.length === 0}
        empty={
          <EmptyState
            icon={<FileBarChart className="h-7 w-7" />}
            title="Nothing to report yet"
            description="Once courses have enrolled students and attendance sessions, analysis appears here."
          />
        }
      >
        {(data) => (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Tracked students" value={data.students.length} />
              <StatCard label="Average attendance" value={`${overallAverage}%`} />
              <StatCard
                label={`At risk (below ${threshold}%)`}
                value={atRiskCount}
                icon={AlertTriangle}
              />
            </div>

            <Tabs defaultValue="students" className="mt-8">
              <TabsList>
                <TabsTrigger value="students">By student</TabsTrigger>
                <TabsTrigger value="courses">By course</TabsTrigger>
              </TabsList>

              <TabsContent value="students" className="mt-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <SearchInput
                    value={searchInput}
                    onChange={setSearchInput}
                    placeholder="Search students"
                    label="Search students in report"
                  />
                  <Select
                    value={riskFilter}
                    onValueChange={(value) => setRiskFilter(value as "all" | "at-risk")}
                  >
                    <SelectTrigger className="w-full sm:w-48" aria-label="Filter by risk">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All students</SelectItem>
                      <SelectItem value="at-risk">At risk only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DataTable
                  columns={studentColumns}
                  rows={students}
                  getRowKey={(row) => row.id}
                  emptyState={
                    <EmptyState
                      icon={<FileBarChart className="h-7 w-7" />}
                      title="No students match"
                      description="Adjust your search or filter to see results."
                    />
                  }
                />
              </TabsContent>

              <TabsContent value="courses" className="mt-4">
                <DataTable
                  columns={courseColumns}
                  rows={data.courses}
                  getRowKey={(row) => row.id}
                  emptyState={
                    <EmptyState
                      icon={<FileBarChart className="h-7 w-7" />}
                      title="No courses yet"
                      description="Create courses to see per-course attendance."
                    />
                  }
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </QueryBoundary>
    </RouteTransition>
  );
}
