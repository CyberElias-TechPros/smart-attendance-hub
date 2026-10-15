import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight, History, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { auditQO } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/audit")({
  component: AuditPage,
});

const ALL = "__all__";

/**
 * Audit trail (brief §9).
 *
 * Read-only by design: entries are appended by the server for every attendance
 * correction, void, period finalisation and export, so an administrator can
 * answer "who changed this, when, and why" without trusting the UI that made
 * the change.
 */
function AuditPage() {
  const [action, setAction] = useState<string>(ALL);
  const [entityType, setEntityType] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const query = {
    action: action === ALL ? undefined : action,
    entityType: entityType === ALL ? undefined : entityType,
    page,
    pageSize: 50,
  };
  const auditQ = useQuery(auditQO(query));
  const data = auditQ.data;
  const items = (data?.items ?? []).filter((entry) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return [entry.action, entry.actorEmail, entry.entityId, entry.courseId, entry.reason]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <RouteTransition>
      <PageHeader
        title="Audit trail"
        subtitle="Every attendance change, void, period finalisation and export is recorded here with its reason."
        actions={
          <Badge variant="secondary" className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Append-only
          </Badge>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by actor, reason, entity id…"
          className="max-w-xs"
          aria-label="Filter audit entries"
        />
        <Select
          value={action}
          onValueChange={(value) => {
            setAction(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[15rem]" aria-label="Filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All actions</SelectItem>
            <SelectItem value="attendance.update">Attendance corrections</SelectItem>
            <SelectItem value="attendance.void">Attendance voids</SelectItem>
            <SelectItem value="export.generate">Report exports</SelectItem>
            <SelectItem value="semester.finalize">Period finalisation</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={entityType}
          onValueChange={(value) => {
            setEntityType(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[13rem]" aria-label="Filter by entity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All entities</SelectItem>
            <SelectItem value="attendance_record">Attendance records</SelectItem>
            <SelectItem value="course">Courses</SelectItem>
            <SelectItem value="semester">Semesters</SelectItem>
            <SelectItem value="report">Reports</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elegant">
        {auditQ.isLoading && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}
        {auditQ.isError && (
          <p className="p-6 text-sm text-destructive">
            Could not load the audit trail.{" "}
            {auditQ.error instanceof Error ? auditQ.error.message : ""}
          </p>
        )}
        {data && items.length === 0 && (
          <EmptyState
            className="m-4"
            icon={<History className="h-7 w-7" />}
            title="Nothing recorded yet"
            description="Corrections, voids, finalisations and exports appear here as they happen."
          />
        )}
        {data && items.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-[11px]",
                          entry.action.startsWith("attendance") && "border-warning/40 text-warning",
                          entry.action === "export.generate" && "border-primary/40 text-primary",
                        )}
                      >
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{entry.actorEmail ?? entry.actorId ?? "system"}</div>
                      <div className="text-muted-foreground">{entry.actorRole ?? ""}</div>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {entry.entityType}
                      {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ""}
                    </TableCell>
                    <TableCell className="max-w-[22rem] text-xs">{entry.reason ?? "—"}</TableCell>
                    <TableCell className="max-w-[18rem] text-[11px] text-muted-foreground">
                      {entry.before !== undefined || entry.after !== undefined ? (
                        <span className="font-mono">
                          {JSON.stringify(entry.before ?? null)} →{" "}
                          {JSON.stringify(entry.after ?? null)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
            <span>
              {(data.page - 1) * data.pageSize + 1}–
              {Math.min(data.page * data.pageSize, data.total)} of {data.total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="font-mono">
                {data.page} / {lastPage}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </RouteTransition>
  );
}
