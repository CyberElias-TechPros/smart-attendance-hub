// Recurring-session scheduling panel for the lecturer course view.
// Creates/list/toggles/deletes schedules; the Worker materializes each leg on
// its cron tick (or lazily), so a lecturer sets the week up once and lectures
// start themselves on time.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { schedules, type ScheduleInput } from "@/lib/api";
import type { Schedule } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarClock, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const DAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];

function recurringLabel(s: Schedule): string {
  if (s.recurrence === "daily") return "Daily";
  if (s.recurrence === "weekdays") return "Weekdays";
  const days = (s.daysMask || "")
    .split(",")
    .map((d) => DAYS.find((x) => x.n === Number(d))?.label)
    .filter(Boolean)
    .join(", ");
  return days || "Weekly";
}

function timeLabel(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  const period = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${period}`;
}

export function SchedulePanel({ courseId }: { courseId: string }) {
  const qc = useQueryClient();
  const schedulesQ = useQuery({
    queryKey: ["schedules", courseId],
    queryFn: () => schedules.list(courseId),
  });
  const [open, setOpen] = useState(false);
  const [recurrence, setRecurrence] = useState<ScheduleInput["recurrence"]>("weekdays");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [duration, setDuration] = useState(15);
  const [saving, setSaving] = useState(false);

  const tzOffsetMinutes = useMemo(() => -new Date().getTimezoneOffset(), []);

  const toggleDay = (n: number) =>
    setDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n].sort((a, b) => a - b)));

  const create = async () => {
    if (recurrence === "weekly" || recurrence === "custom") {
      if (days.length === 0) return toast.error("Pick at least one day");
    }
    setSaving(true);
    try {
      await schedules.create({
        courseId,
        durationMinutes: duration,
        recurrence,
        days: recurrence === "weekly" || recurrence === "custom" ? days : undefined,
        minuteOfDay: hour * 60 + minute,
        tzOffsetMinutes,
      });
      toast.success("Recurring schedule created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["schedules", courseId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save schedule");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: Schedule, enabled: boolean) => {
    try {
      await schedules.setEnabled(s.id, enabled);
      qc.invalidateQueries({ queryKey: ["schedules", courseId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const remove = async (s: Schedule) => {
    try {
      await schedules.remove(s.id);
      toast.success("Schedule removed");
      qc.invalidateQueries({ queryKey: ["schedules", courseId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const list = schedulesQ.data ?? [];

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-elegant">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">Recurring lectures</h2>
            <p className="text-xs text-muted-foreground">
              Set the week up once — sessions start themselves, with your venue lock & rotation.
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="mr-1 h-4 w-4" /> Schedule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New recurring schedule</DialogTitle>
            </DialogHeader>
            <div className="mt-4 grid gap-4">
              <div className="space-y-1.5">
                <Label>Repeat</Label>
                <Select
                  value={recurrence}
                  onValueChange={(v) => setRecurrence(v as ScheduleInput["recurrence"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Every day</SelectItem>
                    <SelectItem value="weekdays">Weekdays</SelectItem>
                    <SelectItem value="weekly">Specific days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(recurrence === "weekly" || recurrence === "custom") && (
                <div className="space-y-1.5">
                  <Label>Days</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((d) => (
                      <button
                        key={d.n}
                        type="button"
                        onClick={() => toggleDay(d.n)}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                          days.includes(d.n)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border/70 bg-background hover:border-primary/50"
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Time</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={hour}
                      onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value))))}
                      aria-label="Hour"
                    />
                    <span className="self-center text-muted-foreground">:</span>
                    <Input
                      type="number"
                      min={0}
                      max={59}
                      value={minute}
                      onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
                      aria-label="Minute"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Your local time ({new Date().toLocaleTimeString([], { timeStyle: "short" })}{" "}
                    zone).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Duration (min)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={240}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button onClick={create} disabled={saving}>
                {saving ? "Saving…" : "Create schedule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {list.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          No recurring sessions yet. Schedule your lectures once and they'll start on time.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {list.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                  <RefreshCw className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium">
                    {recurringLabel(s)} · {timeLabel(s.minuteOfDay)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.durationMinutes} min · {s.occurrences} session
                    {s.occurrences === 1 ? "" : "s"} held
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={s.enabled} onCheckedChange={(v) => toggle(s, v)} />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(s)}
                  title="Remove schedule"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
