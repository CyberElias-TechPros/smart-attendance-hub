import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listUsers, listDepartments, createLecturer, deleteUser } from "@/lib/api.functions";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const lecturersQO = queryOptions({
  queryKey: ["users", "lecturer"],
  queryFn: () => listUsers({ data: { role: "lecturer" } }),
});
const deptsQO = queryOptions({ queryKey: ["departments"], queryFn: () => listDepartments() });

export const Route = createFileRoute("/admin/lecturers")({
  loader: async ({ context }) => {
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
  const createFn = useServerFn(createLecturer);
  const delFn = useServerFn(deleteUser);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", staffId: "", departmentId: "", password: "password123" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createFn({ data: form });
      toast.success("Lecturer added");
      setOpen(false);
      setForm({ name: "", email: "", staffId: "", departmentId: "", password: "password123" });
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };
  const remove = async (id: string) => {
    try { await delFn({ data: { id } }); toast.success("Removed"); qc.invalidateQueries({ queryKey: ["users"] }); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  return (
    <>
      <PageHeader
        title="Lecturers"
        subtitle={`${lecturers.length} lecturers on staff`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Add lecturer</Button></DialogTrigger>
            <DialogContent>
              <form onSubmit={submit}>
                <DialogHeader><DialogTitle>Register lecturer</DialogTitle></DialogHeader>
                <div className="mt-4 grid gap-3">
                  <Field label="Full name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                  <Field label="Email"><Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                  <Field label="Staff ID"><Input required value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })} /></Field>
                  <Field label="Department">
                    <Select value={form.departmentId} onValueChange={(v) => setForm({ ...form, departmentId: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field label="Initial password"><Input required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
                </div>
                <DialogFooter className="mt-6"><Button type="submit">Create lecturer</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="rounded-2xl border border-border/70 bg-card shadow-elegant">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Staff ID</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Dept</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lecturers.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.name}</TableCell>
                <TableCell className="font-mono text-xs">{l.staffId}</TableCell>
                <TableCell className="text-muted-foreground">{l.email}</TableCell>
                <TableCell>{depts.find((d) => d.id === l.departmentId)?.code ?? "—"}</TableCell>
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {l.name}?</AlertDialogTitle>
                        <AlertDialogDescription>This unassigns them from all courses.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(l.id)}>Remove</AlertDialogAction>
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
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
