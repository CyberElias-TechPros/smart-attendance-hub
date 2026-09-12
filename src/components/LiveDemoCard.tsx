import { useEffect, useRef, useState } from "react";
import { CheckCircle2, QrCode } from "lucide-react";

const SIGN_INS = [
  { name: "Ada Obi", matric: "CSC/21/1001" },
  { name: "Ibrahim Bello", matric: "CSC/21/1002" },
  { name: "Ngozi Eze", matric: "CSC/21/1003" },
  { name: "Fatima Musa", matric: "MTH/21/2001" },
  { name: "Tunde Adebayo", matric: "CSC/21/1004" },
  { name: "Grace Nwosu", matric: "CSC/21/1005" },
];

const demoCode = () => String(100000 + Math.floor(Math.random() * 900000));

/**
 * A living miniature of a SLAMS lecture: the countdown ticks, the code
 * rotates like the real anti-sharing engine, sign-ins stream in, and the QR
 * re-encodes itself. Pauses off-screen / in background tabs, and renders a
 * single static frame for reduced motion.
 */
export function LiveDemoCard() {
  const [code, setCode] = useState("483902");
  const [secsLeft, setSecsLeft] = useState(4 * 60 + 12);
  const [rotateIn, setRotateIn] = useState(8);
  const [signed, setSigned] = useState(42);
  const [toastIdx, setToastIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = cardRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      threshold: 0.1,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Re-encode the QR whenever the demo code rotates (lazy encoder).
  useEffect(() => {
    if (!qrRef.current) return;
    const canvas = qrRef.current;
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toCanvas(canvas, `${window.location.origin}/student/attend?code=${code}`, {
          width: 176,
          margin: 1,
          color: { dark: "#122b23", light: "#ffffff" },
        }),
      )
      .catch(() => {});
  }, [code]);

  useEffect(() => {
    if (reduced.current) return;
    const t = setInterval(() => {
      if (!visible || document.hidden) return;
      setSecsLeft((s) => (s <= 1 ? 4 * 60 + 12 : s - 1));
      setRotateIn((r) => {
        if (r <= 1) {
          setCode(demoCode());
          return 8;
        }
        return r - 1;
      });
      if (Math.random() < 0.45) {
        setSigned((n) => {
          const next = n + 1;
          if (next > 54) return 42;
          setToastIdx((i) => (i + 1) % SIGN_INS.length);
          return next;
        });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [visible]);

  const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0");
  const ss = String(secsLeft % 60).padStart(2, "0");
  const toast = SIGN_INS[toastIdx % SIGN_INS.length];

  return (
    <div ref={cardRef} className="relative">
      <div className="relative rounded-3xl border border-border/70 bg-card/80 p-6 shadow-lift backdrop-blur-xl">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono uppercase tracking-widest">Live session</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 font-medium text-success">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Broadcasting
          </span>
        </div>
        <div className="mt-4">
          <div className="font-display text-2xl font-semibold">CSC 305 · Data Structures</div>
          <div className="text-sm text-muted-foreground">Hall B · Mon 10:00 – 11:00</div>
        </div>
        <div className="relative mt-6 flex items-center justify-center">
          <div className="relative rounded-2xl bg-foreground p-4 shadow-elegant">
            <canvas
              ref={qrRef}
              className="h-44 w-44 rounded-lg bg-white"
              role="img"
              aria-label="Demo QR code linking to the student sign-in page"
            />
            <div className="absolute -right-3 -top-3 grid h-9 w-9 animate-float place-items-center rounded-full bg-accent text-accent-foreground shadow-elegant">
              <QrCode className="h-4 w-4" />
            </div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3 text-center text-sm">
          <div className="rounded-lg bg-muted/60 py-2">
            <div className="text-xs text-muted-foreground">Code</div>
            <div
              key={code}
              className="animate-scale-in font-mono text-base font-semibold tracking-widest"
            >
              {code.slice(0, 3)} {code.slice(3)}
            </div>
            <div className="mt-1 font-mono text-[10px] text-primary">↻ {rotateIn}s</div>
          </div>
          <div className="rounded-lg bg-muted/60 py-2">
            <div className="text-xs text-muted-foreground">Expires in</div>
            <div className="font-mono text-base font-semibold tabular-nums">
              {mm}:{ss}
            </div>
          </div>
          <div className="rounded-lg bg-muted/60 py-2">
            <div className="text-xs text-muted-foreground">Signed in</div>
            <div className="font-mono text-base font-semibold tabular-nums">{signed} / 54</div>
          </div>
        </div>
      </div>
      <div
        key={toastIdx}
        className="absolute -bottom-6 -left-6 hidden animate-fade-up rounded-2xl border border-border/70 bg-background/90 p-3 shadow-elegant backdrop-blur md:block"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="text-xs">
            <div className="font-semibold">{toast.name} signed in</div>
            <div className="text-muted-foreground">
              {toast.matric} · {Math.round(signed * 3.7) % 59}s ago · {8 + ((signed * 13) % 40)}m
              away
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
