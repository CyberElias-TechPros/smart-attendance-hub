import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PlayCircle, Radio } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/AppShell";
import { Column, DataTable, SearchInput, useDebounced } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import type { AttendanceSession } from "../../shared/schemas";
import { api } from "@/lib/api";

export const Route = createFileRoute("/lecturer/sessions/")({ component: SessionsList });

function SessionsList() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput);

  const query = useQuery({
    queryKey: ["lecturer", "sessions"],
    queryFn: () => api.lecturerSessions(),
    refetchInterval: 30_000,
  });

  const rows = (query.data?.items ?? []).filter((session) =>
    search
      ? (session.courseCode ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (session.topic ?? "").toLowerCase().includes(search.toLowerCase())
      : true,
  );

  const columns: Column<AttendanceSession>[] = [
    {
      key: "course",
      header: "Course",
      render: (session) => (
        <div className="min-w-0">
          <span className="font-mono text-sm font-semibold text-primary">{session.courseCode}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {session.topic ?? session.courseTitle}
          </span>
        </div>
      ),
    },
    {
      key: "startedAt",
      header: "Started",
      render: (session) => (
        <span className="whitespace-nowrap text-sm">
          {new Date(session.startedAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "attendance",
      header: "Present",
      render: (session) => (
        <span className="font-mono text-sm">
          {session.attendedCount ?? 0}/{session.enrolledCount ?? 0}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (session) =>
        !session.endedAt && session.expiresAt > Date.now() ? (
          <Badge variant="secondary" className="gap-1 bg-success/15 text-success">
            <Radio className="h-3 w-3" /> Live
          </Badge>
        ) : (
          <Badge variant="outline">Closed</Badge>
        ),
    },
  ];

  return (
    <RouteTransition>
      <PageHeader title="Sessions" subtitle="Every attendance session you have run." />

      <div className="mb-4">
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Search by course or topic"
          label="Search sessions"
        />
      </div>

      <QueryBoundary
        isLoading={query.isPending}
        error={query.error}
        data={rows}
        onRetry={() => query.refetch()}
        loadingLabel="Loading sessions"
      >
        {(items) => (
          <DataTable
            columns={columns}
            rows={items}
            getRowKey={(session) => session.id}
            onRowClick={(session) =>
              navigate({ to: "/lecturer/sessions/$sessionId", params: { sessionId: session.id } })
            }
            emptyState={
              <EmptyState
                icon={<PlayCircle className="h-7 w-7" />}
                title={search ? "No matching sessions" : "No sessions yet"}
                description={
                  search
                    ? "Try a different course code or topic."
                    : "Open one of your courses and start a session to take attendance."
                }
              />
            }
          />
        )}
      </QueryBoundary>
    </RouteTransition>
  );
}
