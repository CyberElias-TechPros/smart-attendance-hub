import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listDepartments, createDepartment, deleteDepartment } from "@/lib/api.functions";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Building2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const deptsQO = queryOptions({ queryKey: ["departments"], queryFn: () => listDepartments() });

export const Route = createFileRoute("/admin/departments")({
  loader: ({ context }) => context.queryClient.ensureQueryData(deptsQO),
  component: DepartmentsPage,
});

function DepartmentsPage() {
  const { data: depts } = useSuspenseQuery(deptsQO);
  const qc = useQueryClient();
  const createFn = useServerFn(createDepartment);
  const delFn = useServerFn(deleteDepartment);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createFn({ data: form });
      toast.success("Department added");
      setOpen(false); setForm({ name: "", code: "" });
      qc.invalidateQueries({ queryKey: ["departments"] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };
  const remove = async (id: string) => {
    await delFn({ data: { id } });
    qc.invalidateQueries({ queryKey: ["departments"] });
    toast.success("Removed");
  };

  return (
    <>
      <PageHeader
        title="Departments"
        subtitle={`${depts.length} departments`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Add department</Button></DialogTrigger>
            <DialogContent>
              <form onSubmit={submit}>
                <DialogHeader><DialogTitle>New department</DialogTitle></DialogHeader>
                <div className="mt-4 grid gap-3">
                  <div className="space-y-1.5"><Label>Name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label>Code</Label><Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                </div>
                <DialogFooter className="mt-6"><Button type="submit">Create</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {depts.map((d) => (
          <div key={d.id} className="group flex items-center justify-between rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition hover:-translate-y-0.5 hover:shadow-lift">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></div>
              <div>
                <div className="font-display font-semibold">{d.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{d.code}</div>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => remove(d.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        ))}
      </div>
    </>
  );
}
