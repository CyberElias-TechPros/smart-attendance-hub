import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  lecturerCourses, courseReport, lecturerSessionsFor,
  startSession, endSession,
} from "@/lib/api.functions";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlayCircle, MapPin, ChevronRight, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { exportPDF, exportExcel } from "@/lib/exporters";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { CourseGlyph } from "@/lib/courseIcons";
import { useAtRiskThreshold } from "@/lib/useSiteSettings";
import { burstCelebrate } from "@/lib/confetti";

const coursesQO = queryOptions({ queryKey: ["lecturer", "courses"], queryFn: () => lecturerCourses() });

export const Route = createFileRoute("/lecturer/courses/$courseId")({
  loader: ({ context }) => context.queryClient.ensureQueryData(coursesQO),
  component: CourseDetailPage,
});

function CourseDetailPage() {
  const { courseId } = Route.useParams();
  const { data: courses } = useSuspenseQuery(coursesQO);
  const course = courses.find((c) => c.id === courseId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const threshold = useAtRiskThreshold();
  const startFn = useServerFn(startSession);
  const endFn = useServerFn(endSession);

  const reportQ = useQuery({
    queryKey: ["report", courseId],
    queryFn: () => courseReport({ data: { courseId } }),
    enabled: Boolean(courseId),
  });
  const sessionsQ = useQuery({
    queryKey: ["lecturer-sessions", courseId],
    queryFn: () => lecturerSessionsFor({ data: { courseId } }),
    enabled: Boolean(courseId),
  });

  const [duration, setDuration] = useState(15);
  const [topic, setTopic] = useState("");
  const [useGeo, setUseGeo] = useState(false);
  const [radius, setRadius] = useState(150);
  const [starting, setStarting] = useState(false);

  const openSession = sessionsQ.data?.find((s) => !s.endedAt && s.expiresAt > Date.now());

  if (!course)
    return (
      <div className="grid h-40 place-items-center text-muted-foreground">
        Course not found.
      </div>
    );

  const start = async () => {
    setStarting(true);
    try {
      let coords: { latitude?: number; longitude?: number; radiusMeters?: number } = {};
      if (useGeo) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 }),
        );
        coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, radiusMeters: radius };
      }
      const s = await startFn({
        data: { courseId, durationMinutes: duration, topic: topic || undefined, ...coords },
      });
      toast.success("Session started");
      qc.invalidateQueries();
      navigate({ to: "/lecturer/sessions/$sessionId", params: { sessionId: s.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => navigate({ to: "/lecturer/courses" })} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> All courses
        </button>
        {course && <CourseGlyph icon={course.icon} color={course.color} seed={course.code} size="md" />}
      </div>
      <PageHeader
        title={`${course.code} — ${course.title}`}
        subtitle={`Level ${course.level} · ${course.units} units · ${course.enrolledStudentIds.length} students`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" disabled={!reportQ.data} onClick={() => reportQ.data && exportPDF(reportQ.data)}><FileDown className="mr-2 h-4 w-4" /> PDF</Button>
            <Button variant="outline" disabled={!reportQ.data} onClick={() => reportQ.data && exportExcel(reportQ.data)}><FileSpreadsheet className="mr-2 h-4 w-4" /> Excel</Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          {openSession ? (
            <div className="rounded-2xl border border-primary/40 bg-primary/5 p-6 shadow-elegant">
              <div className="text-xs font-medium uppercase tracking-widest text-primary">Session in progress</div>
              <div className="mt-2 font-display text-3xl font-semibold tracking-widest">{openSession.code}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Ends {new Date(openSession.expiresAt).toLocaleTimeString()}
              </div>
              <div className="mt-4 flex gap-2">
                <Button className="flex-1" onClick={() => navigate({ to: "/lecturer/sessions/$sessionId", params: { sessionId: openSession.id } })}>
                  Open live view
                </Button>
                <Button variant="outline" onClick={async () => { await endFn({ data: { sessionId: openSession.id } }); burstCelebrate(); qc.invalidateQueries(); toast.success(`${reportQ.data?.students?.length ?? 0} students reached`); }}>End</Button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
              <h2 className="font-display text-lg font-semibold">Start attendance</h2>
              <p className="text-xs text-muted-foreground">A unique code & QR will be generated.</p>
              <div className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <Label>Topic (optional)</Label>
                  <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Recursion basics" />
                </div>
                <div className="space-y-1.5">
                  <Label>Duration (minutes)</Label>
                  <Input type="number" min={1} max={240} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                </div>
                <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 p-3">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">GPS verification</div>
                      <div className="text-xs text-muted-foreground">Restrict sign-ins to the venue.</div>
                    </div>
                  </div>
                  <Switch checked={useGeo} onCheckedChange={setUseGeo} />
                </div>
                {useGeo && (
                  <div className="space-y-1.5">
                    <Label>Radius (meters)</Label>
                    <Input type="number" min={10} max={5000} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
                  </div>
                )}
                <Button className="w-full" onClick={start} disabled={starting}>
                  <PlayCircle className="mr-2 h-4 w-4" /> Start session
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Student attendance</h2>
              <div className="text-xs text-muted-foreground">{reportQ.data?.totalSessions ?? 0} sessions held</div>
            </div>
            <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Matric</TableHead>
                    <TableHead className="w-48">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(reportQ.data?.students ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="font-mono text-xs">{s.matricNo}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={s.percentage} className="h-2" />
                          <span className={s.percentage < threshold ? "text-destructive font-mono text-xs" : "font-mono text-xs"}>{s.percentage}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
            <h2 className="font-display text-lg font-semibold">Recent sessions</h2>
            <ul className="mt-3 divide-y divide-border/60">
              {(sessionsQ.data ?? []).map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => navigate({ to: "/lecturer/sessions/$sessionId", params: { sessionId: s.id } })}
                    className="flex w-full items-center justify-between py-3 text-left hover:opacity-80"
                  >
                    <div>
                      <div className="text-sm font-medium">{new Date(s.startedAt).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Code {s.code}{s.topic ? ` · ${s.topic}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className={`rounded-full px-2 py-0.5 ${s.endedAt ? "bg-muted" : "bg-success/10 text-success"}`}>
                        {s.endedAt ? "closed" : "live"}
                      </span>
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  </button>
                </li>
              ))}
              {(sessionsQ.data?.length ?? 0) === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">No sessions yet</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
