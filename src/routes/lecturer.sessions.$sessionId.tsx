import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  MapPin,
  Plus,
  Radio,
  StopCircle,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader, StatCard } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, errorMessage } from "@/lib/api";

export const Route = createFileRoute("/lecturer/sessions/$sessionId")({ component: SessionPage });

/** Live countdown, recomputed once a second while the session is open. */
function useCountdown(expiresAt: number | undefined, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!expiresAt) return { text: "—", expired: true, msLeft: 0 };
  const msLeft = Math.max(0, expiresAt - now);
  const totalSeconds = Math.floor(msLeft / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    text: `${minutes}:${String(seconds).padStart(2, "0")}`,
    expired: msLeft === 0,
    msLeft,
  };
}

function SessionPage() {
  const { sessionId } = Route.useParams();
  const queryClient = useQueryClient();
  const [endOpen, setEndOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["sessions", sessionId],
    queryFn: () => api.sessionDetail(sessionId),
    // Poll while the session is live so the lecturer sees arrivals in near
    // real time; stop polling once it is closed to avoid pointless requests.
    refetchInterval: (q) => {
      const detail = q.state.data;
      if (!detail) return 5_000;
      const live = !detail.session.endedAt && detail.session.expiresAt > Date.now();
      return live ? 5_000 : false;
    },
  });

  const session = query.data?.session;
  const isLive = !!session && !session.endedAt && session.expiresAt > Date.now();
  const countdown = useCountdown(session?.expiresAt, isLive);

  // Render the QR client-side from the join URL; nothing secret leaves the page
  // beyond the code the lecturer is already displaying.
  const joinUrl = useMemo(
    () =>
      session
        ? `${window.location.origin}/student/attend?code=${encodeURIComponent(session.code)}`
        : "",
    [session],
  );

  useEffect(() => {
    let cancelled = false;
    if (!joinUrl || !isLive) {
      setQrDataUrl(null);
      return;
    }
    // `qrcode` is only needed on this screen — load it lazily.
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(joinUrl, { width: 512, margin: 1, errorCorrectionLevel: "M" }),
      )
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl, isLive]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sessions", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["lecturer"] });
    if (session) queryClient.invalidateQueries({ queryKey: ["courses", session.courseId] });
  };

  const endMutation = useMutation({
    mutationFn: () => api.endSession(sessionId),
    onSuccess: () => {
      toast.success("Session ended");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const extendMutation = useMutation({
    mutationFn: (minutes: number) => api.extendSession(sessionId, minutes),
    onSuccess: () => {
      toast.success("Session extended");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const markMutation = useMutation({
    mutationFn: (studentId: string) => api.markAttendance({ sessionId, studentId }),
    onSuccess: () => {
      toast.success("Marked present");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeMutation = useMutation({
    mutationFn: (attendanceId: string) => api.deleteAttendance(attendanceId),
    onSuccess: () => {
      toast.success("Attendance removed");
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const copyCode = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.code);
      toast.success("Code copied");
    } catch {
      toast.error("Clipboard unavailable — read the code out instead.");
    }
  };

  return (
    <RouteTransition>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link to="/lecturer/sessions">
          <ArrowLeft className="mr-2 h-4 w-4" /> All sessions
        </Link>
      </Button>

      <QueryBoundary
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        onRetry={() => query.refetch()}
        loadingLabel="Loading session"
      >
        {(data) => {
          const present = data.attendance.length;
          const rate =
            data.totalEnrolled > 0 ? Math.round((present / data.totalEnrolled) * 100) : 0;

          return (
            <>
              <PageHeader
                title={`${data.course.code} — attendance`}
                subtitle={
                  data.session.topic
                    ? data.session.topic
                    : `Started ${new Date(data.session.startedAt).toLocaleString()}`
                }
                actions={
                  isLive ? (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => extendMutation.mutate(10)}
                        disabled={extendMutation.isPending}
                      >
                        <Plus className="mr-2 h-4 w-4" /> 10 min
                      </Button>
                      <Button variant="destructive" onClick={() => setEndOpen(true)}>
                        <StopCircle className="mr-2 h-4 w-4" /> End session
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="outline">Session closed</Badge>
                  )
                }
              />

              <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <div className="order-2 space-y-6 lg:order-1">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <StatCard label="Present" value={present} icon={CheckCircle2} />
                    <StatCard label="Enrolled" value={data.totalEnrolled} />
                    <StatCard label="Attendance rate" value={`${rate}%`} />
                  </div>

                  <div>
                    <Progress value={rate} aria-label={`${rate}% of enrolled students present`} />
                  </div>

                  <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant">
                    <h2 className="font-display text-lg font-semibold">
                      Present <span className="text-muted-foreground">({present})</span>
                    </h2>
                    {data.attendance.length === 0 ? (
                      <p className="mt-4 text-sm text-muted-foreground">
                        No one has signed in yet. Share the code or QR to get started.
                      </p>
                    ) : (
                      <ul className="mt-4 divide-y divide-border/60">
                        {data.attendance.map((entry) => (
                          <li
                            key={entry.id}
                            className="flex items-center justify-between gap-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{entry.name}</div>
                              <div className="font-mono text-xs text-muted-foreground">
                                {entry.matricNo} · {new Date(entry.timestamp).toLocaleTimeString()}{" "}
                                · {entry.method}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove attendance for ${entry.name}`}
                              className="shrink-0 text-destructive hover:bg-destructive/10"
                              onClick={() => setRemoveTarget({ id: entry.id, name: entry.name })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-elegant">
                    <h2 className="font-display text-lg font-semibold">
                      Absent{" "}
                      <span className="text-muted-foreground">({data.absentees.length})</span>
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Mark a student manually if their device failed — this is recorded in the audit
                      log.
                    </p>
                    {data.absentees.length === 0 ? (
                      <p className="mt-4 text-sm text-muted-foreground">
                        Everyone enrolled has signed in.
                      </p>
                    ) : (
                      <ul className="mt-4 divide-y divide-border/60">
                        {data.absentees.map((student) => (
                          <li
                            key={student.id}
                            className="flex items-center justify-between gap-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{student.name}</div>
                              <div className="font-mono text-xs text-muted-foreground">
                                {student.matricNo}
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="shrink-0"
                              disabled={markMutation.isPending}
                              onClick={() => markMutation.mutate(student.id)}
                            >
                              <UserPlus className="mr-2 h-4 w-4" /> Mark present
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>

                <aside className="order-1 lg:order-2">
                  <div className="sticky top-24 rounded-2xl border border-border/70 bg-card p-5 text-center shadow-elegant">
                    {isLive ? (
                      <>
                        <div className="flex items-center justify-center gap-2 text-sm font-medium text-success">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                          </span>
                          Live
                        </div>
                        <div className="mt-4 font-mono text-4xl font-bold tracking-[0.3em]">
                          {data.session.code}
                        </div>
                        <Button variant="outline" size="sm" className="mt-3" onClick={copyCode}>
                          <Copy className="mr-2 h-4 w-4" /> Copy code
                        </Button>

                        <div className="mt-5 flex items-center justify-center gap-2 text-sm">
                          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                          <span className="font-mono" aria-live="polite">
                            {countdown.text} remaining
                          </span>
                        </div>

                        {qrDataUrl ? (
                          <img
                            src={qrDataUrl}
                            alt={`QR code to sign in to ${data.course.code}`}
                            className="mx-auto mt-5 h-48 w-48 rounded-xl border border-border/60 bg-white p-2"
                          />
                        ) : (
                          <div className="mx-auto mt-5 flex h-48 w-48 items-center justify-center rounded-xl border border-dashed border-border/60">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        )}

                        {data.session.radiusMeters && (
                          <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5" aria-hidden />
                            Geofenced to {data.session.radiusMeters} m
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="py-6">
                        <Radio className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
                        <p className="mt-3 text-sm font-medium">This session is closed</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {data.session.endedAt
                            ? `Ended ${new Date(data.session.endedAt).toLocaleString()}`
                            : `Expired ${new Date(data.session.expiresAt).toLocaleString()}`}
                        </p>
                      </div>
                    )}
                  </div>
                </aside>
              </div>

              <ConfirmDialog
                open={endOpen}
                onOpenChange={setEndOpen}
                title="End this session?"
                description="Students will no longer be able to sign in with the code. Attendance already recorded is kept."
                confirmLabel="End session"
                onConfirm={async () => {
                  await endMutation.mutateAsync();
                  setEndOpen(false);
                }}
              />

              <ConfirmDialog
                open={!!removeTarget}
                onOpenChange={(open) => !open && setRemoveTarget(null)}
                title={`Remove ${removeTarget?.name} from this session?`}
                description="Their attendance record for this session is deleted. This is logged."
                confirmLabel="Remove attendance"
                onConfirm={async () => {
                  if (removeTarget) await removeMutation.mutateAsync(removeTarget.id);
                  setRemoveTarget(null);
                }}
              />
            </>
          );
        }}
      </QueryBoundary>
    </RouteTransition>
  );
}
