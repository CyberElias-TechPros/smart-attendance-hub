import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  GraduationCap,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";

import { PageHeader, StatCard } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { courseReportQO, coursesReportQO, examsQO, examDetailQO } from "@/lib/queries";
import { exams as examsApi } from "@/lib/api";
import { gradeFor, percentOf } from "@/lib/grades";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Exam, ExamKind } from "@/lib/types";

/**
 * Examinations (brief §2 sidebar, plan P4.3).
 *
 * Two jobs on one page, because they are two halves of the same task: schedule
 * the assessments for a course, then record the marks. Mark entry is a grid over
 * the roster with the current value pre-filled, saved as one batch — the same
 * shape as the spreadsheet registrars already keep.
 *
 * Everything here is lecturer-scoped server-side: a lecturer can only see and
 * mark the courses assigned to them, and only an administrator can publish
 * results to students.
 */
export const Route = createFileRoute("/admin/examinations")({
  component: ExaminationsPage,
});

const KINDS: Array<{ value: ExamKind; label: string }> = [
  { value: "ca", label: "Continuous assessment" },
  { value: "test", label: "Test" },
  { value: "exam", label: "Examination" },
  { value: "practical", label: "Practical" },
];

const ALL = "__all__";

function ExaminationsPage() {
  const qc = useQueryClient();
  const coursesQ = useQuery(coursesReportQO({ pageSize: 500 }));
  const [courseId, setCourseId] = useState<string>(ALL);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const examsQ = useQuery(examsQO(courseId === ALL ? {} : { courseId }));
  const exams = examsQ.data ?? [];

  const selectedExam = useMemo(
    () => exams.find((e) => e.id === selectedExamId) ?? exams[0],
    [exams, selectedExamId],
  );
  const detailQ = useQuery(examDetailQO(selectedExam?.id ?? ""));
  const reportQ = useQuery(courseReportQO(selectedExam?.courseId ?? "", {}));

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["exams"] });
    void qc.invalidateQueries({ queryKey: ["reports", "analytics"] });
  };

  const removeExam = useMutation({
    mutationFn: (id: string) => examsApi.remove(id),
    onSuccess: (res) => {
      toast.success(`Exam deleted — ${res.removed} mark(s) removed`);
      setSelectedExamId(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete the exam"),
  });

  const publish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      examsApi.update(id, { published }),
    onSuccess: (_res, vars) => {
      toast.success(vars.published ? "Results published to students" : "Results unpublished");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not publish"),
  });

  const rows = detailQ.data?.results ?? [];
  const roster = reportQ.data?.students ?? [];
  const maxScore = detailQ.data?.exam.maxScore ?? 100;
  const markedCount = rows.filter((r) => r.score != null).length;

  return (
    <RouteTransition>
      <PageHeader
        title="Examinations"
        subtitle="Schedule a course's assessments and record the marks. Scores are stored against the paper's own maximum, so re-weighting an assessment never rewrites a published grade."
        actions={
          <Button onClick={() => setCreateOpen(true)} disabled={coursesQ.data?.rows.length === 0}>
            <Plus className="mr-2 h-4 w-4" /> Schedule an assessment
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Assessments"
          value={exams.length}
          icon={ClipboardList}
          hint="In the current filter"
        />
        <StatCard
          label="Published"
          value={exams.filter((e) => e.published).length}
          icon={CheckCircle2}
          hint="Visible to students"
        />
        <StatCard
          label="Awaiting marks"
          value={exams.filter((e) => (e.marked ?? 0) === 0).length}
          icon={CalendarClock}
          hint="No score recorded yet"
        />
        <StatCard
          label="Courses with exams"
          value={new Set(exams.map((e) => e.courseId)).size}
          icon={GraduationCap}
          hint="Distinct courses"
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3">
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Course</span>
          <select
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              setSelectedExamId(null);
            }}
            className="rounded-lg border border-border/70 bg-background px-2 py-1.5 text-xs"
          >
            <option value={ALL}>All courses</option>
            {(coursesQ.data?.rows ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">
          {examsQ.isLoading ? "Loading…" : `${exams.length} assessment(s)`}
        </span>
      </div>

      {examsQ.isLoading && !examsQ.data && (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {!examsQ.isLoading && exams.length === 0 && (
        <EmptyState
          className="mt-4"
          icon={<ClipboardList className="h-7 w-7" />}
          title="No assessments scheduled"
          description="Schedule a continuous assessment, a test or the terminal examination for a course. Marks are entered against the roster, and publishing them notifies each student."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Schedule an assessment
            </Button>
          }
        />
      )}

      {exams.length > 0 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[22rem_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Assessments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {exams.map((exam) => {
                const active = selectedExam?.id === exam.id;
                return (
                  <button
                    key={exam.id}
                    onClick={() => setSelectedExamId(exam.id)}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2.5 text-left transition",
                      active
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/70 hover:border-primary/30",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold">
                        {exam.courseCode ?? "—"}
                      </span>
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {exam.kind}
                      </Badge>
                    </div>
                    <div className="mt-0.5 truncate text-sm font-medium" title={exam.title}>
                      {exam.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>
                        /{exam.maxScore}
                        {exam.weight ? ` · ${exam.weight}%` : ""}
                      </span>
                      <span>
                        {exam.marked ?? 0}/{exam.enrolled ?? 0} marked
                      </span>
                      {exam.scheduledAt && (
                        <span>{new Date(exam.scheduledAt).toLocaleDateString()}</span>
                      )}
                      {exam.published && <span className="text-success">published</span>}
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {selectedExam && (
            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{selectedExam.title}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedExam.courseCode} · {selectedExam.courseTitle} · maximum{" "}
                    {selectedExam.maxScore}
                    {selectedExam.weight ? ` · weight ${selectedExam.weight}%` : ""}
                    {selectedExam.room ? ` · ${selectedExam.room}` : ""}
                    {selectedExam.scheduledAt
                      ? ` · ${new Date(selectedExam.scheduledAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      publish.mutate({ id: selectedExam.id, published: !selectedExam.published })
                    }
                    disabled={publish.isPending}
                  >
                    {selectedExam.published ? "Unpublish" : "Publish results"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeExam.mutate(selectedExam.id)}
                    disabled={removeExam.isPending}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {detailQ.isLoading && <Skeleton className="h-40 w-full" />}
                {detailQ.data && (
                  <MarkSheet
                    examId={selectedExam.id}
                    maxScore={selectedExam.maxScore}
                    roster={roster}
                    existing={detailQ.data.results}
                    markedCount={markedCount}
                    onSaved={invalidate}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Attendance and performance are joined on the{" "}
        <Link to="/admin/results" className="text-primary underline-offset-4 hover:underline">
          Results
        </Link>{" "}
        page — including which students the attendance policy puts at risk of being barred.
      </p>

      <CreateExamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        courses={coursesQ.data?.rows ?? []}
        onCreated={(exam) => {
          setSelectedExamId(exam.id);
          invalidate();
        }}
      />
    </RouteTransition>
  );
}

/** The mark grid: roster × one assessment, saved as a single batch. */
function MarkSheet({
  examId,
  maxScore,
  roster,
  existing,
  markedCount,
  onSaved,
}: {
  examId: string;
  maxScore: number;
  roster: Array<{ id: string; name: string; matricNo: string; percentage: number }>;
  existing: Array<{ studentId: string; score: number | null; grade?: string }>;
  markedCount: number;
  onSaved: () => void;
}) {
  const initial = useMemo(() => {
    const map = new Map(existing.map((r) => [r.studentId, r.score]));
    const out: Record<string, string> = {};
    for (const student of roster) {
      const score = map.get(student.id);
      out[student.id] = score == null ? "" : String(score);
    }
    return out;
  }, [existing, roster]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [dirty, setDirty] = useState(false);

  // Re-seed when a different exam (or a refreshed roster) arrives.
  const seedKey = `${examId}:${roster.length}:${existing.length}`;
  const [seenKey, setSeenKey] = useState(seedKey);
  if (seenKey !== seedKey) {
    setSeenKey(seedKey);
    setValues(initial);
    setDirty(false);
  }

  const save = useMutation({
    mutationFn: () =>
      examsApi.saveResults(
        examId,
        roster.map((student) => {
          const raw = values[student.id]?.trim() ?? "";
          // An empty box clears the mark; it is never silently a zero.
          return { studentId: student.id, score: raw === "" ? null : Number(raw) };
        }),
      ),
    onSuccess: (res) => {
      toast.success(`${res.saved} mark(s) saved${res.cleared ? `, ${res.cleared} cleared` : ""}`);
      setDirty(false);
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the marks"),
  });

  const invalid = Object.entries(values).filter(([, v]) => {
    if (v.trim() === "") return false;
    const n = Number(v);
    return !Number.isFinite(n) || n < 0 || n > maxScore;
  });

  const classAverage = useMemo(() => {
    const nums = Object.values(values)
      .map((v) => (v.trim() === "" ? null : Number(v)))
      .filter((n): n is number => n != null && Number.isFinite(n));
    if (nums.length === 0) return null;
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return percentOf(mean, maxScore);
  }, [values, maxScore]);

  const fillAll = (value: string) => {
    const next: Record<string, string> = {};
    for (const student of roster) next[student.id] = value;
    setValues(next);
    setDirty(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Badge variant="secondary">
          {markedCount}/{roster.length} marked
        </Badge>
        {classAverage != null && (
          <span className="text-muted-foreground">
            Class average <span className="font-mono text-foreground">{classAverage}%</span> (
            {gradeFor((classAverage / 100) * maxScore, maxScore)})
          </span>
        )}
        {invalid.length > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <TriangleAlert className="h-3.5 w-3.5" />
            {invalid.length} value(s) outside 0–{maxScore}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => fillAll(String(maxScore))}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Fill full marks
          </Button>
          <Button variant="ghost" size="sm" onClick={() => fillAll("")}>
            Clear all
          </Button>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={!dirty || invalid.length > 0 || save.isPending}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {save.isPending ? "Saving…" : "Save marks"}
          </Button>
        </div>
      </div>

      {roster.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          This course has no enrolled students yet, so there is nothing to mark. Enrol a roster from{" "}
          <Link to="/admin/courses" className="text-primary underline-offset-4 hover:underline">
            All Courses
          </Link>
          .
        </p>
      ) : (
        <div className="max-h-[30rem] overflow-auto rounded-xl border border-border/70">
          <Table>
            <caption className="sr-only">
              Mark sheet: one row per enrolled student, with a score out of {maxScore}
            </caption>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead className="text-right">Attendance</TableHead>
                <TableHead className="w-32 text-right">Score /{maxScore}</TableHead>
                <TableHead className="w-16 text-right">%</TableHead>
                <TableHead className="w-14 text-right">Grade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roster.map((student) => {
                const raw = values[student.id] ?? "";
                const num = raw.trim() === "" ? null : Number(raw);
                const percent =
                  num == null || !Number.isFinite(num) ? null : percentOf(num, maxScore);
                const bad = num != null && (num < 0 || num > maxScore);
                return (
                  <TableRow key={student.id} className="hover:bg-muted/40">
                    <TableCell>
                      <div className="text-sm font-medium">{student.name}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {student.matricNo}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {student.percentage}%
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        inputMode="decimal"
                        value={raw}
                        onChange={(e) => {
                          setValues((v) => ({ ...v, [student.id]: e.target.value }));
                          setDirty(true);
                        }}
                        className={cn("h-8 w-24 text-right font-mono", bad && "border-destructive")}
                        aria-label={`Score for ${student.name}`}
                        aria-invalid={bad}
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {percent == null ? "—" : `${percent}%`}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {percent == null ? "—" : gradeFor(num, maxScore)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileSpreadsheet className="h-3.5 w-3.5" />
        Empty boxes clear a mark. A cleared mark is excluded from every average — it never counts as
        zero.
      </p>
    </div>
  );
}

function CreateExamDialog({
  open,
  onOpenChange,
  courses,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: Array<{ id: string; code: string; title: string }>;
  onCreated: (exam: Exam) => void;
}) {
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ExamKind>("ca");
  const [maxScore, setMaxScore] = useState("100");
  const [weight, setWeight] = useState("");
  const [scheduled, setScheduled] = useState("");
  const [duration, setDuration] = useState("60");
  const [room, setRoom] = useState("");

  const create = useMutation({
    mutationFn: () =>
      examsApi.create({
        courseId: courseId || courses[0]?.id || "",
        title: title.trim(),
        kind,
        maxScore: Number(maxScore) || 100,
        weight: weight.trim() === "" ? null : Number(weight),
        scheduledAt: scheduled ? new Date(scheduled).getTime() : null,
        durationMinutes: duration.trim() === "" ? null : Number(duration),
        room: room.trim() || undefined,
      }),
    onSuccess: (exam) => {
      toast.success(`${exam.title} scheduled`);
      onCreated(exam);
      onOpenChange(false);
      setTitle("");
      setWeight("");
      setScheduled("");
      setRoom("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not schedule the exam"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule an assessment</DialogTitle>
          <DialogDescription>
            Record the paper&apos;s own maximum — the percentage and grade are derived from the
            score against that maximum, so a 20-mark CA and a 100-mark exam are never confused.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="exam-course">Course</Label>
            <Select value={courseId || courses[0]?.id} onValueChange={setCourseId}>
              <SelectTrigger id="exam-course">
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

          <div className="space-y-1.5">
            <Label htmlFor="exam-title">Title</Label>
            <Input
              id="exam-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="First continuous assessment"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="exam-kind">Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ExamKind)}>
                <SelectTrigger id="exam-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-max">Maximum score</Label>
              <Input
                id="exam-max"
                inputMode="decimal"
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-weight">Weight %</Label>
              <Input
                id="exam-weight"
                inputMode="decimal"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="exam-when">Scheduled for</Label>
              <Input
                id="exam-when"
                type="datetime-local"
                value={scheduled}
                onChange={(e) => setScheduled(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-duration">Minutes</Label>
              <Input
                id="exam-duration"
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-room">Room</Label>
              <Input
                id="exam-room"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="LT-1"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || title.trim().length < 2 || courses.length === 0}
          >
            {create.isPending ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
