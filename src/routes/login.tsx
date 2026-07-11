import { createFileRoute, useNavigate, useRouter, redirect, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { login, me } from "@/lib/api.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { GraduationCap, Loader2 } from "lucide-react";
import { AuroraBackground, Orb } from "@/components/Background";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSiteSettings } from "@/lib/useSiteSettings";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — SLAMS" },
      { name: "description", content: "Sign in to your SLAMS account to manage or attend lectures." },
    ],
  }),
  beforeLoad: async () => {
    const user = await me();
    if (user) {
      const dest = user.role === "admin" ? "/admin" : user.role === "lecturer" ? "/lecturer" : "/student";
      throw redirect({ to: dest });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const loginFn = useServerFn(login);
  const { data: settings } = useSiteSettings();
  const institution = settings?.institutionName ?? "SLAMS";
  const domain = settings?.demoEmailDomain ?? "slams.edu";
  const pw = settings?.demoPassword ?? "password123";
  const demoOn = settings?.demoAccountsEnabled ?? true;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await loginFn({ data: { email, password } });
      toast.success(`Welcome back, ${user.name}`);
      await router.invalidate();
      const dest = user.role === "admin" ? "/admin" : user.role === "lecturer" ? "/lecturer" : "/student";
      navigate({ to: dest });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  const demo = (r: "admin" | "lecturer" | "student") => {
    setEmail(`${r}@${domain}`);
    setPassword(pw);
  };

  return (
    <AuroraBackground className="min-h-screen bg-hero-gradient">
      <div className="absolute right-4 top-4 z-50">
        <ThemeToggle />
      </div>
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-2">
        <div className="relative hidden flex-col justify-between p-12 lg:flex">
          <Orb className="left-10 top-10 h-64 w-64" />
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary-gradient text-primary-foreground shadow-glow">
              <GraduationCap className="h-4 w-4" />
            </div>
            <span className="font-display text-lg font-semibold">{institution}</span>
          </Link>
          <div>
            <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight">
              Sign in to your <br /> attendance workspace.
            </h1>
            <p className="mt-4 max-w-md text-muted-foreground">
              Manage courses, run live sessions, or sign in for today's lecture in seconds.
            </p>
            {demoOn && (
              <div className="mt-8 grid gap-2 text-sm">
                {(["admin", "lecturer", "student"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => demo(r)}
                    className="group flex items-center justify-between rounded-xl border border-border/70 bg-background/70 px-4 py-3 text-left backdrop-blur transition hover:border-primary/50 hover:bg-background"
                  >
                    <div>
                      <div className="text-xs uppercase tracking-widest text-muted-foreground">Demo {r}</div>
                      <div className="font-mono">{r}@{domain}</div>
                    </div>
                    <span className="text-xs text-primary opacity-0 transition group-hover:opacity-100">Autofill →</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} {institution}</p>
        </div>

        <div className="flex items-center justify-center p-6 sm:p-12">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-md rounded-3xl border border-border/70 bg-card/80 p-8 shadow-lift backdrop-blur-xl"
          >
              <Link to="/" className="mb-6 inline-flex items-center gap-2 lg:hidden">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <GraduationCap className="h-4 w-4" />
                </div>
                <span className="font-display text-lg font-semibold">{institution}</span>
              </Link>
              <h2 className="font-display text-2xl font-semibold">Welcome back</h2>
              <p className="mt-1 text-sm text-muted-foreground">Enter your credentials to continue.</p>

              <div className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign in
                </Button>
              </div>
              {demoOn && (
                <p className="mt-6 text-center text-xs text-muted-foreground">
                  Demo password for all roles: <span className="font-mono">{pw}</span>
                </p>
              )}
          </form>
        </div>
      </div>
    </AuroraBackground>
  );
}
