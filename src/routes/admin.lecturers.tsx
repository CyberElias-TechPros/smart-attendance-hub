import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Column, DataTable, Pagination, SearchInput, useDebounced } from "@/components/DataTable";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PublicUser } from "../../shared/schemas";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { Field } from "./admin.students";

export const Route = createFileRoute("/admin/lecturers")({ component: LecturersPage });

const PAGE_SIZE = 20;

interface FormState {
  id?: string;
  name: string;
  email: string;
  staffId: string;
  departmentId: string;
  password: string;
}

const emptyForm: FormState = { name: "", email: "", staffId: "", departmentId: "", password: "" };

function LecturersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<PublicUser | null>(null);

  const lecturersQuery = useQuery({
    queryKey: ["admin", "users", "lecturer", { page, search }],
    queryFn: () => api.listUsers({ role: "lecturer", page, pageSize: PAGE_SIZE, search }),
    placeholderData: keepPreviousData,
  });

  const departmentsQuery = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.departments(),
  });
  const departments = departmentsQuery.data?.items ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "lecturerOptions"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormState) => {
      const payload: Record<string, unknown> = {
        name: values.name,
        email: values.email,
        staffId: values.staffId,
        departmentId: values.departmentId,
      };
      if (values.id) {
        if (values.password) payload.password = values.password;
        return api.updateLecturer({ ...payload, id: values.id });
      }
      return api.createLecturer({ ...payload, password: values.password });
    },
    onSuccess: (_data, values) => {
      toast.success(values.id ? "Lecturer updated" : "Lecturer added");
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
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => {
      toast.success("Lecturer removed");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["courses"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openCreate = () => {
    setForm({ ...emptyForm, departmentId: departments[0]?.id ?? "" });
    setFieldErrors({});
    setDialogOpen(true);
  };

  const openEdit = (lecturer: PublicUser) => {
    setForm({
      id: lecturer.id,
      name: lecturer.name,
      email: lecturer.email,
      staffId: lecturer.staffId ?? "",
      departmentId: lecturer.departmentId ?? departments[0]?.id ?? "",
      password: "",
    });
    setFieldErrors({});
    setDialogOpen(true);
  };

  const columns: Column<PublicUser>[] = [
    {
      key: "name",
      header: "Name",
      render: (lecturer) => <span className="font-medium">{lecturer.name}</span>,
    },
    {
      key: "staffId",
      header: "Staff ID",
      render: (lecturer) => <span className="font-mono text-xs">{lecturer.staffId ?? "—"}</span>,
    },
    {
      key: "email",
      header: "Email",
      hideOnMobile: true,
      render: (lecturer) => <span className="text-muted-foreground">{lecturer.email}</span>,
    },
    {
      key: "department",
      header: "Department",
      hideOnMobile: true,
      render: (lecturer) => lecturer.departmentName ?? "—",
    },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (lecturer) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openEdit(lecturer)}
            aria-label={`Edit ${lecturer.name}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleteTarget(lecturer)}
            aria-label={`Remove ${lecturer.name}`}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const noDepartments = departmentsQuery.isSuccess && departments.length === 0;

  return (
    <RouteTransition>
      <PageHeader
        title="Lecturers"
        subtitle="Manage teaching staff and their departments."
        actions={
          <Button onClick={openCreate} disabled={noDepartments}>
            <Plus className="mr-2 h-4 w-4" /> Add lecturer
          </Button>
        }
      />

      {noDepartments && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          Create a department first — every lecturer must belong to one.
        </div>
      )}

      <div className="mb-4">
        <SearchInput
          value={searchInput}
          onChange={(value) => {
            setSearchInput(value);
            setPage(1);
          }}
          placeholder="Search by name, email or staff ID"
          label="Search lecturers"
        />
      </div>

      <QueryBoundary
        isLoading={lecturersQuery.isPending}
        error={lecturersQuery.error}
        data={lecturersQuery.data}
        onRetry={() => lecturersQuery.refetch()}
        loadingLabel="Loading lecturers"
      >
        {(data) => (
          <>
            <DataTable
              columns={columns}
              rows={data.items}
              getRowKey={(lecturer) => lecturer.id}
              emptyState={
                <EmptyState
                  icon={<Users className="h-7 w-7" />}
                  title={search ? "No matching lecturers" : "No lecturers yet"}
                  description={
                    search
                      ? "Try a different name, email or staff ID."
                      : "Add teaching staff so they can run attendance sessions."
                  }
                  action={
                    !search && (
                      <Button onClick={openCreate} disabled={noDepartments}>
                        <Plus className="mr-2 h-4 w-4" /> Add lecturer
                      </Button>
                    )
                  }
                />
              }
            />
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              pageSize={data.pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </QueryBoundary>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit lecturer" : "Add lecturer"}</DialogTitle>
            <DialogDescription>
              {form.id
                ? "Update these details. Leave the password blank to keep it unchanged."
                : "Create a lecturer account so they can run sessions for assigned courses."}
            </DialogDescription>
          </DialogHeader>
          <form
            id="lecturer-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setFieldErrors({});
              saveMutation.mutate(form);
            }}
            className="space-y-4"
          >
            <Field label="Full name" htmlFor="lecturer-name" error={fieldErrors.name}>
              <Input
                id="lecturer-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Email" htmlFor="lecturer-email" error={fieldErrors.email}>
              <Input
                id="lecturer-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Staff ID" htmlFor="lecturer-staff" error={fieldErrors.staffId}>
              <Input
                id="lecturer-staff"
                required
                value={form.staffId}
                onChange={(e) => setForm({ ...form, staffId: e.target.value })}
                placeholder="STF-1001"
              />
            </Field>
            <Field label="Department" htmlFor="lecturer-dept" error={fieldErrors.departmentId}>
              <Select
                value={form.departmentId}
                onValueChange={(value) => setForm({ ...form, departmentId: value })}
              >
                <SelectTrigger id="lecturer-dept">
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
            <Field
              label={form.id ? "New password (optional)" : "Password"}
              htmlFor="lecturer-password"
              error={fieldErrors.password}
              hint="At least 8 characters."
            >
              <Input
                id="lecturer-password"
                type="password"
                autoComplete="new-password"
                required={!form.id}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="lecturer-form" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {form.id ? "Save changes" : "Add lecturer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Remove ${deleteTarget?.name}?`}
        description="Their account is deactivated and they are unassigned from every course. Courses they taught keep their attendance history."
        confirmLabel="Remove lecturer"
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </RouteTransition>
  );
}
