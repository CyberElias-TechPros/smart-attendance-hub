import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { sessionDetail, endSession } from "@/lib/api.functions";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Copy, StopCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";

export const Route = createFileRoute("/lecturer/sessions/$sessionId")({
  component: LiveSessionPage,
});

function LiveSessionPage() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const endFn = useServerFn(endSession);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const detailQ = useQuery({
    queryKey: ["session-detail", sessionId],
    queryFn: () => sessionDetail({ data: { sessionId } }),
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
    const url = typeof window !== "undefined" ? `${window.location.origin}/student/attend?code=${session.code}` : session.code;
    QRCode.toCanvas(canvasRef.current, url, { width: 260, margin: 1, color: { dark: "#0f5c4b", light: "#ffffff" } });
  }, [session]);

  if (detailQ.isLoading || !detailQ.data)
    return <div className="grid h-40 place-items-center text-muted-foreground">Loading…</div>;

  const { session: s, course, totalEnrolled, attendance } = detailQ.data;
  const remainingMs = Math.max(0, (s.endedAt ?? s.expiresAt) - now);
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0");
  const pct = totalEnrolled === 0 ? 0 : Math.round((attendance.length / totalEnrolled) * 100);

  const end = async () => {
    await endFn({ data: { sessionId } });
    toast.success("Session ended");
    qc.invalidateQueries();
  };

  return (
    <>
      <button onClick={() => navigate({ to: "/lecturer/courses/$courseId", params: { courseId: course.id } })} className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to course
      </button>
      <PageHeader
        title={`${course.code} live session`}
        subtitle={s.topic ?? `Started ${new Date(s.startedAt).toLocaleTimeString()}`}
        actions={
          isOpen && (
            <Button variant="destructive" onClick={end}><StopCircle className="mr-2 h-4 w-4" /> End session</Button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-widest">
            <span className={isOpen ? "text-success" : "text-muted-foreground"}>
              {isOpen ? "● Live" : "Closed"}
            </span>
            <span className="font-mono text-lg text-foreground">{isOpen ? `${mm}:${ss}` : "—"}</span>
          </div>
          <div className={`mt-6 flex justify-center ${isOpen ? "animate-pulse-ring rounded-3xl" : "opacity-60"}`}>
            <canvas ref={canvasRef} className="rounded-2xl bg-white p-3 shadow-elegant" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted/60 p-3 text-center">
              <div className="text-xs text-muted-foreground">One-time code</div>
              <div className="mt-1 font-mono text-2xl font-semibold tracking-widest">{s.code}</div>
            </div>
            <div className="rounded-xl bg-muted/60 p-3 text-center">
              <div className="text-xs text-muted-foreground">Signed in</div>
              <div className="mt-1 font-display text-2xl font-semibold">{attendance.length}/{totalEnrolled}</div>
            </div>
          </div>
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={() => {
              navigator.clipboard.writeText(s.code);
              toast.success("Code copied");
            }}
          >
            <Copy className="mr-2 h-4 w-4" /> Copy code
          </Button>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Live attendance</h2>
            <div className="w-40"><Progress value={pct} className="h-2" /></div>
          </div>
          <div className="mt-4 max-h-[440px] overflow-auto rounded-xl border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Matric</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.map((a, i) => (
                  <TableRow key={a.id} className="animate-fade-up">
                    <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="font-mono text-xs">{a.matricNo}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{new Date(a.timestamp).toLocaleTimeString()}</TableCell>
                  </TableRow>
                ))}
                {attendance.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">Waiting for the first sign-in…</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  );
}
