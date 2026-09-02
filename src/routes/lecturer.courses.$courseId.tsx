import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Loader2,
  MapPin,
  PlayCircle,
  Radio,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, StatCard } from "@/components/AppShell";
import { Column, DataTable } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AttendanceSession, CourseReport } from "../../shared/schemas";
import { api, errorMessage } from "@/lib/api";
import { useAtRiskThreshold } from "@/lib/useSiteSettings";
import { Field } from "./admin.students";

export const Route = createFileRoute("/lecturer/courses/$courseId")({ component: CourseDetail });

type ReportStudent = CourseReport["students"][number];

function CourseDetail() {
  const { courseId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const threshold = useAtRiskThreshold();
  const [startOpen, setStartOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const query = useQuery({
    queryKey: ["courses", courseId, "detail"],
    queryFn: () => api.courseDetail(courseId),
  });

  const liveSession = (query.data?.sessions ?? []).find(
    (session) => !session.endedAt && session.expiresAt > Date.now(),
  );

  const runExport = async (format: "pdf" | "excel") => {
    const report = query.data?.report;
    if (!report) return;
    setExporting(true);
    try {
      const { exportCoursePDF, exportCourseExcel } = await import("@/lib/exporters");
      if (format === "pdf") await exportCoursePDF(report, threshold);
      else await exportCourseExcel(report);
      toast.success("Report exported");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const studentColumns: Column<ReportStudent>[] = [
    { key: "name", header: "Student", render: (row) => row.name },
    {
      key: "matric",
      header: "Matric no.",
      render: (row) => <span className="font-mono text-xs">{row.matricNo}</span>,
    },
    { key: "attended", header: "Attended", hideOnMobile: true, render: (row) => row.attended },
    {
      key: "percentage",
      header: "Attendance",
      render: (row) => (
        <Badge variant={row.percentage < threshold ? "destructive" : "secondary"}>
          {row.percentage}%
        </Badge>
      ),
    },
  ];

  const sessionColumns: Column<AttendanceSession>[] = [
    {
      key: "startedAt",
      header: "Started",
      render: (session) => (
        <span className="whitespace-nowrap">{new Date(session.startedAt).toLocaleString()}</span>
      ),
    },
    {
      key: "topic",
      header: "Topic",
      hideOnMobile: true,
      render: (session) => session.topic ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "attended",
      header: "Present",
      render: (session) => (
        <span className="font-mono">
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
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link to="/lecturer/courses">
          <ArrowLeft className="mr-2 h-4 w-4" /> All courses
        </Link>
      </Button>

      <QueryBoundary
        isLoading={query.isPending}
        error={query.error}
        data={query.data}
        onRetry={() => query.refetch()}
        loadingLabel="Loading course"
      >
        {(data) => (
          <>
            <PageHeader
              title={`${data.course.code} — ${data.course.title}`}
              subtitle={`${data.course.level} level · ${data.course.units} units · ${data.course.departmentName ?? "No department"}`}
              actions={
                liveSession ? (
                  <Button asChild>
                    <Link
                      to="/lecturer/sessions/$sessionId"
                      params={{ sessionId: liveSession.id }}
                    >
                      <Radio className="mr-2 h-4 w-4" /> Open live session
                    </Link>
                  </Button>
                ) : (
                  <Button onClick={() => setStartOpen(true)}>
                    <PlayCircle className="mr-2 h-4 w-4" /> Start session
                  </Button>
                )
              }
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Enrolled" value={data.course.enrolledCount} />
              <StatCard label="Sessions held" value={data.report?.totalSessions ?? 0} />
              <StatCard
                label="At risk"
                value={
                  (data.report?.students ?? []).filter((s) => s.percentage < threshold).length
                }
              />
            </div>

            <Tabs defaultValue="students" className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="students">Students</TabsTrigger>
                  <TabsTrigger value="sessions">Sessions</TabsTrigger>
                </TabsList>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exporting || !data.report}
                    onClick={() => runExport("pdf")}
                  >
                    <Download className="mr-2 h-4 w-4" /> PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exporting || !data.report}
                    onClick={() => runExport("excel")}
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
                  </Button>
                </div>
              </div>

              <TabsContent value="students" className="mt-4">
                <DataTable
                  columns={studentColumns}
                  rows={data.report?.students ?? []}
                  getRowKey={(row) => row.id}
                  emptyState={
                    <EmptyState
                      title="No students enrolled"
                      description="An administrator can enrol students into this course."
                    />
                  }
                />
              </TabsContent>

              <TabsContent value="sessions" className="mt-4">
                <DataTable
                  columns={sessionColumns}
                  rows={data.sessions}
                  getRowKey={(session) => session.id}
                  onRowClick={(session) =>
                    navigate({
                      to: "/lecturer/sessions/$sessionId",
                      params: { sessionId: session.id },
                    })
                  }
                  emptyState={
                    <EmptyState
                      icon={<PlayCircle className="h-7 w-7" />}
                      title="No sessions yet"
                      description="Start a session to begin taking attendance."
                      action={
                        <Button onClick={() => setStartOpen(true)}>
                          <PlayCircle className="mr-2 h-4 w-4" /> Start session
                        </Button>
                      }
                    />
                  }
                />
              </TabsContent>
            </Tabs>

            <StartSessionDialog
              open={startOpen}
              onOpenChange={setStartOpen}
              courseId={courseId}
              onStarted={(session) => {
                queryClient.invalidateQueries({ queryKey: ["courses", courseId, "detail"] });
                queryClient.invalidateQueries({ queryKey: ["lecturer"] });
                navigate({
                  to: "/lecturer/sessions/$sessionId",
                  params: { sessionId: session.id },
                });
              }}
            />
          </>
        )}
      </QueryBoundary>
    </RouteTransition>
  );
}

export function StartSessionDialog({
  open,
  onOpenChange,
  courseId,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  onStarted: (session: AttendanceSession) => void;
}) {
  const [duration, setDuration] = useState(15);
  const [topic, setTopic] = useState("");
  const [geofence, setGeofence] = useState(false);
  const [radius, setRadius] = useState(150);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: () =>
      api.startSession({
        courseId,
        durationMinutes: duration,
        topic: topic.trim() || undefined,
        ...(geofence && coords
          ? { latitude: coords.latitude, longitude: coords.longitude, radiusMeters: radius }
          : {}),
      }),
    onSuccess: (data) => {
      toast.success("Session started");
      onOpenChange(false);
      onStarted(data.session);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Geolocation is optional, but if the lecturer asks for a geofence we must
  // surface failures instead of silently starting an unfenced session.
  const captureLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationError("This device does not support location services.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        setCoords(null);
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Allow it in your browser settings to use a geofence."
            : "Could not determine your location. Try again near a window or disable the geofence.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  const geofenceIncomplete = geofence && !coords;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start attendance session</DialogTitle>
          <DialogDescription>
            Students sign in with the generated code or by scanning the QR code.
          </DialogDescription>
        </DialogHeader>

        <form
          id="start-session-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (geofenceIncomplete) {
              setLocationError("Capture the venue location first, or turn the geofence off.");
              return;
            }
            startMutation.mutate();
          }}
          className="space-y-4"
        >
          <Field
            label="Duration (minutes)"
            htmlFor="session-duration"
            hint="The code stops working when the session expires."
          >
            <Input
              id="session-duration"
              type="number"
              min={1}
              max={240}
              required
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </Field>

          <Field label="Topic (optional)" htmlFor="session-topic">
            <Input
              id="session-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Week 5 — Binary trees"
              maxLength={160}
            />
          </Field>

          <div className="rounded-xl border border-border/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Restrict to venue</div>
                <div className="text-xs text-muted-foreground">
                  Only students physically nearby can sign in.
                </div>
              </div>
              <Switch
                checked={geofence}
                aria-label="Restrict to venue"
                onCheckedChange={(checked) => {
                  setGeofence(checked);
                  setLocationError(null);
                  if (checked) captureLocation();
                  else setCoords(null);
                }}
              />
            </div>

            {geofence && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={captureLocation}
                    disabled={locating}
                  >
                    {locating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <MapPin className="mr-2 h-4 w-4" />
                    )}
                    {coords ? "Update location" : "Capture location"}
                  </Button>
                  {coords && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
                    </span>
                  )}
                </div>
                <Field label="Radius (metres)" htmlFor="session-radius">
                  <Input
                    id="session-radius"
                    type="number"
                    min={10}
                    max={5000}
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                  />
                </Field>
              </div>
            )}

            {locationError && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {locationError}
              </p>
            )}
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="start-session-form"
            disabled={startMutation.isPending || locating}
          >
            {startMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
