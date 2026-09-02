import { useEffect } from "react";
import { toast } from "sonner";
import {
  computeMilestones,
  type Milestone,
  type MilestoneCourse,
  type MilestoneSession,
} from "@/lib/milestones";

const STORAGE_KEY = "slams:milestones:seen";

function readSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function markSeen(ids: string[]) {
  if (typeof window === "undefined") return;
  const seen = readSeen();
  ids.forEach((id) => seen.add(id));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore quota errors */
  }
}

export function MilestoneToaster({
  courses,
  sessionsByCourse,
  history,
  threshold,
}: {
  courses: MilestoneCourse[];
  sessionsByCourse: Record<string, MilestoneSession[]>;
  history: Array<{ timestamp: number; courseId: string }>;
  threshold: number;
}) {
  useEffect(() => {
    const seen = readSeen();
    const all: Milestone[] = [];
    for (const course of courses) {
      const sessions = sessionsByCourse[course.id] ?? [];
      all.push(...computeMilestones({ course, sessions, history, threshold }));
    }
    // de-dupe by id (e.g. streaks computed per course)
    const byId = new Map<string, Milestone>();
    for (const m of all) byId.set(m.id, m);

    const toFire = [...byId.values()].filter((m) => !seen.has(m.id));
    if (toFire.length === 0) return;
    markSeen(toFire.map((m) => m.id));

    // small stagger so they don't all stack at once
    toFire.forEach((m, i) => {
      window.setTimeout(() => {
        toast(m.title, {
          description: m.body,
          icon: m.emoji,
          duration: 5000,
          className: "slams-toast",
          style: {
            borderLeft: `3px solid var(--${m.tone === "warn" ? "warning" : m.tone === "success" ? "success" : "primary"})`,
          },
        });
      }, i * 250);
    });
  }, [courses, sessionsByCourse, history, threshold]);

  return null;
}
