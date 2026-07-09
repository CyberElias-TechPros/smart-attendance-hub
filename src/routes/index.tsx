import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  QrCode,
  BarChart3,
  ShieldCheck,
  MapPin,
  FileText,
  Clock,
  GraduationCap,
  Users,
  BookOpen,
  CheckCircle2,
} from "lucide-react";

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
  return (
    <div className="min-h-screen">
      <Header />
      <Hero />
      <LogosBar />
      <Features />
      <HowItWorks />
      <Roles />
      <CTA />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-elegant">
            <GraduationCap className="h-4 w-4" />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight">SLAMS</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm md:flex">
          <a href="#features" className="text-muted-foreground hover:text-foreground">Features</a>
          <a href="#how" className="text-muted-foreground hover:text-foreground">How it works</a>
          <a href="#roles" className="text-muted-foreground hover:text-foreground">For</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent/40"
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

function Hero() {
  return (
    <section className="relative overflow-hidden bg-hero-gradient">
      <div className="mx-auto grid max-w-6xl gap-14 px-6 py-20 md:grid-cols-2 md:py-28">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Live attendance in 30 seconds
          </span>
          <h1 className="mt-5 text-balance font-display text-5xl font-bold leading-[1.05] tracking-tight text-foreground md:text-6xl">
            Retire the paper attendance sheet.
          </h1>
          <p className="mt-5 max-w-lg text-balance text-lg text-muted-foreground">
            SLAMS turns any lecture hall into a secure, digital attendance loop —
            unique QR codes, GPS verification, and automatic percentages, without spreadsheets.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/login"
              className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-elegant transition hover:bg-primary/90"
            >
              Launch dashboard
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background/70 px-5 py-3 text-sm font-medium text-foreground backdrop-blur transition hover:bg-accent/40"
            >
              See how it works
            </a>
          </div>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-border/60 pt-6 text-sm">
            <div><dt className="text-muted-foreground">Sign-in time</dt><dd className="mt-1 font-display text-xl font-semibold">~4s</dd></div>
            <div><dt className="text-muted-foreground">Fraud attempts blocked</dt><dd className="mt-1 font-display text-xl font-semibold">100%</dd></div>
            <div><dt className="text-muted-foreground">Report formats</dt><dd className="mt-1 font-display text-xl font-semibold">PDF · XLSX</dd></div>
          </dl>
        </div>
        <div className="relative animate-fade-up">
          <div className="relative rounded-3xl border border-border/70 bg-card p-6 shadow-lift">
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
            <div className="mt-6 flex items-center justify-center">
              <div className="grid h-52 w-52 place-items-center rounded-2xl bg-foreground p-4 shadow-elegant">
                <div className="grid h-full w-full grid-cols-12 grid-rows-12 gap-[2px]">
                  {Array.from({ length: 144 }).map((_, i) => {
                    const on = ((i * 73) ^ (i * 11)) % 3 !== 0;
                    return (
                      <span
                        key={i}
                        className={on ? "bg-background rounded-[1px]" : ""}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-lg bg-muted/60 py-2">
                <div className="text-xs text-muted-foreground">Code</div>
                <div className="font-mono text-base font-semibold tracking-widest">483 902</div>
              </div>
              <div className="rounded-lg bg-muted/60 py-2">
                <div className="text-xs text-muted-foreground">Expires in</div>
                <div className="font-mono text-base font-semibold">04:12</div>
              </div>
              <div className="rounded-lg bg-muted/60 py-2">
                <div className="text-xs text-muted-foreground">Signed in</div>
                <div className="font-mono text-base font-semibold">42 / 54</div>
              </div>
            </div>
          </div>
          <div className="absolute -bottom-6 -left-6 hidden rounded-2xl border border-border/70 bg-background/90 p-3 shadow-elegant backdrop-blur md:block">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-success/15 text-success">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="text-xs">
                <div className="font-semibold">Ada Obi signed in</div>
                <div className="text-muted-foreground">CSC/21/1001 · just now</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LogosBar() {
  const items = ["Faculty of Science", "Faculty of Engineering", "Faculty of Arts", "Business School", "College of Medicine"];
  return (
    <div className="border-y border-border/60 bg-background/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-6 py-6 text-xs uppercase tracking-widest text-muted-foreground">
        <span>Trusted by faculties running SLAMS</span>
        {items.map((i) => (
          <span key={i} className="font-medium">{i}</span>
        ))}
      </div>
    </div>
  );
}

function Features() {
  const features = [
    { icon: QrCode, title: "One-time QR codes", body: "Each session generates a unique code that expires automatically. Screenshots become useless." },
    { icon: MapPin, title: "GPS verification", body: "Optional geo-fence ensures students are inside the lecture venue before their sign-in is accepted." },
    { icon: ShieldCheck, title: "Duplicate blocked", body: "One student, one sign-in per session — enforced at the database level, not by trust." },
    { icon: BarChart3, title: "Live analytics", body: "Watch the attendance curve build during the lecture and drill down by student in real time." },
    { icon: FileText, title: "PDF & Excel exports", body: "Semester-end reports ready to email or print — grouped by course, department, or student." },
    { icon: Clock, title: "Automatic percentages", body: "Attendance percentages update the second a session closes. No spreadsheet gymnastics." },
  ];
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-24">
      <div className="max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-primary">Platform</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight">Everything a modern faculty needs.</h2>
        <p className="mt-3 text-muted-foreground">Purpose-built for high-frequency lectures, large cohorts, and the messy reality of shared halls.</p>
      </div>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="group rounded-2xl border border-border/70 bg-card p-6 transition hover:-translate-y-0.5 hover:shadow-lift">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", t: "Lecturer opens session", d: "Selects the course, sets duration, optionally locks it to a GPS radius." },
    { n: "02", t: "Students sign in", d: "Scan the QR or type the 6-digit code on any phone browser — no app install." },
    { n: "03", t: "Session closes", d: "Attendance is frozen. Percentages recompute instantly across the semester." },
  ];
  return (
    <section id="how" className="border-y border-border/60 bg-secondary/40">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-primary">Workflow</p>
            <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight">A lecture in three moves.</h2>
          </div>
        </div>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="relative rounded-2xl border border-border/70 bg-card p-6">
              <span className="font-mono text-xs text-muted-foreground">{s.n}</span>
              <h3 className="mt-2 font-display text-xl font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Roles() {
  const roles = [
    { icon: ShieldCheck, t: "Administrators", pts: ["Register students & lecturers", "Manage departments and courses", "Assign lecturers", "Faculty-wide reports"] },
    { icon: BookOpen, t: "Lecturers", pts: ["Start & end sessions", "Live QR + code display", "Per-student analytics", "Export to PDF/Excel"] },
    { icon: Users, t: "Students", pts: ["Scan QR or type code", "See course-by-course %", "History with timestamps", "Works on any phone"] },
  ];
  return (
    <section id="roles" className="mx-auto max-w-6xl px-6 py-24">
      <div className="max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-primary">Built for</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight">Every role in the faculty.</h2>
      </div>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {roles.map((r) => (
          <div key={r.t} className="rounded-2xl border border-border/70 bg-card p-6">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/20 text-accent-foreground">
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
        ))}
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <div className="relative overflow-hidden rounded-3xl bg-primary p-10 text-primary-foreground shadow-lift md:p-14">
        <div className="absolute inset-0 opacity-30 [background:radial-gradient(600px_300px_at_10%_20%,oklch(0.9_0.08_80/.45),transparent)]" />
        <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-xl">
            <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Ready to run your next lecture on SLAMS?
            </h2>
            <p className="mt-2 text-primary-foreground/80">Sign in with any of the demo roles below to explore the full workflow.</p>
          </div>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-md bg-background px-5 py-3 text-sm font-semibold text-primary shadow-elegant transition hover:bg-background/90"
          >
            Open dashboard <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="relative mt-8 grid gap-3 text-sm sm:grid-cols-3">
          {[
            { r: "Admin", e: "admin@slams.edu" },
            { r: "Lecturer", e: "lecturer@slams.edu" },
            { r: "Student", e: "student@slams.edu" },
          ].map((x) => (
            <div key={x.r} className="rounded-xl bg-background/10 p-3 backdrop-blur">
              <div className="text-xs uppercase tracking-widest text-primary-foreground/70">{x.r}</div>
              <div className="mt-1 font-mono">{x.e}</div>
              <div className="text-xs text-primary-foreground/70">password: password123</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 bg-background/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground md:flex-row">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4" />
          <span>SLAMS · Smart Lecture Attendance Management System</span>
        </div>
        <div>© {new Date().getFullYear()} SLAMS. Built for universities.</div>
      </div>
    </footer>
  );
}
