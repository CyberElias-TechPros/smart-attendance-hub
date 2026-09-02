import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/AppShell";
import { QueryBoundary } from "@/components/QueryBoundary";
import { RouteTransition } from "@/components/RouteTransition";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SiteSettings } from "../../shared/schemas";
import { ApiClientError, api, errorMessage } from "@/lib/api";
import { Field } from "./admin.students";

export const Route = createFileRoute("/admin/settings")({ component: BrandingPage });

function BrandingPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["settings", "public"],
    queryFn: () => api.publicSettings(),
  });

  const [form, setForm] = useState<SiteSettings | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Seed the editable copy once the server value arrives, without clobbering
  // edits in progress on subsequent refetches.
  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: SiteSettings) =>
      api.updateSiteSettings({
        institutionName: values.institutionName,
        atRiskThreshold: values.atRiskThreshold,
        marqueeItems: values.marqueeItems.filter((item) => item.trim()),
        testimonials: values.testimonials.filter((t) => t.name && t.text),
        demoAccountsEnabled: values.demoAccountsEnabled,
        demoEmailDomain: values.demoEmailDomain,
        showFakeStats: values.showFakeStats,
        primaryColor: values.primaryColor || null,
        contactEmail: values.contactEmail || null,
      }),
    onSuccess: (saved) => {
      toast.success("Branding saved");
      setFieldErrors({});
      setForm(saved);
      queryClient.invalidateQueries({ queryKey: ["settings", "public"] });
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.fields) setFieldErrors(error.fields);
      toast.error(errorMessage(error));
    },
  });

  return (
    <RouteTransition>
      <PageHeader
        title="Branding"
        subtitle="Customise how the public landing page and sign-in screen present your institution."
      />

      <QueryBoundary
        isLoading={query.isPending || !form}
        error={query.error}
        data={form ?? undefined}
        onRetry={() => query.refetch()}
        loadingLabel="Loading settings"
      >
        {(settings) => (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setFieldErrors({});
              saveMutation.mutate(settings);
            }}
            noValidate
            className="max-w-3xl space-y-6"
          >
            <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
              <h2 className="font-display text-lg font-semibold">Identity</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label="Institution name"
                  htmlFor="institution"
                  error={fieldErrors.institutionName}
                >
                  <Input
                    id="institution"
                    required
                    value={settings.institutionName}
                    onChange={(e) => setForm({ ...settings, institutionName: e.target.value })}
                  />
                </Field>
                <Field
                  label="Contact email"
                  htmlFor="contact"
                  error={fieldErrors.contactEmail}
                  hint="Shown to users who need help signing in."
                >
                  <Input
                    id="contact"
                    type="email"
                    value={settings.contactEmail ?? ""}
                    onChange={(e) => setForm({ ...settings, contactEmail: e.target.value })}
                    placeholder="support@university.edu"
                  />
                </Field>
              </div>
            </section>

            <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
              <h2 className="font-display text-lg font-semibold">Attendance policy</h2>
              <div className="mt-4 max-w-xs">
                <Field
                  label="At-risk threshold (%)"
                  htmlFor="threshold"
                  error={fieldErrors.atRiskThreshold}
                  hint="Students below this attendance percentage are flagged across the app."
                >
                  <Input
                    id="threshold"
                    type="number"
                    min={0}
                    max={100}
                    required
                    value={settings.atRiskThreshold}
                    onChange={(e) =>
                      setForm({ ...settings, atRiskThreshold: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
            </section>

            <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
              <h2 className="font-display text-lg font-semibold">Landing page</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Highlights scroll across the landing page. Leave empty to hide the strip.
              </p>
              <div className="mt-4 space-y-2">
                {settings.marqueeItems.map((item, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={item}
                      aria-label={`Highlight ${index + 1}`}
                      onChange={(e) => {
                        const next = [...settings.marqueeItems];
                        next[index] = e.target.value;
                        setForm({ ...settings, marqueeItems: next });
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove highlight ${index + 1}`}
                      onClick={() =>
                        setForm({
                          ...settings,
                          marqueeItems: settings.marqueeItems.filter((_, i) => i !== index),
                        })
                      }
                      className="shrink-0 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({ ...settings, marqueeItems: [...settings.marqueeItems, ""] })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Add highlight
                </Button>
              </div>

              <h3 className="mt-6 font-medium">Testimonials</h3>
              <div className="mt-3 space-y-4">
                {settings.testimonials.map((testimonial, index) => (
                  <div key={index} className="rounded-xl border border-border/60 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        value={testimonial.name}
                        aria-label={`Testimonial ${index + 1} name`}
                        placeholder="Name"
                        onChange={(e) => {
                          const next = [...settings.testimonials];
                          next[index] = { ...testimonial, name: e.target.value };
                          setForm({ ...settings, testimonials: next });
                        }}
                      />
                      <Input
                        value={testimonial.role}
                        aria-label={`Testimonial ${index + 1} role`}
                        placeholder="Role"
                        onChange={(e) => {
                          const next = [...settings.testimonials];
                          next[index] = { ...testimonial, role: e.target.value };
                          setForm({ ...settings, testimonials: next });
                        }}
                      />
                    </div>
                    <Textarea
                      className="mt-3"
                      rows={2}
                      value={testimonial.text}
                      aria-label={`Testimonial ${index + 1} quote`}
                      placeholder="What they said…"
                      onChange={(e) => {
                        const next = [...settings.testimonials];
                        next[index] = { ...testimonial, text: e.target.value };
                        setForm({ ...settings, testimonials: next });
                      }}
                    />
                    <div className="mt-2 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() =>
                          setForm({
                            ...settings,
                            testimonials: settings.testimonials.filter((_, i) => i !== index),
                          })
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Remove
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({
                      ...settings,
                      testimonials: [...settings.testimonials, { name: "", role: "", text: "" }],
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" /> Add testimonial
                </Button>
              </div>
            </section>

            <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
              <h2 className="font-display text-lg font-semibold">Demonstration mode</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                When enabled, the sign-in page suggests demo email addresses. Passwords are never
                displayed — share them privately.
              </p>
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-border/60 p-4">
                  <div>
                    <div className="text-sm font-medium">Show demo accounts</div>
                    <div className="text-xs text-muted-foreground">
                      Turn this off for production deployments.
                    </div>
                  </div>
                  <Switch
                    checked={settings.demoAccountsEnabled}
                    onCheckedChange={(checked) =>
                      setForm({ ...settings, demoAccountsEnabled: checked })
                    }
                    aria-label="Show demo accounts"
                  />
                </div>
                {settings.demoAccountsEnabled && (
                  <Field
                    label="Demo email domain"
                    htmlFor="demo-domain"
                    error={fieldErrors.demoEmailDomain}
                  >
                    <Input
                      id="demo-domain"
                      value={settings.demoEmailDomain}
                      onChange={(e) => setForm({ ...settings, demoEmailDomain: e.target.value })}
                      placeholder="slams.edu"
                    />
                  </Field>
                )}
              </div>
            </section>

            <div className="flex justify-end">
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save changes
              </Button>
            </div>
          </form>
        )}
      </QueryBoundary>
    </RouteTransition>
  );
}
