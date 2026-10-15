import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AtSign,
  Bell,
  BellOff,
  CalendarClock,
  CheckCheck,
  FileSpreadsheet,
  Lock,
  PenLine,
  Trash2,
  TrendingDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { notificationsQO } from "@/lib/queries";
import { notifications } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Notification } from "@/lib/types";

interface NotificationSearch {
  unread?: boolean;
}

export const Route = createFileRoute("/admin/notifications")({
  validateSearch: (search: Record<string, unknown>): NotificationSearch => ({
    unread:
      search.unread === "1" || search.unread === "true" || search.unread === true || undefined,
  }),
  component: NotificationsPage,
});

/** Icon + tone per event kind, so the inbox is scannable at a glance. */
const KIND_STYLE: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  "attendance.corrected": {
    icon: PenLine,
    tone: "text-warning bg-warning/10",
    label: "Correction",
  },
  "attendance.voided": {
    icon: Trash2,
    tone: "text-destructive bg-destructive/10",
    label: "Withdrawn",
  },
  "export.ready": { icon: FileSpreadsheet, tone: "text-primary bg-primary/10", label: "Export" },
  "session.started": { icon: CalendarClock, tone: "text-success bg-success/10", label: "Lecture" },
  "session.closed": { icon: Lock, tone: "text-muted-foreground bg-muted", label: "Closed" },
  "at_risk.course": {
    icon: TrendingDown,
    tone: "text-destructive bg-destructive/10",
    label: "Below target",
  },
  "semester.finalized": { icon: Lock, tone: "text-primary bg-primary/10", label: "Finalised" },
  mention: { icon: AtSign, tone: "text-primary bg-primary/10", label: "Mention" },
};

function styleFor(kind: string) {
  return (
    KIND_STYLE[kind] ?? {
      icon: Bell,
      tone: "text-muted-foreground bg-muted",
      label: kind.split(".")[0],
    }
  );
}

/** "3 minutes ago" — the inbox is read in the moment, so absolute clocks are noise. */
function ago(ms: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function dayBucket(ms: number): string {
  const now = new Date();
  const then = new Date(ms);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startOfToday) return "Today";
  if (ms >= startOfToday - 86_400_000) return "Yesterday";
  return then.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: then.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function NotificationsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);

  const listQ = useQuery(notificationsQO({ page, unreadOnly: search.unread }));
  const data = listQ.data;

  const markRead = useMutation({
    mutationFn: (id: string) => notifications.markRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const markAll = useMutation({
    mutationFn: () => notifications.markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const items = data?.items ?? [];
  const grouped = useMemo(() => {
    const out: Array<{ bucket: string; rows: Notification[] }> = [];
    for (const n of items) {
      const bucket = dayBucket(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.bucket === bucket) last.rows.push(n);
      else out.push({ bucket, rows: [n] });
    }
    return out;
  }, [items]);

  const pageSize = 30;
  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  const open = (n: Notification) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.href) void navigate({ to: n.href });
  };

  return (
    <RouteTransition>
      <PageHeader
        title="Notifications"
        subtitle="Corrections to attendance, finished exports and period events — every entry points at the thing it describes."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border/70 p-0.5">
              {[
                { label: "All", value: undefined },
                { label: "Unread", value: true },
              ].map((tab) => {
                const active = Boolean(search.unread) === Boolean(tab.value);
                return (
                  <button
                    key={tab.label}
                    onClick={() =>
                      void navigate({
                        to: "/admin/notifications",
                        search: tab.value ? { unread: true } : {},
                      })
                    }
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition",
                      active ? "bg-primary/10 text-primary" : "text-muted-foreground",
                    )}
                  >
                    {tab.label}
                    {tab.value && data?.unread ? ` (${data.unread})` : ""}
                  </button>
                );
              })}
            </div>
            <Button
              variant="outline"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending || !data?.unread}
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark all read
            </Button>
          </div>
        }
      />

      {listQ.isError && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          Could not load your notifications.{" "}
          {listQ.error instanceof Error ? listQ.error.message : "Please retry."}
        </div>
      )}

      {listQ.isLoading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {data && items.length === 0 && (
        <EmptyState
          icon={search.unread ? <BellOff className="h-7 w-7" /> : <Bell className="h-7 w-7" />}
          title={search.unread ? "Nothing unread" : "No notifications yet"}
          description={
            search.unread
              ? "You are all caught up. Switch to All to read what you have already seen."
              : "Corrections, exports and period events will show up here as they happen."
          }
        />
      )}

      <div className="space-y-6">
        {grouped.map((group) => (
          <section key={group.bucket} className="space-y-2">
            <h2 className="px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {group.bucket}
            </h2>
            <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elegant">
              {group.rows.map((n) => {
                const style = styleFor(n.kind);
                const unread = !n.readAt;
                return (
                  <li
                    key={n.id}
                    className={cn(
                      "flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0",
                      unread && "bg-primary/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                        style.tone,
                      )}
                    >
                      <style.icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("text-sm", unread ? "font-semibold" : "font-medium")}>
                          {n.title}
                        </span>
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                          {style.label}
                        </Badge>
                        {unread && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-primary"
                            aria-label="Unread"
                          />
                        )}
                      </div>
                      {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span title={new Date(n.createdAt).toLocaleString()}>
                          {ago(n.createdAt)}
                        </span>
                        {n.audience !== "user" && (
                          <span className="rounded border border-border/70 px-1.5 py-px">
                            {n.audience === "course"
                              ? "course-wide"
                              : n.audience === "role"
                                ? "role-wide"
                                : "institution-wide"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {n.href && (
                        <Button variant="ghost" size="sm" onClick={() => open(n)}>
                          Open
                        </Button>
                      )}
                      {unread && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markRead.mutate(n.id)}
                          disabled={markRead.isPending}
                        >
                          Mark read
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {(data?.total ?? 0) > pageSize && (
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data?.total ?? 0)} of{" "}
            {data?.total ?? 0}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Newer
            </Button>
            <span className="font-mono">
              {page} / {lastPage}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= lastPage}
              onClick={() => setPage((p) => p + 1)}
            >
              Older
            </Button>
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Read the full record of who changed what in the{" "}
        <Link to="/admin/audit" className="text-primary underline-offset-4 hover:underline">
          audit trail
        </Link>
        .
      </p>
    </RouteTransition>
  );
}
