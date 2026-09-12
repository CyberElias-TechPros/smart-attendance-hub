import { createFileRoute, useSearch } from "@tanstack/react-router";
import { student } from "@/lib/api";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CheckCircle2, QrCode, Loader2, Camera, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { burstSuccess } from "@/lib/confetti";
import { getDeviceId, shortDeviceId } from "@/lib/device";

const searchSchema = z.object({ code: z.string().optional() });

export const Route = createFileRoute("/student/attend")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AttendPage,
});

function AttendPage() {
  const search = useSearch({ from: "/student/attend" });

  const [code, setCode] = useState(search.code ?? "");
  const [useGeo, setUseGeo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | {
    course: { code: string; title: string };
    timestamp: number;
  }>(null);
  const [scanning, setScanning] = useState(false);
  const scanRegionRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<InstanceType<typeof import("html5-qrcode").Html5Qrcode> | null>(null);
  const [autoCam, setAutoCam] = useState<boolean>(() => {
    try {
      return localStorage.getItem("slams:auto-camera") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop?.().catch(() => {});
        scannerRef.current.clear?.();
      }
    };
  }, []);

  // The user explicitly enabled auto-open (persisted), so start scanning on
  // load when they haven't already signed in. Browsers without camera access
  // simply surface the permission prompt; failure is handled by startScan.
  useEffect(() => {
    if (autoCam && !result && !scanning) {
      void startScan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCam]);

  const submit = async (theCode?: string) => {
    const c = (theCode ?? code).trim();
    if (!c) return toast.error("Enter or scan a code");
    if (busy) return;
    setBusy(true);
    try {
      let coords: { latitude?: number; longitude?: number } = {};
      if (useGeo && "geolocation" in navigator) {
        try {
          const pos = await new Promise<GeolocationPosition>((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, {
              enableHighAccuracy: true,
              timeout: 8000,
            }),
          );
          coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        } catch {
          /* geo unavailable, proceed without */
        }
      }
      const r = await student.submitAttendance({ code: c, ...coords, deviceId: getDeviceId() });
      setResult(r);
      burstSuccess();
      toast.success("Attendance recorded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    setScanning(true);
    const { Html5Qrcode } = await import("html5-qrcode");
    if (!scanRegionRef.current) return;
    const id = "qr-region";
    scanRegionRef.current.id = id;
    const scanner = new Html5Qrcode(id);
    scannerRef.current = scanner;
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (text: string) => {
          const match = text.match(/(\d{6})/);
          const c = match ? match[1] : text.trim();
          setCode(c);
          scanner
            .stop()
            .then(() => scanner.clear())
            .catch(() => {});
          setScanning(false);
          setTimeout(() => submit(c), 200);
        },
        () => {},
      );
    } catch {
      toast.error("Could not access camera");
      setScanning(false);
    }
  };

  const stopScan = () => {
    scannerRef.current
      ?.stop?.()
      .then(() => scannerRef.current?.clear?.())
      .catch(() => {});
    setScanning(false);
  };

  return (
    <>
      <PageHeader
        title="Sign in to a lecture"
        subtitle="Scan the QR displayed by your lecturer, or type the 6-digit code."
      />

      {result ? (
        <div className="relative mx-auto max-w-lg overflow-hidden rounded-3xl border border-success/40 bg-success/5 p-8 text-center shadow-lift animate-scale-in">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-success/20 blur-3xl"
          />
          <div className="relative mx-auto grid h-16 w-16 animate-pulse-ring place-items-center rounded-full bg-gradient-to-br from-success to-emerald-600 text-white shadow-glow">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h2 className="mt-4 font-display text-2xl font-semibold">You're signed in 🎉</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.course.code} · {result.course.title}
          </p>
          <p className="mt-1 text-xs text-success">Your attendance is locked in. Nicely done.</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {new Date(result.timestamp).toLocaleString()}
          </p>
          <Button
            className="mt-6"
            onClick={() => {
              setResult(null);
              setCode("");
            }}
          >
            Sign in to another
          </Button>
        </div>
      ) : (
        <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <QrCode className="h-4 w-4" /> Enter code
            </div>
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label>6-digit code</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123 456"
                  inputMode="numeric"
                  className="text-center font-mono text-2xl tracking-[0.4em]"
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">Share location</div>
                    <div className="text-xs text-muted-foreground">
                      Required if lecturer set a geofence.
                    </div>
                  </div>
                </div>
                <Switch checked={useGeo} onCheckedChange={setUseGeo} />
              </div>
              <Button className="w-full" onClick={() => submit()} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit attendance
              </Button>
              <p className="text-center font-mono text-[11px] text-muted-foreground">
                Signing in from this device · {shortDeviceId(getDeviceId())}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Camera className="h-4 w-4" /> Scan QR
            </div>
            <div
              ref={scanRegionRef}
              className="mt-4 aspect-square overflow-hidden rounded-2xl bg-muted/60"
            />
            {!scanning ? (
              <Button variant="outline" className="mt-4 w-full" onClick={startScan}>
                Start camera
              </Button>
            ) : (
              <Button variant="outline" className="mt-4 w-full" onClick={stopScan}>
                Stop
              </Button>
            )}
            <div className="mt-3 flex items-center justify-between rounded-xl border border-border/60 p-3">
              <div className="text-sm font-medium">Auto-open camera</div>
              <Switch
                checked={autoCam}
                onCheckedChange={(v) => {
                  setAutoCam(v);
                  try {
                    localStorage.setItem("slams:auto-camera", v ? "1" : "0");
                  } catch {
                    /* ignore */
                  }
                }}
              />
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Point at the QR displayed by your lecturer.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
