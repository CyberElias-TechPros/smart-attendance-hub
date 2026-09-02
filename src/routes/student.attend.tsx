import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Camera, CameraOff, CheckCircle2, Clock, Loader2, MapPin, QrCode } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/AppShell";
import { RouteTransition } from "@/components/RouteTransition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError, api, errorMessage } from "@/lib/api";

export const Route = createFileRoute("/student/attend")({
  // Accept `?code=` so the lecturer's QR code can deep-link straight here.
  validateSearch: (search: Record<string, unknown>): { code?: string } =>
    typeof search.code === "string"
      ? { code: search.code.slice(0, 12).toUpperCase() }
      : {},
  component: AttendPage,
});

const SCANNER_ELEMENT_ID = "slams-qr-reader";

type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; latitude: number; longitude: number }
  | { status: "error"; message: string };

/**
 * Resolves the device location. Rejects rather than resolving empty so callers
 * can decide whether a geofenced session should be attempted at all — the old
 * implementation swallowed failures and silently submitted without coordinates,
 * which produced confusing "outside the venue" errors from the server.
 */
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This device does not support location services."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 30_000,
    });
  });
}

function geoErrorMessage(error: unknown): string {
  const code = (error as GeolocationPositionError | undefined)?.code;
  if (code === 1)
    return "Location permission denied. Enable location for this site, then try again.";
  if (code === 2) return "Your location is unavailable right now. Move somewhere with a clearer signal.";
  if (code === 3) return "Finding your location timed out. Try again.";
  return error instanceof Error ? error.message : "Could not determine your location.";
}

