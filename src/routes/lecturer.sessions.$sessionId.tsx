import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sessions } from "@/lib/api";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, ArrowLeft, Copy, StopCircle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { burstCelebrate } from "@/lib/confetti";

export const Route = createFileRoute("/lecturer/sessions/$sessionId")({
  component: LiveSessionPage,
});

function LiveSessionPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const detailQ = useQuery({
    queryKey: ["session-detail", sessionId],
    queryFn: () => sessions.detail(sessionId),
    refetchInterval: 3000,
  });

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const session = detailQ.data?.session;
  const isOpen = session && !session.endedAt && session.expiresAt > now;

  useEffect(() => {
    if (!session || !canvasRef.current) return;
    const url = `${window.location.origin}/student/attend?code=${session.code}`;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 260,
      margin: 1,
      color: { dark: "#0f5c4b", light: "#ffffff" },
    }).catch(() => toast.error("Could not render the QR code"));
  }, [session]);

  if (detailQ.isLoading)
    return <div className="grid h-40 place-items-center text-muted-foreground">Loading…</div>;
  if (detailQ.isError || !detailQ.data)
    return (
      <div className="mx-auto grid max-w-lg place-items-center gap-4 px-6 py-20 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <div>
          <div className="font-display text-lg font-semibold">Session unavailable</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {detailQ.error instanceof Error
              ? detailQ.error.message
              : "It may have been removed, or it doesn't belong to you."}
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/lecturer" })}>
          Back to dashboard
        </Button>
      </div>
    );

  const { session: s, course, totalEnrolled, attendance } = detailQ.data;
  const remainingMs = Math.max(0, (s.endedAt ?? s.expiresAt) - now);
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0");
  const pct = totalEnrolled === 0 ? 0 : Math.round((attendance.length / totalEnrolled) * 100);

  const end = async () => {
    try {
      await sessions.end(sessionId);
      burstCelebrate();
      toast.success("Session ended");
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const removeRecord = async (recordId: string) => {
    try {
      await sessions.removeAttendance(recordId);
      toast.success("Attendance removed");
      qc.invalidateQueries({ queryKey: ["session-detail", sessionId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <>
      <button
        onClick={() =>
          navigate({ to: "/lecturer/courses/$courseId", params: { courseId: course.id } })
        }
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to course
      </button>
      <PageHeader
        title={`${course.code} live session`}
        subtitle={s.topic ?? `Started ${new Date(s.startedAt).toLocaleTimeString()}`}
        actions={
          isOpen && (
            <Button variant="destructive" onClick={end}>
              <StopCircle className="mr-2 h-4 w-4" /> End session
            </Button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-widest">
            <span className={isOpen ? "text-success" : "text-muted-foreground"}>
              {isOpen ? "● Live" : "Closed"}
            </span>
            <span className="font-mono text-lg text-foreground">
              {isOpen ? `${mm}:${ss}` : "—"}
            </span>
          </div>
          <div
            className={`mt-6 flex justify-center ${isOpen ? "animate-pulse-ring rounded-3xl" : "opacity-60"}`}
          >
            <div className="rounded-3xl bg-gradient-to-br from-primary/30 via-accent/20 to-primary/30 p-1.5 shadow-glow">
              <canvas ref={canvasRef} className="rounded-2xl bg-white p-3" />
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted/60 p-3 text-center">
              <div className="text-xs text-muted-foreground">One-time code</div>
              <div className="mt-1 font-mono text-2xl font-semibold tracking-widest gradient-text">
                {s.code}
              </div>
            </div>
            <div className="rounded-xl bg-muted/60 p-3 text-center">
              <div className="text-xs text-muted-foreground">Signed in</div>
              <div className="font-display text-2xl font-semibold">
                {attendance.length}/{totalEnrolled}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={() => {
              navigator.clipboard.writeText(s.code).then(
                () => toast.success("Code copied"),
                () => toast.error("Could not copy"),
              );
            }}
          >
            <Copy className="mr-2 h-4 w-4" /> Copy code
          </Button>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Live attendance</h2>
            <div className="w-40">
              <Progress value={pct} className="h-2" />
            </div>
          </div>
          <div className="mt-4 max-h-[440px] overflow-auto rounded-xl border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Matric</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.map((a, i) => (
                  <TableRow key={a.id} className="animate-fade-up">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="font-mono text-xs">{a.matricNo}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {new Date(a.timestamp).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeRecord(a.id)}
                        title="Remove attendance"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {attendance.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Waiting for the first sign-in…
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  );
}
