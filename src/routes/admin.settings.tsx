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
    atRiskThreshold: 70,
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
      atRiskThreshold: data.atRiskThreshold ?? 70,
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
      <PageHeader title="Branding" subtitle="Institution name, thresholds, and demo settings." />
      <form onSubmit={save} className="mt-6 grid gap-6 lg:grid-cols-3">
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
