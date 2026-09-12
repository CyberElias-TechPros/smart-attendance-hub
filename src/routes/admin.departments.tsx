import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { departments } from "@/lib/api";
import { deptsQO } from "@/lib/queries";
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
import { Plus, Trash2, Building2, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TrackGlyph } from "@/lib/courseIcons";
import { ICON_NAMES } from "@/lib/courseIcons";
import { RouteTransition } from "@/components/RouteTransition";
import { EmptyState } from "@/components/EmptyState";

export const Route = createFileRoute("/admin/departments")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(deptsQO);
  },
  component: DepartmentsPage,
});

function DepartmentsPage() {
  const { data: depts } = useSuspenseQuery(deptsQO);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", icon: "", color: "" });
  const resetForm = () => setForm({ name: "", code: "", icon: "", color: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await departments.update(editing, {
          name: form.name,
          code: form.code,
          icon: form.icon || undefined,
          color: form.color || undefined,
        });
        toast.success("Department updated");
      } else {
        await departments.create({
          name: form.name,
          code: form.code,
          icon: form.icon || undefined,
          color: form.color || undefined,
        });
        toast.success("Department added");
      }
      setOpen(false);
      setEditing(null);
      resetForm();
      qc.invalidateQueries({ queryKey: ["departments"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const startEdit = (d: {
    id: string;
    name: string;
    code: string;
    icon?: string;
    color?: string;
  }) => {
    setEditing(d.id);
    setForm({ name: d.name, code: d.code, icon: d.icon ?? "", color: d.color ?? "" });
    setOpen(true);
  };

  const remove = async (id: string) => {
    try {
      await departments.remove(id);
      qc.invalidateQueries({ queryKey: ["departments"] });
      toast.success("Removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <>
      <PageHeader
        title="Departments"
        subtitle={`${depts.length} departments`}
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
                <Plus className="mr-2 h-4 w-4" /> {editing ? "Edit" : "Add department"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={submit}>
                <DialogHeader>
                  <DialogTitle>{editing ? "Edit department" : "New department"}</DialogTitle>
                </DialogHeader>
                <div className="mt-4 grid gap-3">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Code</Label>
                    <Input
                      required
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    />
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
                </div>
                <DialogFooter className="mt-6">
                  <Button type="submit">{editing ? "Save" : "Create"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <RouteTransition stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {depts.length === 0 && (
          <EmptyState
            className="col-span-full"
            icon={<Building2 className="h-7 w-7" />}
            title="No departments"
            description="Add a department to organize courses."
          />
        )}
        {depts.map((d) => (
          <div
            key={d.id}
            className="group flex items-center justify-between rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition hover:-translate-y-0.5 hover:shadow-lift"
          >
            <div className="flex items-center gap-3">
              <TrackGlyph icon={d.icon} color={d.color} seed={d.code} size="sm" track />
              <div>
                <div className="font-display font-semibold">{d.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{d.code}</div>
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => startEdit(d)}
                title={`Edit ${d.name}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(d.id)}
                title={`Remove ${d.name}`}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </RouteTransition>
    </>
  );
}
