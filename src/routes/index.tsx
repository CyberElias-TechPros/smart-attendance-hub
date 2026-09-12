import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  QrCode,
  BarChart3,
  ShieldCheck,
  MapPin,
  FileText,
  Gauge,
  GraduationCap,
  Users,
  BookOpen,
  CheckCircle2,
  Sparkles,
  Star,
  RefreshCw,
  Fingerprint,
  ListChecks,
  AlertTriangle,
} from "lucide-react";
import { AuroraBackground, Orb } from "@/components/Background";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar } from "@/components/Avatar";
import { Reveal } from "@/components/Reveal";
import { Spotlight } from "@/components/Spotlight";
import { LiveDemoCard } from "@/components/LiveDemoCard";
import { usePublicSettings } from "@/lib/useSiteSettings";

const DEFAULT_MARQUEE = [
  "Faculty of Science",
  "Faculty of Engineering",
  "Faculty of Arts",
  "Business School",
  "College of Medicine",
  "School of Computing",
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SLAMS — Smart Lecture Attendance Management" },
      {
        name: "description",
        content:
          "Digital lecture attendance for universities: QR sign-in, live sessions, GPS verification, automatic percentages, PDF & Excel reports.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { data: settings } = usePublicSettings();
  const institution = settings?.institutionName ?? "SLAMS";
  return (
    <div className="min-h-screen overflow-x-clip">
      <Header institutionName={institution} />
      <Hero showFakeStats={settings?.showFakeStats ?? true} />
      <LogoMarquee items={settings?.marqueeItems} />
      <Features />
      <Security />
      <HowItWorks />
      <Statement showFakeStats={settings?.showFakeStats ?? true} />
      <Roles />
      <Testimonials testimonials={settings?.testimonials} />
      <CTA settings={settings} />
      <Footer institutionName={institution} contactEmail={settings?.contactEmail ?? undefined} />
    </div>
  );
}

function Eyebrow({ icon: Icon, children }: { icon?: typeof Sparkles; children: string }) {
  return (
    <p className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-primary">
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </p>
  );
}

function Header({ institutionName }: { institutionName: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary-gradient text-primary-foreground shadow-glow">
            <GraduationCap className="h-4 w-4" />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight">
            {institutionName}
          </span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm md:flex">
          <a href="#features" className="text-muted-foreground transition hover:text-foreground">
            Features
          </a>
          <a href="#security" className="text-muted-foreground transition hover:text-foreground">
            Tamper-proof
          </a>
          <a href="#how" className="text-muted-foreground transition hover:text-foreground">
            How it works
          </a>
          <a
            href="#testimonials"
            className="text-muted-foreground transition hover:text-foreground"
          >
            Stories
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/login"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent/40"
          >
            Sign in
          </Link>
          <Link
            to="/login"
            className="hidden rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-elegant transition hover:bg-primary/90 sm:inline-flex"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero({ showFakeStats }: { showFakeStats: boolean }) {
  return (
    <AuroraBackground className="bg-hero-gradient">
      <section className="relative mx-auto grid max-w-6xl items-center gap-16 px-6 py-20 md:grid-cols-[1.05fr_0.95fr] md:py-28">
        <Spotlight />
        <Orb className="left-[-6rem] top-[-4rem] h-72 w-72" />
        <Orb className="right-[20%] top-[30%] h-56 w-56" color="oklch(0.7 0.15 200 / 0.35)" />
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 animate-blink rounded-full bg-success" />
            Live attendance in 30 seconds
          </span>
          <h1 className="mt-5 text-balance font-display text-5xl font-bold leading-[1.05] tracking-tight text-foreground md:text-6xl">
            Retire the <span className="gradient-text">paper attendance</span> sheet.
          </h1>
          <p className="mt-5 max-w-lg text-balance text-lg text-muted-foreground">
            SLAMS turns any lecture hall into a secure, digital attendance loop — rotating QR codes,
            venue GPS lock, and automatic percentages, without spreadsheets.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/login"
              className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-glow transition hover:bg-primary/90"
            >
              Launch dashboard
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#security"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background/70 px-5 py-3 text-sm font-medium text-foreground backdrop-blur transition hover:bg-accent/40"
            >
              <ShieldCheck className="h-4 w-4 text-primary" />
              See the tamper-proofing
            </a>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {["Rotating codes", "Venue GPS lock", "Device fingerprints"].map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-2.5 py-1 backdrop-blur"
              >
                <CheckCircle2 className="h-3 w-3 text-success" />
                {t}
              </span>
            ))}
          </div>
          <dl className="mt-8 grid grid-cols-3 gap-6 border-t border-border/60 pt-6 text-sm">
            {showFakeStats && (
              <div>
                <dt className="text-muted-foreground">Sign-in time</dt>
                <dd className="mt-1 font-display text-xl font-semibold">
                  <AnimatedNumber value={4} format={(n) => `~${Math.round(n)}s`} />
                </dd>
              </div>
            )}
            {showFakeStats && (
              <div>
                <dt className="text-muted-foreground">Shared codes killed</dt>
                <dd className="mt-1 font-display text-xl font-semibold">
                  <AnimatedNumber value={100} format={(n) => `${Math.round(n)}%`} />
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Report formats</dt>
              <dd className="mt-1 font-display text-xl font-semibold">PDF · XLSX</dd>
            </div>
          </dl>
        </div>

        <div className="relative animate-fade-up" style={{ animationDelay: "120ms" }}>
          <Orb
            className="left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2"
            color="oklch(0.78 0.14 90 / 0.3)"
          />
          <LiveDemoCard />
          <p className="mt-8 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            ↑ live miniature — code rotates, sign-ins stream in
          </p>
        </div>
      </section>
    </AuroraBackground>
  );
}

function LogoMarquee({ items }: { items?: string[] }) {
  const list = items && items.length > 0 ? items : DEFAULT_MARQUEE;
  return (
    <div className="border-y border-border/60 bg-background/60">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <p className="text-center text-xs uppercase tracking-[0.25em] text-muted-foreground">
          Trusted by faculties running SLAMS
        </p>
        <div className="relative mt-4 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
          <div className="flex w-max animate-marquee gap-10">
            {[...list, ...list].map((i, idx) => (
              <span
                key={idx}
                className="whitespace-nowrap font-display text-sm font-medium text-muted-foreground/80"
              >
                {i}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-6xl px-6 py-24">
      <Spotlight />
      <Reveal className="max-w-2xl">
        <Eyebrow icon={Sparkles}>Platform</Eyebrow>
        <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight">
          Everything a modern faculty needs.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Purpose-built for high-frequency lectures, large cohorts, and the messy reality of shared
          halls.
        </p>
      </Reveal>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        <Reveal variant="scale" className="md:col-span-2 md:row-span-2">
          <div className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-border/70 bg-card p-7 transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lift">
            <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl transition group-hover:bg-primary/20" />
            <div className="flex items-start justify-between">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                <QrCode className="h-6 w-6" />
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 font-mono text-xs font-medium text-success">
                <span className="h-1.5 w-1.5 animate-blink rounded-full bg-success" />
                rotating
              </span>
            </div>
            <div className="relative mx-auto my-8">
              <div className="absolute inset-[-18px] animate-ring rounded-full border-2 border-dashed border-primary/30" />
              <div className="grid h-36 w-36 place-items-center rounded-3xl bg-foreground shadow-elegant">
                <div className="grid grid-cols-5 grid-rows-5 gap-[3px]">
                  {Array.from({ length: 25 }).map((_, i) => (
                    <span
                      key={i}
                      className={
                        (i * 7 + 3) % 4 === 0 ? "" : "h-2.5 w-2.5 rounded-[2px] bg-background"
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border/70 bg-background px-3 py-1 font-mono text-xs shadow-elegant">
                482 903 <span className="text-primary">↻ 60s</span>
              </div>
            </div>
            <div>
              <h3 className="font-display text-2xl font-semibold">Rotating QR codes</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Each session broadcasts a fresh code on a timer — every 30 seconds to 5 minutes. A
                screenshot forwarded to an absent friend dies before it can be used.
              </p>
            </div>
          </div>
        </Reveal>
        <Reveal variant="scale" delay={80}>
          <BentoCell
            icon={MapPin}
            title="Venue GPS lock"
            body="Sign-ins only count inside the lecture venue. Every record stores its distance from the hall."
            visual={
              <div className="relative grid h-16 w-16 place-items-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
                <span className="absolute inset-3 rounded-full border border-primary/30" />
                <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground">
                  <MapPin className="h-4 w-4" />
                </span>
              </div>
            }
          />
        </Reveal>
        <Reveal variant="scale" delay={140}>
          <BentoCell
            icon={ShieldCheck}
            title="One student, one sign-in"
            body="Duplicates are rejected at the database level — not by trust, not by UI."
            visual={
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="rounded-md bg-success/10 px-2 py-1 text-success">Ada ×1 ✓</span>
                <span className="rounded-md bg-destructive/10 px-2 py-1 text-destructive line-through">
                  Ada ×2
                </span>
              </div>
            }
          />
        </Reveal>
        <Reveal variant="scale" delay={100}>
          <BentoCell
            icon={BarChart3}
            title="Live analytics"
            body="Watch the attendance curve build during the lecture, drill down by student."
            visual={
              <div className="flex h-14 items-end gap-1.5" aria-hidden>
                {[35, 60, 45, 80, 55, 95, 70].map((h, i) => (
                  <span
                    key={i}
                    className="w-3 animate-eq rounded-sm bg-gradient-to-t from-primary/60 to-accent"
                    style={{ height: `${h}%`, animationDelay: `${i * 140}ms` }}
                  />
                ))}
              </div>
            }
          />
        </Reveal>
        <Reveal variant="scale" delay={160}>
          <BentoCell
            icon={FileText}
            title="PDF & Excel exports"
            body="Semester-end reports ready to email or print — forensics included."
            visual={
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="rounded-md border border-border bg-muted/60 px-2 py-1 font-mono">
                  .pdf
                </span>
                <span className="rounded-md border border-border bg-muted/60 px-2 py-1 font-mono">
                  .xlsx
                </span>
              </div>
            }
          />
        </Reveal>
        <Reveal variant="scale" delay={220}>
          <BentoCell
            icon={Gauge}
            title="Automatic percentages"
            body="Percentages recompute the second a session closes. No spreadsheet gymnastics."
            visual={<PercentRing value={87} />}
          />
        </Reveal>
      </div>
    </section>
  );
}

function BentoCell({
  icon: Icon,
  title,
  body,
  visual,
}: {
  icon: typeof MapPin;
  title: string;
  body: string;
  visual: React.ReactNode;
}) {
  return (
    <div className="group relative flex h-full min-h-56 flex-col justify-between gap-6 overflow-hidden rounded-2xl border border-border/70 bg-card p-6 transition duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lift">
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/5 blur-2xl transition group-hover:bg-primary/15" />
      <div className="flex items-start justify-between">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
          <Icon className="h-5 w-5" />
        </div>
        {visual}
      </div>
      <div>
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function PercentRing({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16" role="img" aria-label={`${value}% attendance`}>
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * value) / 100}
          className="stroke-primary"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-xs font-semibold">
        {value}%
      </span>
    </div>
  );
}

function Security() {
  const items = [
    {
      icon: RefreshCw,
      t: "Codes rotate on a timer",
      d: "A fresh 6-digit code every 30s–5m. Shared codes expire before they travel.",
    },
    {
      icon: MapPin,
      t: "Venue lock with proof",
      d: "Sign-ins outside the GPS radius are rejected — and each record keeps its distance.",
    },
    {
      icon: Fingerprint,
      t: "Device fingerprints",
      d: "Every sign-in carries a device id. Three devices for one student? Flagged.",
    },
    {
      icon: ListChecks,
      t: "Forensics in every report",
      d: "Distance, device and timestamps ride along into PDF & Excel exports.",
    },
  ];
  return (
    <section id="security" className="relative overflow-hidden border-y border-border/60">
      <div className="absolute inset-0 bg-[#0c2721]">
        <div className="absolute inset-0 bg-aurora animate-aurora opacity-40" />
        <div className="absolute inset-0 bg-noise opacity-[0.05] mix-blend-overlay" />
      </div>
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 text-emerald-50 lg:grid-cols-2">
        <Spotlight />
        <Reveal variant="left">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-emerald-200">
            <ShieldCheck className="h-3 w-3" /> Tamper-proof
          </p>
          <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight md:text-5xl">
            Built to survive the group chat.
          </h2>
          <p className="mt-3 max-w-md text-emerald-100/70">
            Codes get screenshotted. Friends cover for friends. SLAMS assumes all of that — and
            verifies presence anyway.
          </p>
          <ul className="mt-8 space-y-5">
            {items.map((f, i) => (
              <Reveal key={f.t} variant="left" delay={i * 90}>
                <li className="flex gap-4">
                  <div className="grid h-11 w-11 flex-none place-items-center rounded-xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
                    <f.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-display font-semibold">{f.t}</div>
                    <div className="mt-0.5 text-sm text-emerald-100/60">{f.d}</div>
                  </div>
                </li>
              </Reveal>
            ))}
          </ul>
        </Reveal>
        <Reveal variant="right" delay={120}>
          <div className="relative rounded-3xl border border-emerald-300/20 bg-emerald-950/60 p-6 shadow-lift backdrop-blur-xl">
            <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.25em] text-emerald-200/60">
              <span>Live forensics</span>
              <span className="inline-flex items-center gap-1.5 text-emerald-300">
                <span className="h-1.5 w-1.5 animate-blink rounded-full bg-emerald-300" />
                CSC 305
              </span>
            </div>
            <div className="mt-5 space-y-2.5 font-mono text-xs">
              <ForensicRow name="Ada Obi" meta="12m · a1b2c3d4" ok />
              <ForensicRow name="Ngozi Eze" meta="48m · e7f91c2a" ok />
              <ForensicRow name="Ibrahim Bello" meta="3 devices" warn />
              <ForensicRow name="Tunde Adebayo" meta="11,204m — rejected" bad />
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl border border-emerald-300/15 bg-emerald-300/5 px-4 py-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-200/50">
                  Current code
                </div>
                <div className="font-mono text-xl font-semibold tracking-[0.3em] text-emerald-100">
                  482 903
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-200/50">
                  Rotates in 0:42
                </div>
                <div className="mt-2 h-1 w-28 overflow-hidden rounded-full bg-emerald-300/15">
                  <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-emerald-300 to-amber-300" />
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function ForensicRow({
  name,
  meta,
  ok,
  warn,
  bad,
}: {
  name: string;
  meta: string;
  ok?: boolean;
  warn?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-emerald-300/10 bg-emerald-950/80 px-3 py-2">
      <span className="font-semibold text-emerald-50">{name}</span>
      <span className="flex items-center gap-1.5 text-emerald-100/60">
        {meta}
        {ok && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />}
        {warn && <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />}
        {bad && (
          <span className="rounded bg-red-400/15 px-1.5 py-0.5 text-[10px] text-red-300">
            blocked
          </span>
        )}
      </span>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      t: "Lecturer opens a session",
      d: "Pick the course, set the duration. Venue lock and code rotation arm themselves by default.",
      tag: "10 seconds",
    },
    {
      n: "02",
      t: "Students sign in",
      d: "Scan the rotating QR or type the 6-digit code on any phone browser — no app install.",
      tag: "4 seconds",
    },
    {
      n: "03",
      t: "Session closes itself",
      d: "Attendance freezes with full forensics. Percentages recompute instantly across the semester.",
      tag: "automatic",
    },
  ];
  return (
    <section id="how" className="mx-auto max-w-6xl px-6 py-24">
      <Reveal className="max-w-2xl">
        <Eyebrow>Workflow</Eyebrow>
        <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight">
          A lecture in three moves.
        </h2>
      </Reveal>
      <div className="mt-12">
        {steps.map((s, i) => (
          <Reveal key={s.n} variant="up" delay={i * 100}>
            <div className="group grid items-center gap-4 border-t border-border/60 py-8 transition last:border-b md:grid-cols-[auto_1fr_1fr_auto] md:gap-10">
              <div className="font-display text-6xl font-bold text-outline transition group-hover:[-webkit-text-stroke-color:oklch(0.5_0.13_165)] md:text-7xl">
                {s.n}
              </div>
              <h3 className="font-display text-2xl font-semibold">{s.t}</h3>
              <p className="max-w-md text-sm text-muted-foreground">{s.d}</p>
              <span className="w-fit rounded-full bg-primary/10 px-3 py-1 font-mono text-xs font-medium text-primary">
                {s.tag}
              </span>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Statement({ showFakeStats }: { showFakeStats: boolean }) {
  return (
    <section className="relative overflow-hidden border-y border-border/60 bg-secondary/40">
      <Orb className="left-[10%] top-[-4rem] h-64 w-64" />
      <Orb className="bottom-[-5rem] right-[5%] h-72 w-72" color="oklch(0.78 0.14 90 / 0.35)" />
      <div className="relative mx-auto max-w-6xl px-6 py-24 text-center">
        <Reveal variant="clip">
          <p className="font-display text-4xl font-bold leading-tight tracking-tight text-balance md:text-6xl">
            Paper sheets belong in <span className="gradient-text">museums.</span>
          </p>
        </Reveal>
        <Reveal delay={140}>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Every lecture captured, verified and reported — before the students reach the door.
          </p>
        </Reveal>
        {showFakeStats && (
          <Reveal delay={220}>
            <div className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-6">
              <div>
                <div className="font-display text-3xl font-bold md:text-4xl">
                  <AnimatedNumber value={4} format={(n) => `~${Math.round(n)}s`} />
                </div>
                <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
                  per sign-in
                </div>
              </div>
              <div>
                <div className="font-display text-3xl font-bold md:text-4xl">
                  <AnimatedNumber value={60} format={(n) => `${Math.round(n)}s`} />
                </div>
                <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
                  code lifetime
                </div>
              </div>
              <div>
                <div className="font-display text-3xl font-bold md:text-4xl">
                  <AnimatedNumber value={0} format={() => "0"} />
                </div>
                <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
                  sheets of paper
                </div>
              </div>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

function Roles() {
  const roles = [
    {
      icon: ShieldCheck,
      t: "Administrators",
      pts: [
        "Register students & lecturers",
        "Manage departments and courses",
        "Assign lecturers",
        "Faculty-wide reports",
      ],
    },
    {
      icon: BookOpen,
      t: "Lecturers",
      pts: [
        "Start & end sessions",
        "Live QR + rotating codes",
        "Per-student forensics",
        "Export to PDF/Excel",
      ],
    },
    {
      icon: Users,
      t: "Students",
      pts: [
        "Scan QR or type code",
        "See course-by-course %",
        "History with timestamps",
        "Works on any phone",
      ],
    },
  ];
  return (
    <section id="roles" className="mx-auto max-w-6xl px-6 py-24">
      <Reveal className="max-w-2xl">
        <Eyebrow>Built for</Eyebrow>
        <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight">
          Every role in the faculty.
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {roles.map((r, i) => (
          <Reveal key={r.t} delay={i * 90}>
            <div className="group relative h-full overflow-hidden rounded-2xl border border-border/70 bg-card p-6 transition duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lift">
              <div className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-primary to-accent transition-transform duration-300 group-hover:scale-x-100" />
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent/20 text-accent-foreground">
                <r.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{r.t}</h3>
              <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                {r.pts.map((p) => (
                  <li key={p} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-primary" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Testimonials({
  testimonials,
}: {
  testimonials?: { name: string; role: string; text: string }[];
}) {
  if (!testimonials || testimonials.length === 0) return null;
  const items = testimonials;
  return (
    <section id="testimonials" className="border-y border-border/60 bg-secondary/40">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <Reveal>
          <h2 className="font-display text-3xl font-semibold tracking-tight">
            Loved by lecturers and students alike.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {items.map((t, i) => (
            <Reveal key={t.name} delay={i * 90}>
              <figure className="flex h-full flex-col rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
                <div className="flex gap-0.5 text-accent">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-current" />
                  ))}
                </div>
                <blockquote className="mt-4 flex-1 text-sm text-foreground/90">
                  “{t.text}”
                </blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <Avatar name={t.name} seed={t.name} size="sm" />
                  <div>
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.role}</div>
                  </div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA({
  settings,
}: {
  settings?: {
    demoAccountsEnabled?: boolean;
    demoPassword?: string;
    demoEmailDomain?: string;
    institutionName?: string;
  };
}) {
  const domain = settings?.demoEmailDomain ?? "slams.edu";
  const pw = settings?.demoPassword ?? "password123";
  const demoOn = settings?.demoAccountsEnabled ?? true;
  const institution = settings?.institutionName ?? "SLAMS";
  const demos = [
    { r: "Admin", e: `admin@${domain}` },
    { r: "Lecturer", e: `lecturer@${domain}` },
    { r: "Student", e: `student@${domain}` },
  ];
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <Reveal variant="scale">
        <AuroraBackground className="relative overflow-hidden rounded-3xl bg-primary p-10 text-primary-foreground shadow-lift md:p-14">
          <div className="absolute inset-0 bg-noise opacity-[0.04] mix-blend-overlay" />
          <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-xl">
              <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
                Ready to run your next lecture on {institution}?
              </h2>
              <p className="mt-2 text-primary-foreground/80">
                {demoOn
                  ? "Sign in with any of the demo roles below to explore the full workflow."
                  : "Sign in to explore the full attendance workflow."}
              </p>
            </div>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-md bg-background px-5 py-3 text-sm font-semibold text-primary shadow-elegant transition hover:bg-background/90"
            >
              Open dashboard <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {demoOn && (
            <div className="relative mt-8 grid gap-3 text-sm sm:grid-cols-3">
              {demos.map((x) => (
                <div key={x.r} className="rounded-xl bg-background/10 p-3 backdrop-blur">
                  <div className="text-xs uppercase tracking-widest text-primary-foreground/70">
                    {x.r}
                  </div>
                  <div className="mt-1 font-mono">{x.e}</div>
                  <div className="text-xs text-primary-foreground/70">password: {pw}</div>
                </div>
              ))}
            </div>
          )}
        </AuroraBackground>
      </Reveal>
    </section>
  );
}

function Footer({
  institutionName,
  contactEmail,
}: {
  institutionName: string;
  contactEmail?: string;
}) {
  return (
    <footer className="border-t border-border/60 bg-background/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary-gradient text-primary-foreground shadow-glow">
              <GraduationCap className="h-4 w-4" />
            </div>
            <span className="font-display text-lg font-semibold">{institutionName}</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Smart Lecture Attendance Management — secure sign-ins, live sessions, and reports
            universities can trust.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5 font-mono text-[11px] text-muted-foreground">
            {["QR", "GPS", "PDF", "XLSX"].map((t) => (
              <span key={t} className="rounded border border-border/70 px-1.5 py-0.5">
                {t}
              </span>
            ))}
          </div>
        </div>
        <nav aria-label="Product">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Product
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a href="#features" className="transition hover:text-primary">
                Features
              </a>
            </li>
            <li>
              <a href="#security" className="transition hover:text-primary">
                Tamper-proof
              </a>
            </li>
            <li>
              <a href="#how" className="transition hover:text-primary">
                How it works
              </a>
            </li>
            <li>
              <a href="#testimonials" className="transition hover:text-primary">
                Stories
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label="Roles">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Sign in
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link to="/login" className="transition hover:text-primary">
                Administrator
              </Link>
            </li>
            <li>
              <Link to="/login" className="transition hover:text-primary">
                Lecturer
              </Link>
            </li>
            <li>
              <Link to="/login" className="transition hover:text-primary">
                Student
              </Link>
            </li>
          </ul>
        </nav>
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Contact
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {contactEmail ? (
              <a href={`mailto:${contactEmail}`} className="transition hover:text-primary">
                {contactEmail}
              </a>
            ) : (
              "Managed by your institution's admin."
            )}
          </p>
        </div>
      </div>
      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-5 text-xs text-muted-foreground md:flex-row">
          <span>
            © {new Date().getFullYear()} {institutionName}. Built for universities.
          </span>
          <span className="font-mono">Rotating codes · Venue lock · Zero paper</span>
        </div>
      </div>
    </footer>
  );
}
