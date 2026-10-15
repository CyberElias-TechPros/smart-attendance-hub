import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronRight, Layers, Pencil, Tags, Users } from "lucide-react";

import { PageHeader, StatCard, HealthBadge } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { RouteTransition } from "@/components/RouteTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { courses as coursesApi } from "@/lib/api";
import { weightedPercentage } from "@/lib/attendance-math";
import { coursesReportQO } from "@/lib/queries";
import { useSiteSettings } from "@/lib/useSiteSettings";
import type { CourseReportRow } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/courses/categories")({
  component: CourseCategoriesPage,
});

const UNCATEGORISED = "Uncategorised";

/**
 * Course Categories (brief §2 sidebar).
 *
 * There is no separate categories table: a course carries a free-text
 * `category`, which is exactly how administrators actually use it ("Core",
 * "Elective", "Service"). This page groups the catalogue by that field and
 * reports real attendance per group, using the same report the All Courses
 * table uses — so a category total is the sum of its courses' opportunities,
 * never a mean of course percentages.
 */
function CourseCategoriesPage() {
  const qc = useQueryClient();
  const { data: settings } = useSiteSettings();
  const reportQ = useQuery(coursesReportQO({ pageSize: 500 }));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const threshold = settings?.atRiskThreshold ?? 75;

  const rows = useMemo(() => reportQ.data?.rows ?? [], [reportQ.data]);

  const groups = useMemo(() => {
    const map = new Map<string, CourseReportRow[]>();
    for (const row of rows) {
      const key = row.category?.trim() || UNCATEGORISED;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([name, courses]) => {
        const rate = weightedPercentage(
          courses.map((c) => ({ attended: c.attended, expected: c.expected })),
          1,
        );
        return {
          name,
          courses,
          students: courses.reduce((a, c) => a + c.enrolled, 0),
          held: courses.reduce((a, c) => a + c.classesHeld, 0),
          attended: courses.reduce((a, c) => a + c.attended, 0),
          expected: courses.reduce((a, c) => a + c.expected, 0),
          rate,
          atRisk: courses.filter((c) => (c.rate ?? 100) < threshold).length,
        };
      })
      .sort((a, b) => b.courses.length - a.courses.length || a.name.localeCompare(b.name));
  }, [rows, threshold]);

  const renameCategory = useMutation({
    // Renaming a category rewrites the field on each member course — the API is
    // per-course, so the loop is honest about what an administrator is asking
    // for, and a failure leaves the remaining courses untouched.
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      const members = rows.filter((r) => (r.category?.trim() || UNCATEGORISED) === from);
      for (const course of members) {
        await coursesApi.update(course.id, {
          code: course.code,
          title: course.title,
          departmentId: course.departmentId ?? "",
          level: course.level,
          units: course.units,
          category: to.trim() || undefined,
        });
      }
      return members.length;
    },
    onSuccess: (count) => {
      toast.success(`Updated ${count} course${count === 1 ? "" : "s"}`);
      setRenaming(null);
      void qc.invalidateQueries({ queryKey: ["courses"] });
      void qc.invalidateQueries({ queryKey: ["reports", "courses"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <RouteTransition>
      <PageHeader
        breadcrumb={
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/admin/courses" className="transition hover:text-foreground">
              All Courses
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span>Categories</span>
          </div>
        }
        title="Course Categories"
        subtitle="Group the catalogue into Core, Elective, Service or institution-specific categories — attendance rolls up per group."
        actions={
          <Button variant="outline" asChild>
            <Link to="/admin/courses/manage">Manage courses</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Categories" value={groups.length} icon={Tags} />
        <StatCard
          label="Courses categorised"
          value={rows.filter((r) => r.category).length}
          icon={Layers}
        />
        <StatCard
          label="Uncategorised"
          value={rows.filter((r) => !r.category).length}
          icon={Layers}
          hint="Assign a category from Manage courses"
        />
        <StatCard
          label="Students on rosters"
          value={rows.reduce((a, r) => a + r.enrolled, 0)}
          icon={Users}
        />
      </div>

      {reportQ.isLoading && (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {reportQ.isError && (
        <p className="mt-6 text-sm text-destructive">
          Could not load the catalogue.{" "}
          {reportQ.error instanceof Error ? reportQ.error.message : ""}
        </p>
      )}

      {reportQ.data && groups.length === 0 && (
        <EmptyState
          className="mt-6"
          icon={<Tags className="h-7 w-7" />}
          title="No courses yet"
          description="Create a course first; categories are assigned per course."
          action={
            <Button asChild>
              <Link to="/admin/courses/manage">Add a course</Link>
            </Button>
          }
        />
      )}

      <div className="mt-6 space-y-4">
        {groups.map((group) => (
          <Card key={group.name}>
            <CardHeader className="flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base">{group.name}</CardTitle>
                <Badge variant="secondary">
                  {group.courses.length} course{group.courses.length === 1 ? "" : "s"}
                </Badge>
                <Badge variant="outline">{group.students} students</Badge>
                {group.atRisk > 0 && (
                  <Badge variant="outline" className="text-destructive">
                    {group.atRisk} below target
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3">
                <HealthBadge
                  health={group.rate === null ? null : group.rate >= threshold ? "good" : "at-risk"}
                  rate={group.rate}
                  threshold={threshold}
                />
                {renaming === group.name ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="h-8 w-40"
                      aria-label="New category name"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      disabled={renameCategory.isPending}
                      onClick={() => renameCategory.mutate({ from: group.name, to: draft })}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRenaming(group.name);
                      setDraft(group.name === UNCATEGORISED ? "" : group.name);
                    }}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Rename
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.courses.map((course) => (
                <Link
                  key={course.id}
                  to="/admin/courses/$courseId"
                  params={{ courseId: course.id }}
                  className="flex items-center justify-between rounded-xl border border-border/70 bg-card/60 px-4 py-3 transition hover:border-primary/40 hover:shadow-elegant"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-semibold">{course.code}</div>
                    <div className="truncate text-sm">{course.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {course.enrolled} students · {course.classesHeld} lectures
                    </div>
                  </div>
                  <HealthBadge health={course.health} rate={course.rate} threshold={threshold} />
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </RouteTransition>
  );
}
