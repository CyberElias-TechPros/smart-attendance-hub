import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { studentHistory } from "@/lib/api.functions";
import { PageHeader } from "@/components/AppShell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { RouteTransition } from "@/components/RouteTransition";

const historyQO = queryOptions({ queryKey: ["student", "history"], queryFn: () => studentHistory() });

export const Route = createFileRoute("/student/history")({
  loader: ({ context }) => context.queryClient.ensureQueryData(historyQO),
  component: HistoryPage,
});

function HistoryPage() {
  const { data } = useSuspenseQuery(historyQO);
  return (
    <RouteTransition>
      <PageHeader title="Attendance history" subtitle="Every session you've signed in for." />
      {data.length === 0 ? (
        <EmptyState
          icon={<History className="h-7 w-7" />}
          title="No attendance records yet"
          description="Once you sign in to a lecture, it'll show up here."
        />
      ) : (
        <div className="rounded-2xl border border-border/70 bg-card shadow-elegant">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{new Date(r.timestamp).toLocaleDateString()}</TableCell>
                  <TableCell className="font-medium">{r.courseCode}</TableCell>
                  <TableCell className="text-muted-foreground">{r.courseTitle}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{new Date(r.timestamp).toLocaleTimeString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </RouteTransition>
  );
}
