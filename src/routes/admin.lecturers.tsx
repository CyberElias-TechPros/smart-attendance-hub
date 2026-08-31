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
import { Plus, Trash2, Pencil, Search, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { RouteTransition } from "@/components/RouteTransition";
import { EmptyState } from "@/components/EmptyState";

const lecturersQO = usersQO("lecturer");

export const Route = createFileRoute("/admin/lecturers")({
  beforeLoad: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(lecturersQO),
      context.queryClient.ensureQueryData(deptsQO),
    ]);
  },
  component: LecturersPage,
});

function LecturersPage() {
  const { data: lecturers } = useSuspenseQuery(lecturersQO);
  const { data: depts } = useSuspenseQuery(deptsQO);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<null | (typeof lecturers)[number]>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    staffId: "",
    departmentId: "",
    password: "",
  });
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    staffId: "",
    departmentId: "",
    password: "",
  });
  const [q, setQ] = useState("");

  const openEdit = (l: (typeof lecturers)[number]) => {
    setEditing(l);
    setEditForm({
      name: l.name,
      email: l.email,
      staffId: l.staffId ?? "",
      departmentId: l.departmentId ?? "",
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
        staffId: editForm.staffId,
        departmentId: editForm.departmentId,
        ...(editForm.password ? { password: editForm.password } : {}),
      });
      toast.success("Lecturer updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await users.create({ role: "lecturer", ...form });
      toast.success("Lecturer added");
      setOpen(false);
      setForm({ name: "", email: "", staffId: "", departmentId: "", password: "" });
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

  const filtered = lecturers.filter(
    (l) =>
      l.name.toLowerCase().includes(q.toLowerCase()) ||
      l.email.toLowerCase().includes(q.toLowerCase()) ||
      (l.staffId ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Lecturers"
        subtitle={`${lecturers.length} lecturers on staff`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Add lecturer
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={submit}>
                <DialogHeader>
                  <DialogTitle>Register lecturer</DialogTitle>
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
                  <Field label="Staff ID">
                    <Input
                      required
                      value={form.staffId}
                      onChange={(e) => setForm({ ...form, staffId: e.target.value })}
                    />
                  </Field>
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
                  <Button type="submit">Create lecturer</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <RouteTransition>
        <div className="mb-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search lecturers…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="No lecturers"
            description="Add your first lecturer to get started."
          />
        ) : (
          <div className="rounded-2xl border border-border/70 bg-card shadow-elegant">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Staff ID</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Dept</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="font-mono text-xs">{l.staffId}</TableCell>
                    <TableCell className="text-muted-foreground">{l.email}</TableCell>
                    <TableCell>{depts.find((d) => d.id === l.departmentId)?.code ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(l)}
                          title="Edit lecturer"
                        >
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" title="Remove lecturer">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {l.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This unassigns them from all courses and deletes their sessions.
                                This can't be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(l.id)}>
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
        )}
      </RouteTransition>
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <form onSubmit={saveEdit}>
            <DialogHeader>
              <DialogTitle>Edit lecturer</DialogTitle>
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
              <Field label="Staff ID">
                <Input
                  required
                  value={editForm.staffId}
                  onChange={(e) => setEditForm({ ...editForm, staffId: e.target.value })}
                />
              </Field>
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
