import { createFileRoute, redirect } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { users } from "@/lib/api";
import { deptsQO, loadCurrentUser } from "@/lib/queries";
import { PageHeader } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, UserCog, Mail, GraduationCap, Save } from "lucide-react";
import { RouteTransition } from "@/components/RouteTransition";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context }) => {
    const user = await loadCurrentUser(context);
    if (!user) throw redirect({ to: "/login" });
    await context.queryClient.ensureQueryData(deptsQO);
    return { user };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = Route.useRouteContext();
  const { data: depts } = useSuspenseQuery(deptsQO);
  const qc = useQueryClient();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);

  const dept = depts.find((d) => d.id === user.departmentId);
  const roleLabel = user.role.charAt(0).toUpperCase() + user.role.slice(1);

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return toast.error("New password must be at least 8 characters");
    if (next !== confirm) return toast.error("New passwords do not match");
    try {
      await users.changePassword(cur, next);
      toast.success("Password changed");
      setCur("");
      setNext("");
      setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await users.updateProfile({ name, email });
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <RouteTransition>
      <PageHeader title="Settings" subtitle="Your profile and account security." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
            <div className="flex flex-col items-center text-center">
              <Avatar name={user.name} seed={user.id} size="xl" />
              <div className="mt-4 font-display text-lg font-semibold">{user.name}</div>
              <div className="text-sm text-muted-foreground">{user.email}</div>
              <Badge className="mt-2" variant="secondary">
                {roleLabel}
              </Badge>
            </div>
            <div className="mt-5 space-y-2 border-t border-border/60 pt-4 text-sm">
              <Row
                icon={<GraduationCap className="h-4 w-4" />}
                label="Department"
                value={dept?.name ?? "—"}
              />
              {user.role === "student" && (
                <Row
                  icon={<UserCog className="h-4 w-4" />}
                  label="Matric"
                  value={user.matricNo ?? "—"}
                />
              )}
              {user.role === "lecturer" && (
                <Row
                  icon={<UserCog className="h-4 w-4" />}
                  label="Staff ID"
                  value={user.staffId ?? "—"}
                />
              )}
              {user.level && (
                <Row
                  icon={<GraduationCap className="h-4 w-4" />}
                  label="Level"
                  value={user.level}
                />
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <form
            onSubmit={saveProfile}
            className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant"
          >
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <Mail className="h-4 w-4" />
              </div>
              <h2 className="font-display text-lg font-semibold">Update profile</h2>
            </div>
            <div className="mt-5 max-w-md space-y-4">
              <div className="space-y-1.5">
                <Label>Display name</Label>
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button type="submit">
                <Save className="mr-2 h-4 w-4" /> Save profile
              </Button>
            </div>
          </form>

          <form
            onSubmit={savePassword}
            className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant"
          >
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <KeyRound className="h-4 w-4" />
              </div>
              <h2 className="font-display text-lg font-semibold">Change password</h2>
            </div>
            <div className="mt-5 max-w-md space-y-4">
              <div className="space-y-1.5">
                <Label>Current password</Label>
                <Input
                  type="password"
                  required
                  value={cur}
                  onChange={(e) => setCur(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1.5">
                <Label>New password</Label>
                <Input
                  type="password"
                  required
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Confirm new password</Label>
                <Input
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button type="submit">Update password</Button>
            </div>
          </form>

          <Card className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/20 text-accent-foreground">
                <Mail className="h-4 w-4" />
              </div>
              <h2 className="font-display text-lg font-semibold">Account</h2>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{user.email}</span>. Your
              session is secured with a signed token that expires after 7 days. Use the password
              form to keep your account safe.
            </p>
          </Card>
        </div>
      </div>
    </RouteTransition>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon} {label}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
