import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Department } from "../../shared/schemas";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { Field } from "./admin.students";

export const Route = createFileRoute("/admin/departments")({ component: DepartmentsPage });

interface FormState {
  id?: string;
  name: string;
  code: string;
}

function DepartmentsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>({ name: "", code: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

  const query = useQuery({ queryKey: ["departments"], queryFn: () => api.departments() });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["departments"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormState): Promise<void> => {
      const payload = { name: values.name, code: values.code };
      if (values.id) await api.updateDepartment(values.id, payload);
      else await api.createDepartment(payload);
    },
    onSuccess: (_data, values) => {
      toast.success(values.id ? "Department updated" : "Department created");
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
    mutationFn: (id: string) => api.deleteDepartment(id),
    onSuccess: () => {
      toast.success("Department deleted");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openCreate = () => {
    setForm({ name: "", code: "" });
    setFieldErrors({});
    setDialogOpen(true);
  };

  const openEdit = (department: Department) => {
    setForm({ id: department.id, name: department.name, code: department.code });
    setFieldErrors({});
    setDialogOpen(true);
  };

  return (
    <RouteTransition>
      <PageHeader
        title="Departments"
        subtitle="Organise courses and people into faculties."
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New department
          </Button>
        }
      />

      <QueryBoundary
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        onRetry={() => query.refetch()}
        loadingLabel="Loading departments"
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title="No departments yet"
            description="Departments group your courses, lecturers and students. Create the first one to get started."
            action={
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> New department
              </Button>
            }
          />
        }
      >
        {(data) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((department) => (
              <div
                key={department.id}
                className="group rounded-2xl border border-border/70 bg-card p-5 shadow-elegant transition hover:shadow-lift"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-display text-lg font-semibold">
                      {department.name}
                    </div>
                    <div className="mt-0.5 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      {department.code}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(department)}
                      aria-label={`Edit ${department.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(department)}
                      aria-label={`Delete ${department.name}`}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <dl className="mt-4 flex gap-6 border-t border-border/60 pt-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Courses</dt>
                    <dd className="font-display text-xl font-semibold">{department.courseCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Students</dt>
                    <dd className="font-display text-xl font-semibold">
                      {department.studentCount}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </QueryBoundary>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit department" : "New department"}</DialogTitle>
            <DialogDescription>
              Departments group courses, lecturers and students together.
            </DialogDescription>
          </DialogHeader>
          <form
            id="department-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setFieldErrors({});
              saveMutation.mutate(form);
            }}
            className="space-y-4"
          >
            <Field label="Name" htmlFor="dept-name" error={fieldErrors.name}>
              <Input
                id="dept-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Computer Science"
              />
            </Field>
            <Field
              label="Code"
              htmlFor="dept-code"
              error={fieldErrors.code}
              hint="A short unique abbreviation, e.g. CSC."
            >
              <Input
                id="dept-code"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="CSC"
                maxLength={10}
                className="font-mono uppercase"
              />
            </Field>
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="department-form" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {form.id ? "Save changes" : "Create department"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name}?`}
        description="This can only be done once no courses or people belong to the department."
        confirmLabel="Delete department"
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </RouteTransition>
  );
}
