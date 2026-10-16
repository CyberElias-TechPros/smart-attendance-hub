import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Building, GraduationCap, Landmark, Plus, Save, Trash2, Users } from "lucide-react";

import { PageHeader, StatCard } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { faculties as facultiesApi } from "@/lib/api";
import { coursesReportQO, deptsQO, facultiesQO } from "@/lib/queries";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/faculties")({
  beforeLoad: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(facultiesQO),
      context.queryClient.ensureQueryData(deptsQO),
    ]);
  },
  component: FacultiesPage,
});

const NO_FACULTY = "__none__";

function FacultiesPage() {
  const qc = useQueryClient();
  const facultiesQ = useQuery(facultiesQO);
  const deptsQ = useQuery(deptsQO);
  // The report carries per-course roll-ups, so faculty/dean decisions can be
  // made from real attendance rather than a head-count alone.
  const reportQ = useQuery(coursesReportQO({ pageSize: 500 }));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; code: string } | null>(null);

  const faculties = facultiesQ.data ?? [];
  const departments = deptsQ.data ?? [];
  const rows = reportQ.data?.rows ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["faculties"] });
    void qc.invalidateQueries({ queryKey: ["departments"] });
    void qc.invalidateQueries({ queryKey: ["reports", "courses"] });
  };

  const createFaculty = useMutation({
    mutationFn: (input: { name: string; code: string }) => facultiesApi.create(input),
    onSuccess: () => {
      toast.success("Faculty created");
      setDialogOpen(false);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateFaculty = useMutation({
    mutationFn: (input: { id: string; name: string; code: string }) =>
      facultiesApi.update(input.id, { name: input.name, code: input.code }),
    onSuccess: () => {
      toast.success("Faculty updated");
      setEditing(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeFaculty = useMutation({
    mutationFn: (id: string) => facultiesApi.remove(id),
    onSuccess: () => {
      toast.success("Faculty removed");
      invalidate();
    },
    // The server refuses to orphan departments; surface that reason verbatim.
    onError: (err: Error) => toast.error(err.message),
  });

  const assignDepartment = useMutation({
    mutationFn: (input: { departmentId: string; facultyId: string | null }) =>
      facultiesApi.setDepartment(input.departmentId, input.facultyId),
    onSuccess: () => {
      toast.success("Department moved");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <RouteTransition>
      <PageHeader
        title="Faculties"
        subtitle="The top of the academic structure: Faculty → Department → Course. Reports roll up through it."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New faculty
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Faculties" value={faculties.length} icon={Landmark} />
        <StatCard label="Departments" value={departments.length} icon={Building} />
        <StatCard label="Courses" value={rows.length} icon={GraduationCap} />
        <StatCard
          label="Students on rosters"
          value={rows.reduce((a, r) => a + r.enrolled, 0)}
          icon={Users}
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Faculty roll-up</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {faculties.length === 0 ? (
            <EmptyState
              className="m-4"
              icon={<Landmark className="h-7 w-7" />}
              title="No faculties yet"
              description="Create the first faculty, then attach departments to it."
              action={<Button onClick={() => setDialogOpen(true)}>New faculty</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Faculty</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Departments</TableHead>
                    <TableHead className="text-right">Courses</TableHead>
                    <TableHead className="text-right">Students</TableHead>
                    <TableHead className="text-right">Attendance</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {faculties.map((faculty) => {
                    const facultyCourses = rows.filter((r) => r.facultyId === faculty.id);
                    const facultyDepts = new Set(
                      facultyCourses.map((r) => r.departmentId).filter(Boolean),
                    );
                    const attended = facultyCourses.reduce((a, r) => a + r.attended, 0);
                    const expected = facultyCourses.reduce((a, r) => a + r.expected, 0);
                    const rate =
                      expected === 0 ? null : Math.round((attended / expected) * 1000) / 10;
                    return (
                      <TableRow key={faculty.id}>
                        <TableCell>
                          {editing?.id === faculty.id ? (
                            <Input
                              value={editing.name}
                              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                              className="h-8"
                            />
                          ) : (
                            <span className="font-medium">{faculty.name}</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {editing?.id === faculty.id ? (
                            <Input
                              value={editing.code}
                              onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                              className="h-8 w-24 font-mono"
                            />
                          ) : (
                            faculty.code
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">{facultyDepts.size}</TableCell>
                        <TableCell className="text-right font-mono">
                          {facultyCourses.length}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {facultyCourses.reduce((a, r) => a + r.enrolled, 0)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {rate === null ? "—" : `${rate}%`}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {editing?.id === faculty.id ? (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    updateFaculty.mutate({
                                      id: faculty.id,
                                      name: editing.name,
                                      code: editing.code,
                                    })
                                  }
                                >
                                  <Save className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setEditing({
                                      id: faculty.id,
                                      name: faculty.name,
                                      code: faculty.code,
                                    })
                                  }
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-destructive"
                                  onClick={() => removeFaculty.mutate(faculty.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Departments &amp; their faculty</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Faculty</TableHead>
                  <TableHead className="text-right">Courses</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((dept) => {
                  const sample = rows.find((r) => r.departmentId === dept.id);
                  const matched = faculties.find((f) => f.id === sample?.facultyId);
                  return (
                    <TableRow key={dept.id}>
                      <TableCell className="font-medium">{dept.name}</TableCell>
                      <TableCell className="font-mono text-xs">{dept.code}</TableCell>
                      <TableCell>
                        <Select
                          value={matched?.id ?? NO_FACULTY}
                          onValueChange={(value) =>
                            assignDepartment.mutate({
                              departmentId: dept.id,
                              facultyId: value === NO_FACULTY ? null : value,
                            })
                          }
                        >
                          <SelectTrigger className="w-[15rem]">
                            <SelectValue placeholder={matched?.name ?? "Unassigned"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_FACULTY}>Unassigned</SelectItem>
                            {faculties.map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {rows.filter((r) => r.departmentId === dept.id).length}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {departments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="p-6 text-sm text-muted-foreground">
                      No departments yet — create one from the Departments page.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New faculty</DialogTitle>
            <DialogDescription>
              Faculties group departments; every report can then be rolled up to this level.
            </DialogDescription>
          </DialogHeader>
          <form
            id="faculty-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              createFaculty.mutate({
                name: String(form.get("name") ?? "").trim(),
                code: String(form.get("code") ?? "").trim(),
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="faculty-name">Name</Label>
              <Input
                id="faculty-name"
                name="name"
                required
                minLength={2}
                placeholder="Faculty of Science"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="faculty-code">Short code</Label>
              <Input
                id="faculty-code"
                name="code"
                required
                minLength={2}
                maxLength={12}
                placeholder="SCI"
              />
              <p className="text-xs text-muted-foreground">
                Appears in exports and the sidebar filters. Must be unique.
              </p>
            </div>
            <Badge variant="secondary">Codes are matched case-insensitively</Badge>
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="faculty-form" disabled={createFaculty.isPending}>
              {createFaculty.isPending ? "Creating…" : "Create faculty"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RouteTransition>
  );
}
