import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GraduationCap, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PublicUser } from "../../shared/schemas";
import { ApiClientError, api, errorMessage } from "@/lib/api";

export const Route = createFileRoute("/admin/students")({ component: StudentsPage });

const LEVELS = ["100", "200", "300", "400", "500"];
const PAGE_SIZE = 20;

interface FormState {
  id?: string;
  name: string;
  email: string;
  matricNo: string;
  departmentId: string;
  level: string;
  password: string;
}

const emptyForm: FormState = {
  name: "",
  email: "",
  matricNo: "",
  departmentId: "",
  level: "100",
  password: "",
};

function StudentsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput);
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<PublicUser | null>(null);

  // Reset to the first page whenever the filter changes, otherwise the user can
  // land on an out-of-range page showing nothing.
  const effectivePage = page;

  const studentsQuery = useQuery({
    queryKey: ["admin", "users", "student", { page: effectivePage, search, sort, dir }],
    queryFn: () =>
      api.listUsers({ role: "student", page: effectivePage, pageSize: PAGE_SIZE, search, sort, dir }),
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
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormState) => {
      const payload: Record<string, unknown> = {
        name: values.name,
        email: values.email,
        matricNo: values.matricNo,
        departmentId: values.departmentId,
        level: values.level,
      };
      if (values.id) {
        if (values.password) payload.password = values.password;
        return api.updateStudent({ ...payload, id: values.id });
      }
      return api.createStudent({ ...payload, password: values.password });
    },
    onSuccess: (_data, values) => {
      toast.success(values.id ? "Student updated" : "Student added");
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
      toast.success("Student removed");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openCreate = () => {
    setForm({ ...emptyForm, departmentId: departments[0]?.id ?? "" });
    setFieldErrors({});
    setDialogOpen(true);
  };

  const openEdit = (student: PublicUser) => {
    setForm({
      id: student.id,
      name: student.name,
      email: student.email,
      matricNo: student.matricNo ?? "",
      departmentId: student.departmentId ?? departments[0]?.id ?? "",
      level: student.level ?? "100",
      password: "",
    });
    setFieldErrors({});
    setDialogOpen(true);
  };

  const toggleSort = (key: string) => {
    if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setDir("asc");
    }
    setPage(1);
  };

  const columns: Column<PublicUser>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (student) => <span className="font-medium">{student.name}</span>,
    },
    {
      key: "matricNo",
      header: "Matric no.",
      render: (student) => <span className="font-mono text-xs">{student.matricNo ?? "—"}</span>,
    },
    {
      key: "email",
      header: "Email",
      sortable: true,
      hideOnMobile: true,
      render: (student) => <span className="text-muted-foreground">{student.email}</span>,
    },
    {
      key: "department",
      header: "Department",
      hideOnMobile: true,
      render: (student) => student.departmentName ?? "—",
    },
    { key: "level", header: "Level", sortable: true, render: (student) => student.level ?? "—" },
    {
      key: "actions",
      header: "Actions",
      className: "text-right",
      render: (student) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openEdit(student)}
            aria-label={`Edit ${student.name}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleteTarget(student)}
            aria-label={`Remove ${student.name}`}
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
        title="Students"
        subtitle="Register students and manage their enrolment details."
        actions={
          <Button onClick={openCreate} disabled={noDepartments}>
            <Plus className="mr-2 h-4 w-4" /> Add student
          </Button>
        }
      />

      {noDepartments && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          Create a department first — every student must belong to one.
        </div>
      )}

      <div className="mb-4">
        <SearchInput
          value={searchInput}
          onChange={(value) => {
            setSearchInput(value);
            setPage(1);
          }}
          placeholder="Search by name, email or matric no."
          label="Search students"
        />
      </div>

      <QueryBoundary
        isLoading={studentsQuery.isPending}
        error={studentsQuery.error}
        data={studentsQuery.data}
        onRetry={() => studentsQuery.refetch()}
        loadingLabel="Loading students"
      >
        {(data) => (
          <>
            <DataTable
              columns={columns}
              rows={data.items}
              getRowKey={(student) => student.id}
              sort={sort}
              dir={dir}
              onSortChange={toggleSort}
              emptyState={
                <EmptyState
                  icon={<GraduationCap className="h-7 w-7" />}
                  title={search ? "No matching students" : "No students yet"}
                  description={
                    search
                      ? "Try a different name, email or matriculation number."
                      : "Add your first student to start tracking attendance."
                  }
                  action={
                    !search && (
                      <Button onClick={openCreate} disabled={noDepartments}>
                        <Plus className="mr-2 h-4 w-4" /> Add student
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
            <DialogTitle>{form.id ? "Edit student" : "Add student"}</DialogTitle>
            <DialogDescription>
              {form.id
                ? "Update this student's details. Leave the password blank to keep it unchanged."
                : "Create a student account. They can sign in immediately with these credentials."}
            </DialogDescription>
          </DialogHeader>
          <form
            id="student-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setFieldErrors({});
              saveMutation.mutate(form);
            }}
            className="space-y-4"
          >
            <Field label="Full name" htmlFor="student-name" error={fieldErrors.name}>
              <Input
                id="student-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Email" htmlFor="student-email" error={fieldErrors.email}>
              <Input
                id="student-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field
              label="Matriculation number"
              htmlFor="student-matric"
              error={fieldErrors.matricNo}
            >
              <Input
                id="student-matric"
                required
                value={form.matricNo}
                onChange={(e) => setForm({ ...form, matricNo: e.target.value })}
                placeholder="CSC/21/1001"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department" htmlFor="student-dept" error={fieldErrors.departmentId}>
                <Select
                  value={form.departmentId}
                  onValueChange={(value) => setForm({ ...form, departmentId: value })}
                >
                  <SelectTrigger id="student-dept">
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
              <Field label="Level" htmlFor="student-level" error={fieldErrors.level}>
                <Select
                  value={form.level}
                  onValueChange={(value) => setForm({ ...form, level: value })}
                >
                  <SelectTrigger id="student-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level} level
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field
              label={form.id ? "New password (optional)" : "Password"}
              htmlFor="student-password"
              error={fieldErrors.password}
              hint="At least 8 characters."
            >
              <Input
                id="student-password"
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
            <Button type="submit" form="student-form" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {form.id ? "Save changes" : "Add student"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Remove ${deleteTarget?.name}?`}
        description="Their account is deactivated and they are unenrolled from all courses. Past attendance records are kept so historical reports stay accurate."
        confirmLabel="Remove student"
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </RouteTransition>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
