import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/AppShell";
import { Column, DataTable, Pagination, SearchInput, useDebounced } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import type { AuditEntry } from "../../shared/schemas";
import { api } from "@/lib/api";

export const Route = createFileRoute("/admin/audit")({ component: AuditPage });

const PAGE_SIZE = 25;

/** Colour-codes the broad category of an action so scanning the log is fast. */
function toneFor(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.includes("deleted") || action.includes("failed")) return "destructive";
  if (action.startsWith("auth.")) return "secondary";
  if (action.includes("created")) return "default";
  return "outline";
}

function AuditPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput);

  const query = useQuery({
    queryKey: ["admin", "audit", { page, search }],
    queryFn: () => api.listAudit({ page, pageSize: PAGE_SIZE, search }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<AuditEntry>[] = [
    {
      key: "createdAt",
      header: "When",
      render: (entry) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {new Date(entry.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      render: (entry) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{entry.actorName ?? "System"}</span>
          {entry.actorRole && (
            <span className="text-xs capitalize text-muted-foreground">{entry.actorRole}</span>
          )}
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (entry) => (
        <Badge variant={toneFor(entry.action)} className="font-mono text-[11px]">
          {entry.action}
        </Badge>
      ),
    },
    {
      key: "resource",
      header: "Resource",
      hideOnMobile: true,
      render: (entry) => (
        <span className="font-mono text-xs text-muted-foreground">
          {entry.resource}
          {entry.resourceId ? `/${entry.resourceId.slice(0, 8)}` : ""}
        </span>
      ),
    },
    {
      key: "metadata",
      header: "Details",
      hideOnMobile: true,
      render: (entry) =>
        entry.metadata ? (
          <span className="block max-w-xs truncate font-mono text-[11px] text-muted-foreground">
            {Object.entries(entry.metadata)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(" ")}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <RouteTransition>
      <PageHeader
        title="Audit log"
        subtitle="Who did what, and when. Entries are retained for 180 days."
      />

      <div className="mb-4">
        <SearchInput
          value={searchInput}
          onChange={(value) => {
            setSearchInput(value);
            setPage(1);
          }}
          placeholder="Search by action, resource or person"
          label="Search audit log"
        />
      </div>

      <QueryBoundary
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        onRetry={() => query.refetch()}
        loadingLabel="Loading audit log"
      >
        {(data) => (
          <>
            <DataTable
              columns={columns}
              rows={data.items}
              getRowKey={(entry) => entry.id}
              emptyState={
                <EmptyState
                  icon={<ScrollText className="h-7 w-7" />}
                  title={search ? "No matching entries" : "No activity recorded yet"}
                  description={
                    search
                      ? "Try a different search term."
                      : "Sign-ins, record changes and administrative actions appear here."
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
    </RouteTransition>
  );
}
