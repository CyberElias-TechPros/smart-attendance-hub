import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { History } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/AppShell";
import { Column, DataTable, Pagination, SearchInput, useDebounced } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

export const Route = createFileRoute("/student/history")({ component: HistoryPage });

const PAGE_SIZE = 20;

type Entry = {
  id: string;
  timestamp: number;
  method: string;
  courseCode: string;
  courseTitle: string;
  topic?: string;
};

function HistoryPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput);

  const query = useQuery({
    queryKey: ["student", "history", { page, search }],
    queryFn: () => api.studentHistory({ page, pageSize: PAGE_SIZE, search }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Entry>[] = [
    {
      key: "course",
      header: "Course",
      render: (entry) => (
        <div className="min-w-0">
          <span className="font-mono text-sm font-semibold text-primary">{entry.courseCode}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {entry.topic ?? entry.courseTitle}
          </span>
        </div>
      ),
    },
    {
      key: "timestamp",
      header: "Signed in",
      render: (entry) => (
        <span className="whitespace-nowrap text-sm">
          {new Date(entry.timestamp).toLocaleString()}
        </span>
      ),
    },
    {
      key: "method",
      header: "Method",
      hideOnMobile: true,
      render: (entry) => (
        <Badge variant="outline" className="capitalize">
          {entry.method}
        </Badge>
      ),
    },
  ];

  return (
    <RouteTransition>
      <PageHeader title="Attendance history" subtitle="Every session you have signed in to." />

      <div className="mb-4">
        <SearchInput
          value={searchInput}
          onChange={(value) => {
            setSearchInput(value);
            setPage(1);
          }}
          placeholder="Search by course"
          label="Search attendance history"
        />
      </div>

      <QueryBoundary
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        onRetry={() => query.refetch()}
        loadingLabel="Loading history"
      >
        {(data) => (
          <>
            <DataTable
              columns={columns}
              rows={data.items}
              getRowKey={(entry) => entry.id}
              emptyState={
                <EmptyState
                  icon={<History className="h-7 w-7" />}
                  title={search ? "No matching records" : "No attendance yet"}
                  description={
                    search
                      ? "Try a different course code."
                      : "Once you sign in to a session it will appear here."
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
