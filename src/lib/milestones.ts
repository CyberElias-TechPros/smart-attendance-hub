export type MilestoneTone = "success" | "warn" | "info" | "celebrate";

export interface Milestone {
  id: string;
  tone: MilestoneTone;
  title: string;
  body: string;
  emoji: string;
}

export interface MilestoneCourse {
  id: string;
  code: string;
  title: string;
  percentage: number;
  totalSessions: number;
  attendedSessions: number;
}

export interface MilestoneSession {
  id: string;
  attended: boolean;
  timestamp?: number | null;
}

export interface MilestoneInput {
  course: MilestoneCourse;
  sessions: MilestoneSession[];
  history: Array<{ timestamp: number; courseId: string }>;
  threshold: number;
}

const DAY = 24 * 60 * 60 * 1000;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function currentStreak(history: Array<{ timestamp: number }>): number {
  if (history.length === 0) return 0;
  const days = new Set(history.map((h) => dayKey(h.timestamp)));
  let streak = 0;
  const cursor = new Date();
  // allow today or yesterday to anchor the streak
  if (!days.has(dayKey(cursor.getTime()))) {
    cursor.setTime(cursor.getTime() - DAY);
    if (!days.has(dayKey(cursor.getTime()))) return 0;
  }
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setTime(cursor.getTime() - DAY);
  }
  return streak;
}

// Pure, side-effect free. Returns the set of milestones earned for one course.
export function computeMilestones(input: MilestoneInput): Milestone[] {
  const { course, sessions, history, threshold } = input;
  const out: Milestone[] = [];

  const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const firstEver = sortedHistory[0];

  // 1. First-ever sign-in (global, anchored to the course of that record)
  if (sortedHistory.length >= 1 && firstEver.courseId === course.id && course.attendedSessions === 1) {
    out.push({
      id: "first-ever",
      tone: "celebrate",
      title: "First sign-in!",
      body: `You checked into ${course.code}. Great start to your attendance streak.`,
      emoji: "🎉",
    });
  }

  // 2. First sign-in for this course
  if (course.attendedSessions === 1) {
    out.push({
      id: `course-${course.id}-first`,
      tone: "info",
      title: `First ${course.code} check-in`,
      body: `You attended your first ${course.title} session.`,
      emoji: "✅",
    });
  }

  // 3. Perfect week (attended every session in the last 7 days for this course)
  const weekAgo = Date.now() - 7 * DAY;
  const weekSessions = sessions.filter((s) => s.attended && s.timestamp && s.timestamp >= weekAgo);
  const weekAll = sessions.filter((s) => s.timestamp && s.timestamp >= weekAgo);
  if (weekSessions.length >= 2 && weekAll.length >= 2 && weekSessions.length === weekAll.length) {
    out.push({
      id: `course-${course.id}-week`,
      tone: "success",
      title: "Perfect week!",
      body: `You attended every ${course.code} session this week.`,
      emoji: "🔥",
    });
  }

  // 4. 100% course attendance
  if (course.totalSessions > 0 && course.percentage === 100) {
    out.push({
      id: `course-${course.id}-100`,
      tone: "celebrate",
      title: "Perfect attendance",
      body: `You've attended all ${course.totalSessions} ${course.code} sessions.`,
      emoji: "🏆",
    });
  }

  // 5. Streaks (global, computed per course but de-duped by id)
  const streak = currentStreak(history);
  const streakTargets = [30, 14, 7, 3];
  for (const t of streakTargets) {
    if (streak >= t) {
      out.push({
        id: `streak-${t}`,
        tone: "celebrate",
        title: `${t}-day streak!`,
        body: `You've checked in for ${t} days in a row. Keep it going!`,
        emoji: "⚡",
      });
      break;
    }
  }

  // 6. At-risk warning
  if (course.totalSessions > 0 && course.percentage < threshold) {
    out.push({
      id: `course-${course.id}-atrisk`,
      tone: "warn",
      title: "At risk",
      body: `Your ${course.code} attendance is ${course.percentage}% (below ${threshold}%).`,
      emoji: "⚠️",
    });
  }

  // 7. Comeback: currently meeting threshold after missing at least one session
  const lastSession = [...sessions].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
  if (
    course.totalSessions > 0 &&
    course.percentage >= threshold &&
    course.attendedSessions < course.totalSessions &&
    lastSession &&
    lastSession.attended
  ) {
    out.push({
      id: `course-${course.id}-comeback`,
      tone: "success",
      title: "Comeback!",
      body: `Back on track in ${course.code} at ${course.percentage}%.`,
      emoji: "💪",
    });
  }

  return out;
}
