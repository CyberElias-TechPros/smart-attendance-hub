import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Loader2, Pencil, Trash2, UserCheck, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SearchInput, useDebounced } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Course } from "../../shared/schemas";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { Field } from "./admin.students";

export const Route = createFileRoute("/admin/courses")({ component: CoursesPage });

const LEVELS = ["100", "200", "300", "400", "500"];
const UNASSIGNED = "__unassigned__";

interface FormState {
  id?: string;
  code: string;
  title: string;
  departmentId: string;
  level: string;
  units: number;
  description: string;
}

const emptyForm: FormState = {
  code: "",
  title: "",
  departmentId: "",
  level: "100",
  units: 3,
  description: "",
};

function CoursesPage() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);
  const [enrollTarget, setEnrollTarget] = useState<Course | null>(null);

  const coursesQuery = useQuery({ queryKey: ["courses"], queryFn: () => api.courses() });
  const departmentsQuery = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.departments(),
  });
  const lecturersQuery = useQuery({
    queryKey: ["admin", "lecturerOptions"],
    queryFn: () => api.lecturerOptions(),
  });

  const departments = departmentsQuery.data?.items ?? [];
  const lecturers = lecturersQuery.data?.items ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["courses"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
    queryClient.invalidateQueries({ queryKey: ["departments"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormState): Promise<void> => {
      const payload = {
        code: values.code,
        title: values.title,
        departmentId: values.departmentId,
        level: values.level,
        units: values.units,
        description: values.description || null,
      };
      if (values.id) await api.updateCourse({ ...payload, id: values.id });
      else await api.createCourse(payload);
    },
    onSuccess: (_data, values) => {
      toast.success(values.id ? "Course updated" : "Course created");
      setDialogOpen(false);
      setFieldErrors({});
      invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.fields) setFieldErrors(error.fields);
      toast.error(errorMessage(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCourse(id),
    onSuccess: () => {
      toast.success("Course deleted");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const assignMutation = useMutation({
    mutationFn: (input: { courseId: string; lecturerId: string | null }) =>
      api.assignLecturer(input),
    onSuccess: () => {
      toast.success("Lecturer updated");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openCreate = () => {
    setForm({ ...emptyForm, departmentId: departments[0]?.id ?? "" });
    setFieldErrors({});
    setDialogOpen(true);
  };

  const openEdit = (course: Course) => {
    setForm({
      id: course.id,
      code: course.code,
      title: course.title,
      departmentId: course.departmentId,
      level: course.level,
      units: course.units,
      description: course.description ?? "",
    });
    setFieldErrors({});
    setDialogOpen(true);
  };

  const filtered = useMemo(() => {
    const items = coursesQuery.data?.items ?? [];
    if (!search) return items;
    const needle = search.toLowerCase();
    return items.filter(
      (course) =>
        course.code.toLowerCase().includes(needle) ||
        course.title.toLowerCase().includes(needle) ||
        (course.departmentName ?? "").toLowerCase().includes(needle),
    );
  }, [coursesQuery.data, search]);

  const noDepartments = departmentsQuery.isSuccess && departments.length === 0;

  return (
    <RouteTransition>
      <PageHeader
        title="Courses"
        subtitle="Create courses, assign lecturers and manage enrolment."
        actions={
          <Button onClick={openCreate} disabled={noDepartments}>
            <BookOpen className="mr-2 h-4 w-4" /> New course
          </Button>
        }
      />

      {noDepartments && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          Create a department first — every course belongs to one.
        </div>
      )}

      <div className="mb-4">
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Search courses"
          label="Search courses"
        />
      </div>

      <QueryBoundary
        isLoading={coursesQuery.isPending}
        error={coursesQuery.error}
        data={filtered}
        onRetry={() => coursesQuery.refetch()}
        loadingLabel="Loading courses"
        isEmpty={(items) => items.length === 0}
        empty={
          <EmptyState
            icon={<BookOpen className="h-7 w-7" />}
            title={search ? "No matching courses" : "No courses yet"}
            description={
              search
                ? "Try a different course code or title."
                : "Create a course, assign a lecturer, then enrol students."
            }
            action={
              !search && (
                <Button onClick={openCreate} disabled={noDepartments}>
                  <BookOpen className="mr-2 h-4 w-4" /> New course
                </Button>
              )
            }
          />
        }
      >
        {(items) => (
          <div className="grid gap-4 lg:grid-cols-2">
            {items.map((course) => (
              <div
                key={course.id}
                className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-primary">
                        {course.code}
                      </span>
                      <Badge variant="secondary">{course.level} level</Badge>
                      <Badge variant="outline">
                        {course.units} unit{course.units === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <h2 className="mt-1 truncate font-display text-lg font-semibold">
                      {course.title}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {course.departmentName ?? "No department"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(course)}
                      aria-label={`Edit ${course.code}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(course)}
                      aria-label={`Delete ${course.code}`}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {course.description && (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                    {course.description}
                  </p>
                )}

                <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <label htmlFor={`lecturer-${course.id}`} className="sr-only">
                      Lecturer for {course.code}
                    </label>
                    <Select
                      value={course.lecturerId ?? UNASSIGNED}
                      onValueChange={(value) =>
                        assignMutation.mutate({
                          courseId: course.id,
                          lecturerId: value === UNASSIGNED ? null : value,
                        })
                      }
                    >
                      <SelectTrigger id={`lecturer-${course.id}`} className="h-9">
                        <SelectValue placeholder="Assign a lecturer" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {lecturers.map((lecturer) => (
                          <SelectItem key={lecturer.id} value={lecturer.id}>
                            {lecturer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" aria-hidden />
                      {course.enrolledCount} enrolled · {course.sessionCount} session
                      {course.sessionCount === 1 ? "" : "s"}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setEnrollTarget(course)}>
                      Manage enrolment
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </QueryBoundary>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit course" : "New course"}</DialogTitle>
            <DialogDescription>
              Courses hold attendance sessions and enrolled students.
            </DialogDescription>
          </DialogHeader>
          <form
            id="course-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setFieldErrors({});
              saveMutation.mutate(form);
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Course code" htmlFor="course-code" error={fieldErrors.code}>
                <Input
                  id="course-code"
                  required
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="CSC 305"
                  className="font-mono uppercase"
                />
              </Field>
              <Field label="Units" htmlFor="course-units" error={fieldErrors.units}>
                <Input
                  id="course-units"
                  type="number"
                  min={1}
                  max={12}
                  required
                  value={form.units}
                  onChange={(e) => setForm({ ...form, units: Number(e.target.value) })}
                />
              </Field>
            </div>
            <Field label="Title" htmlFor="course-title" error={fieldErrors.title}>
              <Input
                id="course-title"
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Data Structures & Algorithms"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department" htmlFor="course-dept" error={fieldErrors.departmentId}>
                <Select
                  value={form.departmentId}
                  onValueChange={(value) => setForm({ ...form, departmentId: value })}
                >
                  <SelectTrigger id="course-dept">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((department) => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Level" htmlFor="course-level" error={fieldErrors.level}>
                <Select
                  value={form.level}
                  onValueChange={(value) => setForm({ ...form, level: value })}
                >
                  <SelectTrigger id="course-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level} level
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field
              label="Description (optional)"
              htmlFor="course-description"
              error={fieldErrors.description}
            >
              <Textarea
                id="course-description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What this course covers…"
              />
            </Field>
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="course-form" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {form.id ? "Save changes" : "Create course"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {enrollTarget && (
        <EnrollmentDialog
          course={enrollTarget}
          onClose={() => setEnrollTarget(null)}
          onSaved={invalidate}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.code}?`}
        description="Courses that already have attendance sessions cannot be deleted, so historical records are never silently destroyed."
        confirmLabel="Delete course"
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </RouteTransition>
  );
}

function EnrollmentDialog({
  course,
  onClose,
  onSaved,
}: {
  course: Course;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const studentsQuery = useQuery({
    queryKey: ["admin", "studentOptions"],
    queryFn: () => api.studentOptions(),
  });
  // The list endpoint omits enrolment ids for payload size, so fetch the
  // course's current roster explicitly before showing the picker.
  const detailQuery = useQuery({
    queryKey: ["courses", course.id, "detail"],
    queryFn: () => api.courseDetail(course.id),
  });

  useEffect(() => {
    const report = detailQuery.data?.report;
    if (report) setSelected(new Set(report.students.map((student) => student.id)));
  }, [detailQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => api.enrollStudents({ courseId: course.id, studentIds: [...selected] }),
    onSuccess: () => {
      toast.success("Enrolment updated");
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const students = studentsQuery.data?.items ?? [];
  const visible = filter
    ? students.filter(
        (student) =>
          student.name.toLowerCase().includes(filter.toLowerCase()) ||
          (student.matricNo ?? "").toLowerCase().includes(filter.toLowerCase()),
      )
    : students;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loading = studentsQuery.isPending || detailQuery.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enrolment · {course.code}</DialogTitle>
          <DialogDescription>
            Select the students taking this course. {selected.size} selected.
          </DialogDescription>
        </DialogHeader>

        <SearchInput
          value={filter}
          onChange={setFilter}
          placeholder="Filter students"
          label="Filter students"
        />

        <div className="-mx-1 mt-2 flex-1 overflow-y-auto px-1">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading students…</div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {students.length === 0 ? "No students registered yet." : "No students match."}
            </div>
          ) : (
            <ul className="space-y-1">
              {visible.map((student) => (
                <li key={student.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50">
                    <Checkbox
                      checked={selected.has(student.id)}
                      onCheckedChange={() => toggle(student.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{student.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {student.matricNo ?? student.email}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || loading}>
            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save enrolment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
