import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listCourses, listDepartments, listUsers,
  createCourse, updateCourse, deleteCourse, assignLecturer, enrollStudents,
} from "@/lib/api.functions";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Users, BookOpen, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CourseGlyph } from "@/lib/courseIcons";
import { ICON_NAMES } from "@/lib/courseIcons";
import { RouteTransition } from "@/components/RouteTransition";
import { EmptyState } from "@/components/EmptyState";
import { CardSkeleton } from "@/components/Loaders";

const coursesQO = queryOptions({ queryKey: ["courses"], queryFn: () => listCourses() });
const deptsQO = queryOptions({ queryKey: ["departments"], queryFn: () => listDepartments() });
const lecturersQO = queryOptions({ queryKey: ["users", "lecturer"], queryFn: () => listUsers({ data: { role: "lecturer" } }) });
const studentsQO = queryOptions({ queryKey: ["users", "student"], queryFn: () => listUsers({ data: { role: "student" } }) });

export const Route = createFileRoute("/admin/courses")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(coursesQO),
      context.queryClient.ensureQueryData(deptsQO),
      context.queryClient.ensureQueryData(lecturersQO),
      context.queryClient.ensureQueryData(studentsQO),
    ]);
  },
  component: CoursesPage,
});

function CoursesPage() {
  const { data: courses } = useSuspenseQuery(coursesQO);
  const { data: depts } = useSuspenseQuery(deptsQO);
  const { data: lecturers } = useSuspenseQuery(lecturersQO);
  const { data: students } = useSuspenseQuery(studentsQO);
  const qc = useQueryClient();
  const createFn = useServerFn(createCourse);
  const delFn = useServerFn(deleteCourse);
  const assignFn = useServerFn(assignLecturer);
  const enrollFn = useServerFn(enrollStudents);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", title: "", departmentId: "", level: "100", units: 3, icon: "", color: "", category: "", description: "" });

  const resetForm = () => setForm({ code: "", title: "", departmentId: "", level: "100", units: 3, icon: "", color: "", category: "", description: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateCourse({ data: { id: editing, ...form } });
        toast.success("Course updated");
      } else {
        await createFn({ data: form });
        toast.success("Course created");
      }
      setOpen(false); setEditing(null); resetForm();
      qc.invalidateQueries({ queryKey: ["courses"] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  const startEdit = (c: { id: string; code: string; title: string; departmentId: string; level: string; units: number; icon?: string; color?: string; category?: string; description?: string }) => {
    setEditing(c.id);
    setForm({ code: c.code, title: c.title, departmentId: c.departmentId, level: c.level, units: c.units, icon: c.icon ?? "", color: c.color ?? "", category: c.category ?? "", description: c.description ?? "" });
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle={`${courses.length} courses across the faculty`}
        actions={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); resetForm(); } }}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> {editing ? "Edit course" : "New course"}</Button></DialogTrigger>
            <DialogContent>
              <form onSubmit={submit}>
                <DialogHeader><DialogTitle>{editing ? "Edit course" : "Create course"}</DialogTitle></DialogHeader>
                <div className="mt-4 grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>Code</Label><Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label>Units</Label><Input required type="number" min={1} max={12} value={form.units} onChange={(e) => setForm({ ...form, units: Number(e.target.value) })} /></div>
                  </div>
                  <div className="space-y-1.5"><Label>Title</Label><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>Department</Label>
                      <Select value={form.departmentId} onValueChange={(v) => setForm({ ...form, departmentId: v })}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>{depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5"><Label>Level</Label>
                      <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["100","200","300","400","500"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label>Icon</Label>
                      <Select value={form.icon} onValueChange={(v) => setForm({ ...form, icon: v })}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>{ICON_NAMES.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5"><Label>Color</Label><Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="oklch(...) or hex" /></div>
                  </div>
                  <div className="space-y-1.5"><Label>Category (optional)</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
                </div>
                <DialogFooter className="mt-6"><Button type="submit">{editing ? "Save" : "Create"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <RouteTransition stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {courses.length === 0 && (
          <EmptyState
            className="col-span-full"
            icon={<BookOpen className="h-7 w-7" />}
            title="No courses"
            description="Create your first course to get started."
          />
        )}
        {courses.map((c) => {
          const dept = depts.find((d) => d.id === c.departmentId);
          return (
            <div key={c.id} className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <CourseGlyph icon={c.icon} color={c.color} seed={c.code} size="md" />
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                    <div className="font-display font-semibold">{c.title}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={async () => { await delFn({ data: { id: c.id } }); qc.invalidateQueries({ queryKey: ["courses"] }); toast.success("Deleted"); }}>
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
                      await assignFn({ data: { courseId: c.id, lecturerId: v === "none" ? null : v } });
                      qc.invalidateQueries({ queryKey: ["courses"] });
                      toast.success("Updated");
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {lecturers.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <EnrollmentPicker
                  course={c}
                  students={students}
                  onSave={async (ids) => {
                    await enrollFn({ data: { courseId: c.id, studentIds: ids } });
                    qc.invalidateQueries({ queryKey: ["courses"] });
                    toast.success("Enrollment updated");
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
  students: Array<{ id: string; name: string; matricNo?: string; level?: string; departmentId?: string }>;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(course.enrolledStudentIds);
  const suggested = students.filter((s) => s.departmentId === course.departmentId && s.level === course.level);
  const others = students.filter((s) => !(s.departmentId === course.departmentId && s.level === course.level));

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
        <DialogHeader><DialogTitle>Manage enrollment</DialogTitle></DialogHeader>
        <div className="max-h-[420px] space-y-1 overflow-y-auto pr-2">
          {[...suggested, ...others].map((s) => {
            const checked = selected.includes(s.id);
            return (
              <label key={s.id} className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 hover:bg-muted/60">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{s.matricNo}</div>
                </div>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setSelected((prev) => (checked ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
                  }
                  className="h-4 w-4"
                />
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={async () => { await onSave(selected); setOpen(false); }}>Save enrollment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
