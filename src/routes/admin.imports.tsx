import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  Copy,
  Download,
  FileUp,
  ListChecks,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatCard } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { coursesQO, examsQO } from "@/lib/queries";
import { downloadImportTemplate, imports as importsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ImportApplyResult, ImportKind, ImportPreview } from "@/lib/types";

/**
 * Bulk imports (plan P5.4 / decision D8).
 *
 * Registrars keep their rosters and marks in spreadsheets, so the upgrade has to
 * be able to take a spreadsheet without asking them to retype it — and it has to
 * be safe to press the button twice. That is why this page is deliberately
 * two-step: the file is validated in full first (each row reported against its
 * line in the file), and only a clean file can be applied. Applying is one
 * all-or-nothing write, so a half-imported roster cannot exist.
 *
 * Duplicate rows are shown as skipped rather than failed: re-running yesterday's
 * file must not create a second account for anybody.
 */
export const Route = createFileRoute("/admin/imports")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Imports — SLAMS" }],
  }),
  component: ImportsPage,
});

const KINDS: Array<{
  kind: ImportKind;
  label: string;
  blurb: string;
  /** Enrolments and marks need a target; people do not. */
  target?: "course" | "exam";
  icon: typeof Users;
  columns: string;
}> = [
  {
    kind: "students",
    label: "Students",
    blurb: "Create student accounts from a roster.",
    icon: Users,
    columns: "Name, Email, Matric No, Department, Level",
  },
  {
    kind: "lecturers",
    label: "Lecturers / Staff",
    blurb: "Create staff accounts and place them in a department.",
    icon: BadgeCheck,
    columns: "Name, Email, Staff ID, Department",
  },
  {
    kind: "enrollments",
    label: "Enrolments",
    blurb: "Put students on a course by matric number.",
    target: "course",
    icon: ListChecks,
    columns: "Matric No",
  },
  {
    kind: "results",
    label: "Marks",
    blurb: "Record assessment scores against one paper.",
    target: "exam",
    icon: FileUp,
    columns: "Matric No, Score",
  },
];

function ImportsPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>("students");
  const [courseId, setCourseId] = useState("");
  const [examId, setExamId] = useState("");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [applied, setApplied] = useState<ImportApplyResult | null>(null);
  const [filter, setFilter] = useState<"all" | "problems">("problems");

  const active = KINDS.find((k) => k.kind === kind)!;

  const { data: courses = [] } = useQuery(coursesQO);
  const { data: exams = [] } = useQuery(examsQO(courseId ? { courseId } : {}));

  const courseExams = useMemo(
    () => (courseId ? exams.filter((e) => e.courseId === courseId) : exams),
    [exams, courseId],
  );

  const target = active.target === "course" ? courseId : active.target === "exam" ? examId : "n/a";
  const targetChosen = active.target ? Boolean(target) : true;

  const payload = () => ({
    kind,
    csv,
    courseId: active.target === "course" ? courseId : undefined,
    examId: active.target === "exam" ? examId : undefined,
  });

  const previewMutation = useMutation({
    mutationFn: () => importsApi.preview(payload()),
    onSuccess: (data) => {
      setPreview(data);
      setApplied(null);
      setFilter(data.summary.errors > 0 ? "problems" : "all");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const applyMutation = useMutation({
    mutationFn: () => importsApi.apply(payload()),
    onSuccess: (data) => {
      setApplied(data);
      setPreview(null);
      toast.success(
        `${data.created + data.linked + data.updated} row(s) written to the database` +
          (data.skipped ? `, ${data.skipped} skipped` : ""),
      );
      // The imported people/marks show up elsewhere in the product, so those
      // screens are refreshed rather than left holding a stale roster.
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["courses"] });
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      toast.error("That file is larger than 2 MB — split it and import in parts.");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    setPreview(null);
    setApplied(null);
  };

  const rows = preview
    ? filter === "problems"
      ? preview.rows.filter((r) => r.status !== "ok")
      : preview.rows
    : [];
  const shown = rows.slice(0, 300);
  const canPreview = csv.trim().length > 0 && targetChosen && !previewMutation.isPending;

  return (
    <RouteTransition>
      <PageHeader
        title="Bulk imports"
        subtitle="Bring rosters, staff lists, enrolments and marks in from a spreadsheet — validated line by line before anything is written."
      />

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        {/* ── Step 1: what, and which file ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">1. What are you importing?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {KINDS.map((option) => {
                const Icon = option.icon;
                const selected = option.kind === kind;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    onClick={() => {
                      setKind(option.kind);
                      setPreview(null);
                      setApplied(null);
                      setCsv("");
                      setFileName("");
                    }}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                      selected
                        ? "border-primary/60 bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                        selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {option.label}
                        {option.target ? (
                          <Badge variant="outline" className="text-[10px] font-normal">
                            needs a target
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {option.blurb}
                      </span>
                    </span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">2. The file</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">Expected columns</p>
                <p>{active.columns}</p>
                <p className="mt-2">
                  Column names are not case-sensitive, and department may be given as a code (CSC)
                  or a full name.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  void downloadImportTemplate(kind)
                    .then(() => toast.success(`${active.label} template downloaded`))
                    .catch((error: Error) => toast.error(error.message))
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Download CSV template
              </Button>

              {active.target ? (
                <div className="space-y-3">
                  {active.target === "course" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="import-course">Course</Label>
                      <Select
                        value={courseId}
                        onValueChange={(value) => {
                          setCourseId(value);
                          setExamId("");
                          setPreview(null);
                        }}
                      >
                        <SelectTrigger id="import-course">
                          <SelectValue placeholder="Choose a course" />
                        </SelectTrigger>
                        <SelectContent>
                          {courses.map((course) => (
                            <SelectItem key={course.id} value={course.id}>
                              {course.code} — {course.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {active.target === "exam" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="import-exam-course">Course</Label>
                        <Select
                          value={courseId}
                          onValueChange={(value) => {
                            setCourseId(value);
                            setExamId("");
                            setPreview(null);
                          }}
                        >
                          <SelectTrigger id="import-exam-course">
                            <SelectValue placeholder="Choose a course" />
                          </SelectTrigger>
                          <SelectContent>
                            {courses.map((course) => (
                              <SelectItem key={course.id} value={course.id}>
                                {course.code} — {course.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="import-exam">Assessment</Label>
                        <Select
                          value={examId}
                          onValueChange={(value) => {
                            setExamId(value);
                            setPreview(null);
                          }}
                          disabled={!courseId}
                        >
                          <SelectTrigger id="import-exam">
                            <SelectValue
                              placeholder={
                                courseId ? "Choose an assessment" : "Pick a course first"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {courseExams.map((exam) => (
                              <SelectItem key={exam.id} value={exam.id}>
                                {exam.title} (max {exam.maxScore})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="import-file">CSV file</Label>
                <Input
                  id="import-file"
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void onFile(event.target.files?.[0])}
                />
                {fileName ? (
                  <p className="text-xs text-muted-foreground">
                    {fileName} — {csv.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "").length - 1}{" "}
                    data row(s)
                  </p>
                ) : null}
              </div>

              <Button
                className="w-full"
                disabled={!canPreview}
                onClick={() => previewMutation.mutate()}
              >
                <Upload className="mr-2 h-4 w-4" />
                {previewMutation.isPending ? "Checking…" : "Check the file"}
              </Button>
              {!targetChosen ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Choose the {active.target === "course" ? "course" : "assessment"} this file
                  belongs to first.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* ── Step 2: the report, then the write ── */}
        <div className="space-y-4">
          {applied ? (
            <Card className="border-emerald-500/40 bg-emerald-500/5">
              <CardContent className="flex flex-wrap items-center gap-6 p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <BadgeCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">Import applied</p>
                    <p className="text-xs text-muted-foreground">
                      Written as one transaction — either all of it, or none of it.
                    </p>
                  </div>
                </div>
                <dl className="flex flex-wrap gap-6 text-sm">
                  {[
                    ["Created", applied.created],
                    ["Linked", applied.linked],
                    ["Updated", applied.updated],
                    ["Skipped", applied.skipped],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="font-display text-xl">{value as number}</dd>
                    </div>
                  ))}
                </dl>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setApplied(null);
                    setCsv("");
                    setFileName("");
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  Import another file
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {!preview && !applied ? (
            <EmptyState
              icon={<FileUp className="h-6 w-6" />}
              title="No file checked yet"
              description="Pick what you are importing, choose the CSV, then check it. Nothing touches the database until you press Apply."
            />
          ) : null}

          {preview ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Rows in file" value={preview.summary.total} icon={ListChecks} />
                <StatCard
                  label="Ready to import"
                  value={preview.summary.valid}
                  icon={BadgeCheck}
                  hint="Rows that will be written"
                />
                <StatCard
                  label="Already there"
                  value={preview.summary.duplicates}
                  icon={Copy}
                  hint="Skipped, never duplicated"
                />
                <StatCard
                  label="Problems"
                  value={preview.summary.errors}
                  icon={CircleAlert}
                  hint={preview.summary.errors ? "The file must be fixed first" : "None"}
                />
              </div>

              <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
                  <CardTitle className="text-base">
                    Row report
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      line numbers match your file
                    </span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={filter === "problems" ? "default" : "outline"}
                      onClick={() => setFilter("problems")}
                    >
                      Problems ({preview.summary.errors + preview.summary.duplicates})
                    </Button>
                    <Button
                      size="sm"
                      variant={filter === "all" ? "default" : "outline"}
                      onClick={() => setFilter("all")}
                    >
                      All rows ({preview.summary.total})
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {preview.header.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Columns found:{" "}
                      <span className="font-medium text-foreground">
                        {preview.header.join(", ")}
                      </span>
                    </p>
                  ) : null}

                  {shown.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      Nothing to show — every row is ready to import.
                    </p>
                  ) : (
                    <div className="max-h-[26rem] overflow-auto rounded-xl border border-border">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-card">
                          <TableRow>
                            <TableHead className="w-16">Line</TableHead>
                            <TableHead>Row</TableHead>
                            <TableHead className="w-28">Status</TableHead>
                            <TableHead>Detail</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {shown.map((row) => (
                            <TableRow key={`${row.line}-${row.label}`}>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {row.line}
                              </TableCell>
                              <TableCell className="max-w-[16rem] truncate text-sm">
                                {row.label}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={row.status === "error" ? "destructive" : "outline"}
                                  className={cn(
                                    "text-[11px]",
                                    row.status === "ok" &&
                                      "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
                                    row.status === "duplicate" &&
                                      "border-amber-500/40 text-amber-600 dark:text-amber-400",
                                  )}
                                >
                                  {row.status === "ok"
                                    ? "Ready"
                                    : row.status === "duplicate"
                                      ? "Skipped"
                                      : "Problem"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {row.message ?? "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {rows.length > shown.length ? (
                        <p className="border-t border-border p-2 text-center text-xs text-muted-foreground">
                          Showing the first {shown.length} of {rows.length} rows — the check itself
                          covered all of them.
                        </p>
                      ) : null}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      disabled={!preview.ready || applyMutation.isPending}
                      onClick={() => applyMutation.mutate()}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {applyMutation.isPending
                        ? "Writing…"
                        : `Apply ${preview.summary.valid} row(s)`}
                    </Button>
                    {!preview.ready ? (
                      <p className="text-xs text-destructive">
                        {preview.summary.errors > 0
                          ? "Fix the problems above and check the file again — an import with errors writes nothing."
                          : "There is nothing new to write."}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {preview.summary.duplicates > 0
                          ? `${preview.summary.duplicates} existing row(s) will be left as they are.`
                          : "No duplicates found."}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </RouteTransition>
  );
}