function AttendPage() {
  const search = useSearch({ from: "/student/attend" });
  const queryClient = useQueryClient();

  const [code, setCode] = useState(search.code ?? "");
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [scanning, setScanning] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ course: string; at: number } | null>(null);

  // `Html5Qrcode` is loaded lazily; the concrete type comes with it, so the ref
  // is typed structurally against just the methods we use.
  const scannerRef = useRef<{
    start: (
      camera: { facingMode: string },
      config: Record<string, unknown>,
      onSuccess: (text: string) => void,
      onError: (message: string) => void,
    ) => Promise<void>;
    stop: () => Promise<void>;
    clear: () => void;
    getState: () => number;
  } | null>(null);

  const openQuery = useQuery({
    queryKey: ["student", "openSessions"],
    queryFn: () => api.studentOpenSessions(),
    refetchInterval: 20_000,
  });

  /** Always tears the camera down, even if `stop()` throws (already stopped). */
  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    if (!scanner) return;
    try {
      await scanner.stop();
    } catch {
      // The scanner was already stopped or never fully started — nothing to do.
    }
    try {
      scanner.clear();
    } catch {
      // Clearing only removes DOM nodes; failure here is not actionable.
    }
  }, []);

  // Release the camera when navigating away or when the tab is hidden, so the
  // device's camera indicator never stays on after leaving this screen.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void stopScanner();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      void stopScanner();
    };
  }, [stopScanner]);

  const submitMutation = useMutation({
    mutationFn: async (rawCode: string) => {
      const trimmed = rawCode.trim().toUpperCase();
      let coords: { latitude: number; longitude: number } | undefined;

      // Send coordinates whenever the browser will give them: the server only
      // enforces them for geofenced sessions, and a refusal here would block
      // sign-in to sessions that do not need location at all.
      try {
        const position = await getPosition();
        coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setGeo({ status: "ready", ...coords });
      } catch (error) {
        setGeo({ status: "error", message: geoErrorMessage(error) });
      }

      return api.submitAttendance({ code: trimmed, ...coords });
    },
    onSuccess: async (result) => {
      await stopScanner();
      setSuccess({ course: `${result.course.code} — ${result.course.title}`, at: result.timestamp });
      setCode("");
      toast.success(`Signed in to ${result.course.code}`);
      queryClient.invalidateQueries({ queryKey: ["student"] });
      // Small celebration, loaded on demand so it costs nothing until earned.
      void import("@/lib/confetti")
        .then(({ burstSuccess }) => burstSuccess())
        .catch(() => undefined);
    },
    onError: (error) => {
      const message = errorMessage(error);
      // A geofence rejection is much clearer when paired with why location failed.
      if (
        error instanceof ApiClientError &&
        error.status === 403 &&
        geo.status === "error"
      ) {
        toast.error(`${message} (${geo.message})`);
        return;
      }
      toast.error(message);
    },
  });

  const startScan = async () => {
    setScannerError(null);
    setSuccess(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      // Mount the scanner only after the container exists in the DOM.
      setScanning(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const element = document.getElementById(SCANNER_ELEMENT_ID);
      if (!element) {
        setScanning(false);
        setScannerError("Could not open the camera view. Enter the code manually instead.");
        return;
      }
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner as unknown as typeof scannerRef.current;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText: string) => {
          const scanned = extractCode(decodedText);
          if (!scanned) return;
          setCode(scanned);
          void stopScanner().then(() => submitMutation.mutate(scanned));
        },
        () => {
          // Per-frame decode misses are normal; ignore them.
        },
      );
    } catch (error) {
      await stopScanner();
      setScannerError(
        error instanceof Error && /permission|NotAllowed/i.test(error.message)
          ? "Camera permission denied. Allow camera access or enter the code manually."
          : "Could not start the camera. Enter the code manually instead.",
      );
    }
  };

  const openSessions = (openQuery.data?.items ?? []).filter(
    (session) => session.expiresAt > Date.now(),
  );

  return (
    <RouteTransition>
      <PageHeader
        title="Sign in to a session"
        subtitle="Scan the QR code your lecturer is showing, or type the code."
      />

      {success && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-2xl border border-success/40 bg-success/5 p-5"
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
          <div>
            <p className="font-medium">Attendance recorded</p>
            <p className="text-sm text-muted-foreground">
              {success.course} · {new Date(success.at).toLocaleTimeString()}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <QrCode className="h-5 w-5 text-primary" aria-hidden /> Scan QR code
          </h2>

          <div
            id={SCANNER_ELEMENT_ID}
            className={
              scanning
                ? "mt-4 overflow-hidden rounded-xl border border-border/60"
                : "sr-only"
            }
          />

          {!scanning && (
            <div className="mt-4 flex h-48 items-center justify-center rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground">
              Camera is off
            </div>
          )}

          <div className="mt-4">
            {scanning ? (
              <Button variant="outline" onClick={() => void stopScanner()} className="w-full">
                <CameraOff className="mr-2 h-4 w-4" /> Stop camera
              </Button>
            ) : (
              <Button onClick={startScan} className="w-full">
                <Camera className="mr-2 h-4 w-4" /> Start camera
              </Button>
            )}
          </div>

          {scannerError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {scannerError}
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
          <h2 className="font-display text-lg font-semibold">Enter the code</h2>
          <form
            noValidate
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim().length < 4) {
                toast.error("Enter the full code shown by your lecturer.");
                return;
              }
              submitMutation.mutate(code);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="attendance-code">Attendance code</Label>
              <Input
                id="attendance-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABC12345"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                className="text-center font-mono text-2xl tracking-[0.3em]"
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitMutation.isPending}>
              {submitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>

          <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {geo.status === "error"
              ? geo.message
              : "If your lecturer restricted the session to the venue, your location is checked when you sign in."}
          </p>
        </section>
      </div>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">Open right now</h2>
        {openQuery.isPending ? (
          <p className="mt-3 text-sm text-muted-foreground">Checking for open sessions…</p>
        ) : openSessions.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            None of your courses has an open session at the moment.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {openSessions.map((session) => (
              <li
                key={session.sessionId}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4"
              >
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold text-primary">
                    {session.courseCode}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {session.topic ?? session.courseTitle}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" aria-hidden />
                    closes {new Date(session.expiresAt).toLocaleTimeString()}
                  </div>
                </div>
                {session.alreadySignedIn ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> Signed in
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">Awaiting sign-in</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </RouteTransition>
  );
}

/** QR payloads may be a bare code or the full join URL — accept both. */
function extractCode(decodedText: string): string | null {
  const text = decodedText.trim();
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get("code");
    if (fromQuery) return fromQuery.toUpperCase();
  } catch {
    // Not a URL; fall through to treating it as a raw code.
  }
  const match = text.toUpperCase().match(/^[A-Z0-9]{4,12}$/);
  return match ? match[0] : null;
}
