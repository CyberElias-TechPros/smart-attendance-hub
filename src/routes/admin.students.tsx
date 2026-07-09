import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listUsers, listDepartments, createStudent, deleteUser } from "@/lib/api.functions";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const studentsQO = queryOptions({
  queryKey: ["users", "student"],
  queryFn: () => listUsers({ data: { role: "student" } }),
});
const deptsQO = queryOptions({ queryKey: ["departments"], queryFn: () => listDepartments() });

export const Route = createFileRoute("/admin/students")({
  loader: async ({ context }) => {
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
  const createFn = useServerFn(createStudent);
  const delFn = useServerFn(deleteUser);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", matricNo: "", departmentId: "", level: "100", password: "password123" });

  const filtered = students.filter(
    (s) =>
      s.name.toLowerCase().includes(q.toLowerCase()) ||
      s.email.toLowerCase().includes(q.toLowerCase()) ||
      (s.matricNo ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createFn({ data: form });
      toast.success("Student added");
      setOpen(false);
      setForm({ name: "", email: "", matricNo: "", departmentId: "", level: "100", password: "password123" });
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };
  const remove = async (id: string) => {
    try {
      await delFn({ data: { id } });
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
              <Button><Plus className="mr-2 h-4 w-4" /> Add student</Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={submit}>
                <DialogHeader>
                  <DialogTitle>Register student</DialogTitle>
                </DialogHeader>
                <div className="mt-4 grid gap-3">
                  <Field label="Full name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                  <Field label="Email"><Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                  <Field label="Matric number"><Input required value={form.matricNo} onChange={(e) => setForm({ ...form, matricNo: e.target.value })} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Department">
                      <Select value={form.departmentId} onValueChange={(v) => setForm({ ...form, departmentId: v })}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          {depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Level">
                      <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["100", "200", "300", "400", "500"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Initial password"><Input required type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
                </div>
                <DialogFooter className="mt-6"><Button type="submit">Create student</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search students…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
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
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No students found</TableCell></TableRow>
            )}
            {filtered.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="font-mono text-xs">{s.matricNo}</TableCell>
                <TableCell className="text-muted-foreground">{s.email}</TableCell>
                <TableCell>{depts.find((d) => d.id === s.departmentId)?.code ?? "—"}</TableCell>
                <TableCell>{s.level}</TableCell>
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {s.name}?</AlertDialogTitle>
                        <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(s.id)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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

