import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { courses } from "@/lib/api";
import type { CourseInput } from "@/lib/api";
import { coursesQO, deptsQO, usersQO } from "@/lib/queries";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Users, BookOpen, Pencil, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CourseGlyph } from "@/lib/courseIcons";
import { ICON_NAMES } from "@/lib/courseIcons";
import { RouteTransition } from "@/components/RouteTransition";
import { EmptyState } from "@/components/EmptyState";

export const Route = createFileRoute("/admin/courses")({
  beforeLoad: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(coursesQO),
      context.queryClient.ensureQueryData(deptsQO),
      context.queryClient.ensureQueryData(usersQO("lecturer")),
      context.queryClient.ensureQueryData(usersQO("student")),
    ]);
  },
  component: CoursesPage,
});

const EMPTY_FORM = {
  code: "",
  title: "",
  departmentId: "",
  level: "100",
  units: 3,
  icon: "",
  color: "",
  category: "",
  description: "",
};

function CoursesPage() {
  const { data: all } = useSuspenseQuery(coursesQO);
  const { data: depts } = useSuspenseQuery(deptsQO);
  const { data: lecturers } = useSuspenseQuery(usersQO("lecturer"));
  const { data: students } = useSuspenseQuery(usersQO("student"));
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; code: string } | null>(null);

  const resetForm = () => setForm(EMPTY_FORM);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CourseInput = {
      ...form,
      icon: form.icon || undefined,
      color: form.color || undefined,
      category: form.category || undefined,
      description: form.description || undefined,
    };
    try {
      if (editing) {
        await courses.update(editing, payload);
        toast.success("Course updated");
      } else {
        await courses.create(payload);
        toast.success("Course created");
      }
      setOpen(false);
      setEditing(null);
      resetForm();
      qc.invalidateQueries({ queryKey: ["courses"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const startEdit = (c: {
    id: string;
    code: string;
    title: string;
    departmentId: string;
    level: string;
    units: number;
    icon?: string;
    color?: string;
    category?: string;
    description?: string;
  }) => {
    setEditing(c.id);
    setForm({
      code: c.code,
      title: c.title,
      departmentId: c.departmentId,
      level: c.level,
      units: c.units,
      icon: c.icon ?? "",
      color: c.color ?? "",
      category: c.category ?? "",
      description: c.description ?? "",
    });
    setOpen(true);
  };

  const remove = async (id: string) => {
    try {
      await courses.remove(id);
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["courses"] });
      toast.success("Deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle={`${all.length} courses across the faculty`}
        actions={
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) {
                setEditing(null);
                resetForm();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> {editing ? "Edit course" : "New course"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={submit}>
                <DialogHeader>
                  <DialogTitle>{editing ? "Edit course" : "Create course"}</DialogTitle>
                </DialogHeader>
                <div className="mt-4 grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Code</Label>
                      <Input
                        required
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value })}
                        placeholder="CSC 305"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Units</Label>
                      <Input
                        required
                        type="number"
                        min={1}
                        max={12}
                        value={form.units}
                        onChange={(e) => setForm({ ...form, units: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Title</Label>
                    <Input
                      required
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Department</Label>
                      <Select
                        value={form.departmentId}
                        onValueChange={(v) => setForm({ ...form, departmentId: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {depts.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Level</Label>
                      <Select
                        value={form.level}
                        onValueChange={(v) => setForm({ ...form, level: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["100", "200", "300", "400", "500"].map((l) => (
                            <SelectItem key={l} value={l}>
                              {l}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Icon</Label>
                      <Select
                        value={form.icon}
                        onValueChange={(v) => setForm({ ...form, icon: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          {ICON_NAMES.map((n) => (
                            <SelectItem key={n} value={n}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Color</Label>
                      <Input
                        value={form.color}
                        onChange={(e) => setForm({ ...form, color: e.target.value })}
                        placeholder="oklch(...) or hex"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Category (optional)</Label>
                    <Input
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter className="mt-6">
                  <Button type="submit">{editing ? "Save" : "Create"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.code}?</DialogTitle>
            <DialogDescription className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" />
              This also deletes all sessions and attendance records for the course. This can't be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => confirmDelete && remove(confirmDelete.id)}>
              Delete course
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <RouteTransition stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {all.length === 0 && (
          <EmptyState
            className="col-span-full"
            icon={<BookOpen className="h-7 w-7" />}
            title="No courses"
            description="Create your first course to get started."
          />
        )}
        {all.map((c) => {
          const dept = depts.find((d) => d.id === c.departmentId);
          return (
            <div
              key={c.id}
              className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <CourseGlyph icon={c.icon} color={c.color} seed={c.code} size="md" />
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                    <div className="font-display font-semibold">{c.title}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => startEdit(c)}
                    title={`Edit ${c.code}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setConfirmDelete({ id: c.id, code: c.code })}
                    title={`Delete ${c.code}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">{dept?.code}</Badge>
                <Badge variant="secondary">Level {c.level}</Badge>
                <Badge variant="secondary">{c.units} units</Badge>
              </div>
              <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Lecturer</Label>
                  <Select
                    value={c.lecturerId ?? "none"}
                    onValueChange={async (v) => {
                      try {
                        await courses.assignLecturer(c.id, v === "none" ? null : v);
                        qc.invalidateQueries({ queryKey: ["courses"] });
                        qc.invalidateQueries({ queryKey: ["lecturer", "courses"] });
                        toast.success("Updated");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Failed");
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {lecturers.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <EnrollmentPicker
                  course={c}
                  students={students}
                  onSave={async (ids) => {
                    try {
                      await courses.setEnrollments(c.id, ids);
                      qc.invalidateQueries({ queryKey: ["courses"] });
                      toast.success("Enrollment updated");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed");
                    }
                  }}
                />
              </div>
            </div>
          );
        })}
      </RouteTransition>
    </>
  );
}

function EnrollmentPicker({
  course,
  students,
  onSave,
}: {
  course: { id: string; enrolledStudentIds: string[]; level: string; departmentId: string };
  students: Array<{
    id: string;
    name: string;
    matricNo?: string;
    level?: string;
    departmentId?: string;
  }>;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(course.enrolledStudentIds);
  const suggested = students.filter(
    (s) => s.departmentId === course.departmentId && s.level === course.level,
  );
  const others = students.filter(
    (s) => !(s.departmentId === course.departmentId && s.level === course.level),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setSelected(course.enrolledStudentIds);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <Users className="mr-2 h-4 w-4" />
          {course.enrolledStudentIds.length} enrolled
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage enrollment</DialogTitle>
        </DialogHeader>
        <div className="max-h-[420px] space-y-1 overflow-y-auto pr-2">
          {[...suggested, ...others].map((s) => {
            const checked = selected.includes(s.id);
            return (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-[var(--color-primary)]"
                  checked={checked}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id),
                    )
                  }
                />
                <span className="text-sm font-medium">{s.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{s.matricNo}</span>
              </label>
            );
          })}
          {students.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No students registered yet.
            </p>
          )}
        </div>
        <DialogFooter className="mt-4">
          <Button
            onClick={async () => {
              await onSave(selected);
              setOpen(false);
            }}
          >
            Save enrollment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
