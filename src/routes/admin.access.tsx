import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BadgeCheck,
  History,
  KeyRound,
  Search,
  ShieldCheck,
  ShieldMinus,
  ShieldPlus,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader, StatCard } from "@/components/AppShell";
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
import { Skeleton } from "@/components/ui/skeleton";
import { accessQO } from "@/lib/queries";
import { access as accessApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { StaffAccess } from "@/lib/types";

/**
 * Access & roles (plan §9 / P5.2).
 *
 * The brief's §9 asks for lecturers to be "limited to their courses unless
 * granted more", and for those grants to be accountable. This screen is where an
 * administrator grants them: pick the person, switch the capability on, and the
 * change is written to the audit trail with a name and a timestamp.
 *
 * Two deliberate choices are visible here:
 *   * Administrators are shown as holding everything, because they do — a
 *     checkbox next to an admin would misrepresent the check the API performs.
 *   * A capability that grants nothing does not exist: the catalogue comes from
 *     the server, and every entry names the guard it satisfies.
 */
export const Route = createFileRoute("/admin/access")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }, { title: "Access & roles — SLAMS" }],
  }),
  component: AccessPage,
});

function AccessPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(accessQO);
  const [search, setSearch] = useState("");
  const [pendingDemote, setPendingDemote] = useState<StaffAccess | null>(null);

  const staff = useMemo(() => {
    const list = data?.staff ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.email.toLowerCase().includes(needle) ||
        (s.departmentName ?? "").toLowerCase().includes(needle),
    );
  }, [data?.staff, search]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["access"] });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };

  const toggle = useMutation({
    // Both calls answer with the same shape, so the mutation has one result type.
    mutationFn: async (input: { userId: string; permission: string; on: boolean }) => {
      if (input.on) {
        const result = await accessApi.grant(input.userId, input.permission);
        return { ok: result.ok, changed: result.created };
      }
      const result = await accessApi.revoke(input.userId, input.permission);
      return { ok: result.ok, changed: result.removed };
    },
    onSuccess: (_result, input) => {
      toast.success(input.on ? "Capability granted" : "Capability revoked");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const role = useMutation({
    mutationFn: (input: { userId: string; role: "admin" | "lecturer" }) =>
      accessApi.setRole(input.userId, input.role),
    onSuccess: (_result, input) => {
      toast.success(
        input.role === "admin" ? "Promoted to administrator" : "Returned to lecturer access",
      );
      setPendingDemote(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const lecturers = (data?.staff ?? []).filter((s) => s.role !== "admin").length;

  return (
    <RouteTransition>
      <PageHeader
        title="Access & roles"
        subtitle="Who may read and export what — and who administers the institution. Every change here is written to the audit trail."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Administrators"
          value={isLoading ? "—" : (data?.admins ?? 0)}
          icon={ShieldCheck}
          hint="Full access by role"
        />
        <StatCard
          label="Staff accounts"
          value={isLoading ? "—" : (data?.staff.length ?? 0)}
          icon={UserCog}
          hint="Administrators and lecturers"
        />
        <StatCard
          label="Lecturers"
          value={isLoading ? "—" : lecturers}
          icon={KeyRound}
          hint="Own courses by default"
        />
        <StatCard
          label="Capabilities"
          value={isLoading ? "—" : (data?.permissions.length ?? 0)}
          icon={BadgeCheck}
          hint="Grantable beyond a role"
        />
      </div>

      <Card className="mt-4">
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-base">Staff and their capabilities</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              A capability widens what somebody may <span className="font-medium">read</span>; it
              never lets them change another lecturer&rsquo;s records.
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search staff or department"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="sticky left-0 z-10 bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Person
                    </th>
                    {(data?.permissions ?? []).map((permission) => (
                      <th
                        key={permission.key}
                        className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        title={permission.description}
                      >
                        <span className="inline-block max-w-[9rem] whitespace-normal leading-tight">
                          {permission.label}
                        </span>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Role
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((person) => {
                    const isAdmin = person.role === "admin";
                    return (
                      <tr key={person.id} className="border-t border-border">
                        <td className="sticky left-0 z-10 bg-card px-3 py-3">
                          <div className="font-medium">{person.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {person.email}
                            {person.departmentName ? ` · ${person.departmentName}` : ""}
                          </div>
                        </td>
                        {(data?.permissions ?? []).map((permission) => {
                          const on = person.permissions.includes(permission.key);
                          return (
                            <td key={permission.key} className="px-3 py-3 text-center">
                              {isAdmin ? (
                                <span
                                  className="text-xs text-muted-foreground"
                                  title="Administrators hold every capability by role"
                                >
                                  ✓
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={on}
                                  aria-label={`${permission.label} for ${person.name}`}
                                  disabled={toggle.isPending}
                                  onClick={() =>
                                    toggle.mutate({
                                      userId: person.id,
                                      permission: permission.key,
                                      on: !on,
                                    })
                                  }
                                  className={cn(
                                    "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
                                    on ? "border-primary bg-primary/80" : "border-border bg-muted",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform",
                                      on ? "translate-x-5" : "translate-x-0.5",
                                    )}
                                  />
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Badge variant={isAdmin ? "default" : "outline"}>
                              {isAdmin ? "Administrator" : "Lecturer"}
                            </Badge>
                            {isAdmin ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={role.isPending}
                                onClick={() => setPendingDemote(person)}
                              >
                                <ShieldMinus className="mr-1.5 h-3.5 w-3.5" />
                                Demote
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={role.isPending}
                                onClick={() => role.mutate({ userId: person.id, role: "admin" })}
                              >
                                <ShieldPlus className="mr-1.5 h-3.5 w-3.5" />
                                Make admin
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-muted-foreground" />
            What each capability does
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {(data?.permissions ?? []).map((permission) => (
            <div key={permission.key} className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{permission.label}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {permission.key}
                </code>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{permission.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(pendingDemote)}
        onOpenChange={(open) => !open && setPendingDemote(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove administrator access?</DialogTitle>
            <DialogDescription>
              {pendingDemote?.name} returns to lecturer access: their own courses, plus whatever
              capabilities are switched on above. The change is recorded in the audit trail, and the
              institution always keeps at least one administrator.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDemote(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={role.isPending}
              onClick={() =>
                pendingDemote && role.mutate({ userId: pendingDemote.id, role: "lecturer" })
              }
            >
              Demote to lecturer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RouteTransition>
  );
}
