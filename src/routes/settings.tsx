import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Check, KeyRound, Loader2, LogOut, UserCog, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/AppShell";
import { RouteTransition } from "@/components/RouteTransition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Field } from "./admin.students";

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: SettingsPage,
});

/**
 * Mirrors the server-side policy in `shared/schemas.ts` so the user gets
 * immediate feedback; the server remains the authority.
 */
const PASSWORD_RULES = [
  { id: "length", label: "At least 10 characters", test: (v: string) => v.length >= 10 },
  { id: "lower", label: "A lowercase letter", test: (v: string) => /[a-z]/.test(v) },
  { id: "upper", label: "An uppercase letter", test: (v: string) => /[A-Z]/.test(v) },
  { id: "digit", label: "A number", test: (v: string) => /\d/.test(v) },
];

function SettingsPage() {
  const { user, refresh, signOut } = useAuth();
  const roleLabel =
    user?.role === "admin" ? "Administrator" : user?.role === "lecturer" ? "Lecturer" : "Student";

  return (
    <AppShell role={roleLabel} userName={user?.name ?? ""} nav={[]}>
      <RouteTransition>
        <PageHeader title="My account" subtitle="Update your profile and password." />

        <div className="max-w-2xl space-y-6">
          <ProfileSection onSaved={refresh} />
          <PasswordSection onChanged={signOut} />

          <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
            <h2 className="font-display text-lg font-semibold">Appearance</h2>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Switch between light and dark. Your choice is remembered on this device.
              </p>
              <ThemeToggle />
            </div>
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
            <h2 className="font-display text-lg font-semibold">Session</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Signing out ends this session everywhere it is stored on this device.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </section>
        </div>
      </RouteTransition>
    </AppShell>
  );
}

function ProfileSection({ onSaved }: { onSaved: () => Promise<void> | void }) {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: () => api.updateProfile({ name: name.trim(), email: email.trim() }),
    onSuccess: async () => {
      toast.success("Profile updated");
      setFieldErrors({});
      // Refresh the cached `me` payload so the shell and guards see the change.
      await onSaved();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.fields) setFieldErrors(error.fields);
      toast.error(errorMessage(error));
    },
  });

  const emailChanged = email.trim().toLowerCase() !== (user?.email ?? "").toLowerCase();

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <UserCog className="h-5 w-5 text-primary" aria-hidden /> Profile
      </h2>
      <form
        noValidate
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setFieldErrors({});
          mutation.mutate();
        }}
      >
        <Field label="Full name" htmlFor="profile-name" error={fieldErrors.name}>
          <Input
            id="profile-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
          />
        </Field>
        <Field
          label="Email address"
          htmlFor="profile-email"
          error={fieldErrors.email}
          hint={
            emailChanged
              ? "Changing your email changes the address you sign in with."
              : "This is the address you sign in with."
          }
        >
          <Input
            id="profile-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </Field>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save profile
        </Button>
      </form>
    </section>
  );
}

function PasswordSection({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const unmet = PASSWORD_RULES.filter((rule) => !rule.test(newPassword));

  const mutation = useMutation({
    mutationFn: () => api.changePassword({ currentPassword, newPassword }),
    onSuccess: async () => {
      // The server bumps `token_version`, invalidating every existing session —
      // including this one — so send the user back to sign in with the new
      // password rather than leaving a dead session in the tab.
      toast.success("Password changed. Please sign in again.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await onChanged();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.fields) setFieldErrors(error.fields);
      toast.error(errorMessage(error));
    },
  });

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
        <KeyRound className="h-5 w-5 text-primary" aria-hidden /> Password
      </h2>
      <form
        noValidate
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setFieldErrors({});
          if (unmet.length > 0) {
            setFieldErrors({ newPassword: "Your new password does not meet the requirements." });
            return;
          }
          if (newPassword !== confirmPassword) {
            setFieldErrors({ confirmPassword: "The two passwords do not match." });
            return;
          }
          mutation.mutate();
        }}
      >
        <Field
          label="Current password"
          htmlFor="current-password"
          error={fieldErrors.currentPassword}
        >
          <Input
            id="current-password"
            type="password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
          />
        </Field>

        <Field label="New password" htmlFor="new-password" error={fieldErrors.newPassword}>
          <Input
            id="new-password"
            type="password"
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            aria-describedby="password-rules"
          />
        </Field>

        <ul id="password-rules" className="space-y-1 text-xs">
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(newPassword);
            return (
              <li
                key={rule.id}
                className={met ? "flex items-center gap-1.5 text-success" : "flex items-center gap-1.5 text-muted-foreground"}
              >
                {met ? (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <X className="h-3.5 w-3.5" aria-hidden />
                )}
                {rule.label}
              </li>
            );
          })}
        </ul>

        <Field
          label="Confirm new password"
          htmlFor="confirm-password"
          error={fieldErrors.confirmPassword}
        >
          <Input
            id="confirm-password"
            type="password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
          />
        </Field>

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Change password
        </Button>
      </form>
    </section>
  );
}
