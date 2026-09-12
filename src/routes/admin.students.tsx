import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { users } from "@/lib/api";
import { deptsQO, usersQO } from "@/lib/queries";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Search, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RouteTransition } from "@/components/RouteTransition";

const studentsQO = usersQO("student");

export const Route = createFileRoute("/admin/students")({
  beforeLoad: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(studentsQO),
      context.queryClient.ensureQueryData(deptsQO),
    ]);
  },
  component: StudentsPage,
});

function StudentsPage() {
  const { data: students } = useSuspenseQuery(studentsQO);
  const { data: depts } = useSuspenseQuery(deptsQO);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<null | (typeof students)[number]>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    matricNo: "",
    departmentId: "",
    level: "100",
    password: "",
  });
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    matricNo: "",
    departmentId: "",
    level: "100",
    password: "",
  });

  const openEdit = (s: (typeof students)[number]) => {
    setEditing(s);
    setEditForm({
      name: s.name,
      email: s.email,
      matricNo: s.matricNo ?? "",
      departmentId: s.departmentId ?? "",
      level: s.level ?? "100",
      password: "",
    });
  };
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      await users.update(editing.id, {
        name: editForm.name,
        email: editForm.email,
        matricNo: editForm.matricNo,
        departmentId: editForm.departmentId,
        level: editForm.level,
        ...(editForm.password ? { password: editForm.password } : {}),
      });
      toast.success("Student updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const filtered = students.filter(
    (s) =>
      s.name.toLowerCase().includes(q.toLowerCase()) ||
      s.email.toLowerCase().includes(q.toLowerCase()) ||
      (s.matricNo ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await users.create({ role: "student", ...form });
      toast.success("Student added");
      setOpen(false);
      setForm({ name: "", email: "", matricNo: "", departmentId: "", level: "100", password: "" });
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };
  const remove = async (id: string) => {
    try {
      await users.remove(id);
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <>
      <PageHeader
        title="Students"
        subtitle={`${students.length} registered students`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Add student
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={submit}>
                <DialogHeader>
                  <DialogTitle>Register student</DialogTitle>
                </DialogHeader>
                <div className="mt-4 grid gap-3">
                  <Field label="Full name">
                    <Input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      required
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </Field>
                  <Field label="Matric number">
                    <Input
                      required
                      value={form.matricNo}
                      onChange={(e) => setForm({ ...form, matricNo: e.target.value })}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Department">
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
                    </Field>
                    <Field label="Level">
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
                    </Field>
                  </div>
                  <Field label="Initial password (min 8 chars)">
                    <Input
                      required
                      type="text"
                      minLength={8}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                  </Field>
                </div>
                <DialogFooter className="mt-6">
                  <Button type="submit">Create student</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <form onSubmit={saveEdit}>
            <DialogHeader>
              <DialogTitle>Edit student</DialogTitle>
            </DialogHeader>
            <div className="mt-4 grid gap-3">
              <Field label="Full name">
                <Input
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </Field>
              <Field label="Email">
                <Input
                  required
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </Field>
              <Field label="Matric number">
                <Input
                  required
                  value={editForm.matricNo}
                  onChange={(e) => setEditForm({ ...editForm, matricNo: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Department">
                  <Select
                    value={editForm.departmentId}
                    onValueChange={(v) => setEditForm({ ...editForm, departmentId: v })}
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
                </Field>
                <Field label="Level">
                  <Select
                    value={editForm.level}
                    onValueChange={(v) => setEditForm({ ...editForm, level: v })}
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
                </Field>
              </div>
              <Field label="New password (leave blank to keep)">
                <Input
                  type="text"
                  minLength={8}
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="••••••••"
                />
              </Field>
            </div>
            <DialogFooter className="mt-6">
              <Button type="submit">Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <RouteTransition>
        <div className="mb-4 flex items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search students…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-card shadow-elegant">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Matric</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Dept</TableHead>
                <TableHead>Level</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No students found
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="font-mono text-xs">{s.matricNo}</TableCell>
                  <TableCell className="text-muted-foreground">{s.email}</TableCell>
                  <TableCell>{depts.find((d) => d.id === s.departmentId)?.code ?? "—"}</TableCell>
                  <TableCell>{s.level}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(s)}
                        title="Edit student"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" title="Remove student">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove {s.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This deletes their account, enrollments and attendance history. This
                              can't be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(s.id)}>
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </RouteTransition>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
