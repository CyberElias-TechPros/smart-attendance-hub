import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { settings } from "@/lib/api";
import { siteSettingsQO } from "@/lib/queries";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Save, Plus, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { RouteTransition } from "@/components/RouteTransition";

export const Route = createFileRoute("/admin/settings")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(siteSettingsQO);
  },
  component: AdminSettingsPage,
});

type Testimonial = { name: string; role: string; text: string };

function AdminSettingsPage() {
  const { data } = useSuspenseQuery(siteSettingsQO);
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    institutionName: "",
    atRiskThreshold: 75,
    timezone: "Africa/Lagos",
    logoUrl: "",
    reportFooterNote: "",
    lateCountsAsAttended: true,
    excusedCountsAsAbsent: true,
    demoAccountsEnabled: true,
    demoPassword: "",
    demoEmailDomain: "",
    showFakeStats: true,
    marqueeItems: "",
    primaryColor: "",
    contactEmail: "",
    testimonials: [] as Testimonial[],
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      institutionName: data.institutionName ?? "SLAMS",
      atRiskThreshold: data.atRiskThreshold ?? 75,
      timezone: data.timezone ?? "Africa/Lagos",
      logoUrl: data.logoUrl ?? "",
      reportFooterNote: data.reportFooterNote ?? "",
      lateCountsAsAttended: data.lateCountsAsAttended ?? true,
      excusedCountsAsAbsent: data.excusedCountsAsAbsent ?? true,
      demoAccountsEnabled: data.demoAccountsEnabled ?? true,
      demoPassword: data.demoPassword ?? "",
      demoEmailDomain: data.demoEmailDomain ?? "slams.edu",
      showFakeStats: data.showFakeStats ?? true,
      marqueeItems: (data.marqueeItems ?? []).join("\n"),
      primaryColor: data.primaryColor ?? "",
      contactEmail: data.contactEmail ?? "",
      testimonials: [...(data.testimonials ?? [])],
    });
  }, [data]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await settings.save({
        institutionName: form.institutionName,
        atRiskThreshold: form.atRiskThreshold,
        timezone: form.timezone,
        logoUrl: form.logoUrl.trim() || null,
        reportFooterNote: form.reportFooterNote.trim() || null,
        lateCountsAsAttended: form.lateCountsAsAttended,
        excusedCountsAsAbsent: form.excusedCountsAsAbsent,
        demoAccountsEnabled: form.demoAccountsEnabled,
        demoPassword: form.demoPassword,
        demoEmailDomain: form.demoEmailDomain,
        showFakeStats: form.showFakeStats,
        marqueeItems: form.marqueeItems
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        testimonials: form.testimonials.filter((t) => t.name || t.text),
        primaryColor: form.primaryColor || null,
        contactEmail: form.contactEmail || null,
      });
      qc.invalidateQueries({ queryKey: ["siteSettings"] });
      qc.invalidateQueries({ queryKey: ["publicSettings"] });
      toast.success("Branding updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <RouteTransition>
      <PageHeader
        title="Settings"
        subtitle="Institution identity, reporting period controls and attendance policy."
      />
      <form onSubmit={save} className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Reporting identity: everything here feeds the printed/PDF report. */}
        <Card className="lg:col-span-3 space-y-4 rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
          <div>
            <h2 className="font-display text-lg font-semibold">Reporting &amp; exports</h2>
            <p className="text-xs text-muted-foreground">
              The logo appears in the printed report header; the note appears in the footer of every
              generated report.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Institution logo URL</Label>
              <Input
                value={form.logoUrl}
                onChange={(e) => set({ logoUrl: e.target.value })}
                placeholder="https://…/logo.png"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Report footer note</Label>
              <Input
                value={form.reportFooterNote}
                onChange={(e) => set({ reportFooterNote: e.target.value })}
                placeholder="Verified by the Examinations Office"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Institution timezone</Label>
              <Input
                value={form.timezone}
                onChange={(e) => set({ timezone: e.target.value })}
                placeholder="Africa/Lagos"
              />
              <p className="text-[11px] text-muted-foreground">
                “Today”, “this week” and every date boundary are computed in this timezone.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            {[
              {
                key: "lateCountsAsAttended" as const,
                label: "Count late arrivals as attended",
                hint: "Affects every percentage in the system.",
              },
              {
                key: "excusedCountsAsAbsent" as const,
                label: "Excused absences stay in the denominator",
                hint: "Off = an approved excuse also removes the expectation.",
              },
            ].map((flag) => (
              <label key={flag.key} className="flex items-start gap-3 text-sm">
                <Switch checked={form[flag.key]} onCheckedChange={(v) => set({ [flag.key]: v })} />
                <span>
                  {flag.label}
                  <span className="block text-[11px] text-muted-foreground">{flag.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {form.logoUrl && (
            <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
              <img src={form.logoUrl} alt="Logo preview" className="h-10 w-10 object-contain" />
              <span className="text-xs text-muted-foreground">
                Preview — this is how the report header will look.
              </span>
            </div>
          )}
        </Card>
        <Card className="lg:col-span-2 space-y-4 rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Institution name</Label>
              <Input
                value={form.institutionName}
                onChange={(e) => set({ institutionName: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>At-risk threshold (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.atRiskThreshold}
                onChange={(e) => set({ atRiskThreshold: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Demo email domain</Label>
              <Input
                value={form.demoEmailDomain}
                onChange={(e) => set({ demoEmailDomain: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Primary color (optional)</Label>
              <Input
                value={form.primaryColor}
                onChange={(e) => set({ primaryColor: e.target.value })}
                placeholder="oklch(...) or hex"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contact email</Label>
              <Input
                type="email"
                value={form.contactEmail}
                onChange={(e) => set({ contactEmail: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Demo password</Label>
              <Input
                value={form.demoPassword}
                onChange={(e) => set({ demoPassword: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Marquee items (one per line)</Label>
            <Textarea
              value={form.marqueeItems}
              onChange={(e) => set({ marqueeItems: e.target.value })}
              rows={4}
            />
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Demo accounts</div>
                <div className="text-xs text-muted-foreground">
                  Show demo login buttons on landing and login.
                </div>
              </div>
              <Switch
                checked={form.demoAccountsEnabled}
                onCheckedChange={(v) => set({ demoAccountsEnabled: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Show fake stats</div>
                <div className="text-xs text-muted-foreground">
                  Display the marketing stats on the landing hero.
                </div>
              </div>
              <Switch
                checked={form.showFakeStats}
                onCheckedChange={(v) => set({ showFakeStats: v })}
              />
            </div>
          </Card>

          <Card className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Testimonials</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  set({ testimonials: [...form.testimonials, { name: "", role: "", text: "" }] })
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            </div>
            <div className="mt-3 space-y-3">
              {form.testimonials.map((t, i) => (
                <div key={i} className="rounded-xl border border-border/60 p-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <Input
                      placeholder="Name"
                      value={t.name}
                      onChange={(e) => {
                        const next = [...form.testimonials];
                        next[i] = { ...next[i], name: e.target.value };
                        set({ testimonials: next });
                      }}
                    />
                    <Input
                      placeholder="Role"
                      value={t.role}
                      onChange={(e) => {
                        const next = [...form.testimonials];
                        next[i] = { ...next[i], role: e.target.value };
                        set({ testimonials: next });
                      }}
                    />
                  </div>
                  <Textarea
                    placeholder="Testimonial text"
                    value={t.text}
                    onChange={(e) => {
                      const next = [...form.testimonials];
                      next[i] = { ...next[i], text: e.target.value };
                      set({ testimonials: next });
                    }}
                    rows={2}
                    className="mt-2"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-destructive"
                    onClick={() =>
                      set({ testimonials: form.testimonials.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> Remove
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Button type="submit" disabled={saving}>
            <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save branding"}
          </Button>
        </div>
      </form>
    </RouteTransition>
  );
}
