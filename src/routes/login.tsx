import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { GraduationCap, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AuroraBackground, Orb } from "@/components/Background";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError, errorMessage } from "@/lib/api";
import { homePathForRole, useAuth } from "@/lib/auth";
import { usePublicSettings } from "@/lib/useSiteSettings";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated) {
      throw redirect({ to: homePathForRole(context.auth.user!.role) });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { signIn } = useAuth();
  const { data: settings } = usePublicSettings();

  const institution = settings?.institutionName ?? "SLAMS";
  const demoOn = settings?.demoAccountsEnabled ?? false;
  const domain = settings?.demoEmailDomain ?? "slams.edu";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const user = await signIn(email, password);
      toast.success(`Welcome back, ${user.name}`);
      // Only follow an internal redirect target — never an absolute URL, which
      // would turn the login form into an open redirect.
      const target =
        search.redirect && search.redirect.startsWith("/") && !search.redirect.startsWith("//")
          ? search.redirect
          : homePathForRole(user.role);
      await navigate({ to: target, replace: true });
    } catch (error) {
      if (error instanceof ApiClientError && error.fields) setFieldErrors(error.fields);
      setFormError(errorMessage(error));
    } finally {
      setLoading(false);
    }
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
                {(["admin", "lecturer", "student"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setEmail(`${role}@${domain}`)}
                    className="group flex items-center justify-between rounded-xl border border-border/70 bg-background/70 px-4 py-3 text-left backdrop-blur transition hover:border-primary/50 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div>
                      <div className="text-xs uppercase tracking-widest text-muted-foreground">
                        Demo {role}
                      </div>
                      <div className="font-mono">
                        {role}@{domain}
                      </div>
                    </div>
                    <span className="text-xs text-primary opacity-0 transition group-hover:opacity-100">
                      Use this email →
                    </span>
                  </button>
                ))}
                <p className="text-xs text-muted-foreground">
                  Ask your administrator for the demo password.
                </p>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} {institution}
          </p>
        </div>

        <div className="flex items-center justify-center p-6 sm:p-12">
          <form
            onSubmit={handleSubmit}
            noValidate
            className="w-full max-w-md rounded-3xl border border-border/70 bg-card/80 p-8 shadow-lift backdrop-blur-xl"
          >
            <Link to="/" className="mb-6 inline-flex items-center gap-2 lg:hidden">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                <GraduationCap className="h-4 w-4" />
              </div>
              <span className="font-display text-lg font-semibold">{institution}</span>
            </Link>
            <h2 className="font-display text-2xl font-semibold">Welcome back</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your credentials to continue.
            </p>

            {formError && (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {formError}
              </div>
            )}

            <div className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@university.edu"
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "email-error" : undefined}
                />
                {fieldErrors.email && (
                  <p id="email-error" className="text-xs text-destructive">
                    {fieldErrors.email}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? "password-error" : undefined}
                />
                {fieldErrors.password && (
                  <p id="password-error" className="text-xs text-destructive">
                    {fieldErrors.password}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? "Signing in" : "Sign in"}
              </Button>
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Trouble signing in? Contact your institution's administrator.
            </p>
          </form>
        </div>
      </div>
    </AuroraBackground>
  );
}
