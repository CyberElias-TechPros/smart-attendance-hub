import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { courses as coursesApi, sessions, schedules } from "@/lib/api";
import { courseReportQO, lecturerCoursesQO } from "@/lib/queries";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PlayCircle,
  MapPin,
  ChevronRight,
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { exportPDF, exportExcel } from "@/lib/exporters";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { CourseGlyph } from "@/lib/courseIcons";
import { useAtRiskThreshold, useSiteSettings } from "@/lib/useSiteSettings";
import { burstCelebrate } from "@/lib/confetti";
import { SchedulePanel } from "@/components/SchedulePanel";

export const Route = createFileRoute("/lecturer/courses/$courseId")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(lecturerCoursesQO);
  },
  component: CourseDetailPage,
});

const courseSessionsQO = (courseId: string) =>
  queryOptions({
    queryKey: ["lecturer-sessions", courseId],
    queryFn: () => coursesApi.sessions(courseId),
    enabled: Boolean(courseId),
  });

function CourseDetailPage() {
  const { courseId } = Route.useParams();
  const { data: courses } = useSuspenseQuery(lecturerCoursesQO);
  const course = courses.find((c) => c.id === courseId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const threshold = useAtRiskThreshold();
  const { data: settings } = useSiteSettings();

  const reportQ = useQuery(courseReportQO(courseId));
  const sessionsQ = useQuery(courseSessionsQO(courseId));

  const [duration, setDuration] = useState(15);
  const [topic, setTopic] = useState("");
  // Secure by default: venue check + rotating codes are ON unless the
  // lecturer explicitly opts out for this session.
  const [useGeo, setUseGeo] = useState(true);
  const [radius, setRadius] = useState(150);
  const [rotate, setRotate] = useState(true);
  const [intervalSec, setIntervalSec] = useState(60);
  const [autoEnd, setAutoEnd] = useState(true);
  const [seats, setSeats] = useState<number | undefined>(undefined);
  const [pinVenue, setPinVenue] = useState<boolean>(
    () => course?.venueLat == null && course?.venueLng == null && course?.venueRadius == null,
  );
  const [starting, setStarting] = useState(false);

  const openSession = sessionsQ.data?.find((s) => !s.endedAt && s.expiresAt > Date.now());

  if (!course)
    return (
      <div className="mx-auto grid max-w-lg place-items-center gap-4 px-6 py-20 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <div>
          <div className="font-display text-lg font-semibold">Course not found</div>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been removed, or it isn't assigned to you.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/lecturer/courses" })}>
          Back to my courses
        </Button>
      </div>
    );

  const doExport = async (kind: "pdf" | "excel") => {
    if (!reportQ.data) return;
    try {
      if (kind === "pdf")
        await exportPDF(reportQ.data, { institutionName: settings?.institutionName });
      else await exportExcel(reportQ.data, { institutionName: settings?.institutionName });
      toast.success(`${kind.toUpperCase()} report downloaded`);
    } catch {
      toast.error("Export failed");
    }
  };

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      let coords: { latitude?: number; longitude?: number; radiusMeters?: number } = {};
      const courseHasVenue =
        course && course.venueLat != null && course.venueLng != null && course.venueRadius != null;
      const needGps = useGeo && !courseHasVenue;
      if (needGps) {
        let pos: GeolocationPosition;
        try {
          pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
            }),
          );
        } catch {
          toast.error(
            "Couldn't read this device's location. Allow location access — or turn off GPS verification to start an open session.",
          );
          return;
        }
        coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          radiusMeters: radius,
        };
        // Persist this as the course's recurring venue so future sessions are
        // locked too (admins/lecturers can clear it later).
        if (pinVenue) {
          try {
            await coursesApi.setVenue(courseId, {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              radiusMeters: radius,
            });
          } catch {
            /* best-effort; the session still starts with this geofence */
          }
        }
      }
      const s = await sessions.start({
        courseId,
        durationMinutes: duration,
        topic: topic || undefined,
        codeIntervalSeconds: rotate ? intervalSec : null,
        autoEndEnabled: autoEnd,
        seats: seats && seats > 0 ? seats : undefined,
        ...coords,
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
        <button
          onClick={() => navigate({ to: "/lecturer/courses" })}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> All courses
        </button>
        <CourseGlyph icon={course.icon} color={course.color} seed={course.code} size="md" />
      </div>
      <PageHeader
        title={`${course.code} — ${course.title}`}
        subtitle={`Level ${course.level} · ${course.units} units · ${course.enrolledStudentIds.length} students`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" disabled={!reportQ.data} onClick={() => doExport("pdf")}>
              <FileDown className="mr-2 h-4 w-4" /> PDF
            </Button>
            <Button variant="outline" disabled={!reportQ.data} onClick={() => doExport("excel")}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          {openSession ? (
            <div className="rounded-2xl border border-primary/40 bg-primary/5 p-6 shadow-elegant">
              <div className="text-xs font-medium uppercase tracking-widest text-primary">
                Session in progress
              </div>
              <div className="mt-2 font-display text-3xl font-semibold tracking-widest">
                {openSession.code}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Ends {new Date(openSession.expiresAt).toLocaleTimeString()}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {openSession.radiusMeters ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <MapPin className="h-3 w-3" /> Venue ±{openSession.radiusMeters}m
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    <MapPin className="h-3 w-3" /> No venue check
                  </span>
                )}
                {openSession.codeIntervalSeconds ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <RefreshCw className="h-3 w-3" /> Rotates /{openSession.codeIntervalSeconds}s
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    <RefreshCw className="h-3 w-3" /> Static code
                  </span>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() =>
                    navigate({
                      to: "/lecturer/sessions/$sessionId",
                      params: { sessionId: openSession.id },
                    })
                  }
                >
                  Open live view
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await sessions.end(openSession.id);
                      burstCelebrate();
                      qc.invalidateQueries();
                      toast.success("Session ended");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed");
                    }
                  }}
                >
                  End
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
              <h2 className="font-display text-lg font-semibold">Start attendance</h2>
              <p className="text-xs text-muted-foreground">A unique code & QR will be generated.</p>
              <div className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <Label>Topic (optional)</Label>
                  <Input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Recursion basics"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Duration (minutes)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={240}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Seat capacity (optional)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10000}
                    placeholder="Unlimited"
                    value={seats ?? ""}
                    onChange={(e) =>
                      setSeats(e.target.value === "" ? undefined : Number(e.target.value))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Leave empty for no limit; latecomers are told when the room is full.
                  </p>
                </div>
                <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 p-3">
                  <div className="flex items-start gap-2">
                    <RefreshCw className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">Auto-close on time</div>
                      <div className="text-xs text-muted-foreground">
                        The session stops accepting sign-ins when its clock ends.
                      </div>
                    </div>
                  </div>
                  <Switch checked={autoEnd} onCheckedChange={setAutoEnd} />
                </div>
                {course.venueLat != null &&
                  course.venueLng != null &&
                  course.venueRadius != null && (
                    <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-xs text-primary">
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        <MapPin className="h-3.5 w-3.5" /> Course venue pinned
                      </span>
                      <p className="mt-1 text-primary/80">
                        Sessions for this course are GPS-locked to a ±{course.venueRadius}m venue —
                        students can't sign in from elsewhere.
                      </p>
                    </div>
                  )}
                <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 p-3">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">GPS verification</div>
                      <div className="text-xs text-muted-foreground">
                        Restrict sign-ins to the venue.
                      </div>
                    </div>
                  </div>
                  <Switch checked={useGeo} onCheckedChange={setUseGeo} />
                </div>
                {useGeo && course.venueLat == null && (
                  <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 p-3">
                    <div className="text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">Remember as course venue</div>
                      Pin this room as the standing venue, so every future session for this course
                      is GPS-locked automatically.
                    </div>
                    <Switch checked={pinVenue} onCheckedChange={setPinVenue} />
                  </div>
                )}
                {useGeo && (
                  <div className="space-y-1.5">
                    <Label>Radius (meters)</Label>
                    <Input
                      type="number"
                      min={10}
                      max={5000}
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                    />
                  </div>
                )}
                <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 p-3">
                  <div className="flex items-start gap-2">
                    <RefreshCw className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">Rotating code</div>
                      <div className="text-xs text-muted-foreground">
                        Fresh code on a timer — shared codes die fast.
                      </div>
                    </div>
                  </div>
                  <Switch checked={rotate} onCheckedChange={setRotate} />
                </div>
                {rotate && (
                  <div className="space-y-1.5">
                    <Label>Rotate every</Label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { v: 30, label: "30s" },
                        { v: 60, label: "60s" },
                        { v: 120, label: "2m" },
                        { v: 300, label: "5m" },
                      ].map((o) => (
                        <button
                          key={o.v}
                          type="button"
                          onClick={() => setIntervalSec(o.v)}
                          className={`rounded-lg border px-2 py-1.5 font-mono text-xs transition ${
                            intervalSec === o.v
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border/70 bg-background hover:border-primary/50"
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Button className="w-full" onClick={start} disabled={starting}>
                  <PlayCircle className="mr-2 h-4 w-4" /> {starting ? "Starting…" : "Start session"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <SchedulePanel courseId={course.id} />

          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Student attendance</h2>
              <div className="text-xs text-muted-foreground">
                {reportQ.data?.totalSessions ?? 0} sessions held
              </div>
            </div>
            <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Matric</TableHead>
                    <TableHead className="w-48">%</TableHead>
                    <TableHead className="w-24 text-right">
                      <span
                        className="inline-flex items-center gap-1"
                        title="Distinct devices this student signed in from. More than one is worth a look."
                      >
                        <ShieldCheck className="h-3 w-3" />
                        Devices
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportQ.isLoading && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {reportQ.isError && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-destructive">
                        Failed to load the report.
                      </TableCell>
                    </TableRow>
                  )}
                  {(reportQ.data?.students ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="font-mono text-xs">{s.matricNo}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={s.percentage} className="h-2" />
                          <span
                            className={
                              s.percentage < threshold
                                ? "text-destructive font-mono text-xs"
                                : "font-mono text-xs"
                            }
                          >
                            {s.percentage}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {s.devices > 1 ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 font-mono text-xs font-semibold text-warning"
                            title={`${s.name} signed in from ${s.devices} different devices`}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {s.devices}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {s.devices || "—"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {reportQ.data && reportQ.data.students.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No students enrolled yet.
                      </TableCell>
                    </TableRow>
                  )}
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
                    onClick={() =>
                      navigate({ to: "/lecturer/sessions/$sessionId", params: { sessionId: s.id } })
                    }
                    className="flex w-full items-center justify-between py-3 text-left hover:opacity-80"
                  >
                    <div>
                      <div className="text-sm font-medium">
                        {new Date(s.startedAt).toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Code {s.code}
                        {s.topic ? ` · ${s.topic}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span
                        className={`rounded-full px-2 py-0.5 ${s.endedAt ? "bg-muted" : "bg-success/10 text-success"}`}
                      >
                        {s.endedAt ? "closed" : "live"}
                      </span>
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  </button>
                </li>
              ))}
              {(sessionsQ.data?.length ?? 0) === 0 && !sessionsQ.isLoading && (
                <li className="py-6 text-center text-sm text-muted-foreground">No sessions yet</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
