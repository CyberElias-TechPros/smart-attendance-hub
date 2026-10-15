import { useMemo } from "react";
import { Filter, RotateCcw, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AttendanceStatus, Department, Faculty, ReportFilters, User } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface FilterBarProps {
  filters: ReportFilters;
  onChange: (patch: Partial<ReportFilters>) => void;
  onReset: () => void;
  faculties?: Faculty[];
  departments?: Department[];
  lecturers?: User[];
  period?: { semesterName?: string; finalized?: boolean };
  /** Count of rows matching the current filters, shown as live feedback. */
  resultCount?: number;
  className?: string;
}

const ALL = "__all__";

/**
 * The eight attendance filters from the brief (§6): academic session/semester,
 * faculty, department, course, lecturer, date range, and attendance status —
 * plus free-text search over course code, title, department and lecturer.
 *
 * The component is controlled and stateless: the parent keeps the filter object
 * in the URL, which is what makes a filtered view shareable and guarantees the
 * screen and an export can never disagree about what "current filters" means.
 */
export function FilterBar({
  filters,
  onChange,
  onReset,
  faculties = [],
  departments = [],
  lecturers = [],
  period,
  resultCount,
  className,
}: FilterBarProps) {
  const activeChips = useMemo(() => {
    const chips: Array<{ key: keyof ReportFilters; label: string }> = [];
    if (filters.search) chips.push({ key: "search", label: `Search: “${filters.search}”` });
    if (filters.facultyId) {
      chips.push({
        key: "facultyId",
        label: faculties.find((f) => f.id === filters.facultyId)?.name ?? "Faculty",
      });
    }
    if (filters.departmentId) {
      chips.push({
        key: "departmentId",
        label: departments.find((d) => d.id === filters.departmentId)?.name ?? "Department",
      });
    }
    if (filters.lecturerId) {
      chips.push({
        key: "lecturerId",
        label: lecturers.find((l) => l.id === filters.lecturerId)?.name ?? "Lecturer",
      });
    }
    if (filters.status) chips.push({ key: "status", label: `Status: ${filters.status}` });
    if (filters.from || filters.to) {
      const from = filters.from ? new Date(filters.from).toLocaleDateString() : "start";
      const to = filters.to ? new Date(filters.to).toLocaleDateString() : "now";
      chips.push({ key: "from", label: `${from} → ${to}` });
    }
    return chips;
  }, [filters, faculties, departments, lecturers]);

  const clearChip = (key: keyof ReportFilters) => {
    if (key === "from") return onChange({ from: undefined, to: undefined });
    onChange({ [key]: undefined } as Partial<ReportFilters>);
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-card/60 p-3 shadow-elegant sm:p-4",
        className,
      )}
      role="search"
      aria-label="Attendance filters"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search ?? ""}
            onChange={(e) => onChange({ search: e.target.value || undefined, page: 1 })}
            placeholder="Search course code, title, department or lecturer…"
            className="pl-9"
            aria-label="Search courses"
          />
        </div>

        <FilterSelect
          label="Faculty"
          value={filters.facultyId}
          onChange={(v) => onChange({ facultyId: v, departmentId: undefined, page: 1 })}
          options={faculties.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` }))}
        />
        <FilterSelect
          label="Department"
          value={filters.departmentId}
          onChange={(v) => onChange({ departmentId: v, page: 1 })}
          options={departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))}
        />
        <FilterSelect
          label="Lecturer"
          value={filters.lecturerId}
          onChange={(v) => onChange({ lecturerId: v, page: 1 })}
          options={lecturers.map((l) => ({ value: l.id, label: l.name }))}
        />
        <FilterSelect
          label="Attendance status"
          value={filters.status}
          onChange={(v) => onChange({ status: v as AttendanceStatus | undefined, page: 1 })}
          options={[
            { value: "present", label: "Present" },
            { value: "late", label: "Late" },
            { value: "excused", label: "Excused" },
            { value: "absent", label: "Absent" },
          ]}
        />

        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="filter-from">
            From
          </label>
          <Input
            id="filter-from"
            type="date"
            className="w-[9.5rem]"
            value={filters.from ? new Date(filters.from).toISOString().slice(0, 10) : ""}
            onChange={(e) =>
              onChange({
                from: e.target.value ? new Date(`${e.target.value}T00:00:00`).getTime() : undefined,
                page: 1,
              })
            }
          />
          <label className="text-xs text-muted-foreground" htmlFor="filter-to">
            To
          </label>
          <Input
            id="filter-to"
            type="date"
            className="w-[9.5rem]"
            value={filters.to ? new Date(filters.to).toISOString().slice(0, 10) : ""}
            onChange={(e) =>
              onChange({
                to: e.target.value
                  ? new Date(`${e.target.value}T23:59:59`).getTime() + 999
                  : undefined,
                page: 1,
              })
            }
          />
        </div>

        <Button variant="ghost" size="sm" onClick={onReset} className="gap-2">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Filter className="h-3.5 w-3.5" />
        {activeChips.length === 0 ? (
          <span>
            No filters — showing every course
            {period?.semesterName ? ` in ${period.semesterName}` : ""}.
          </span>
        ) : (
          activeChips.map((chip) => (
            <button
              key={String(chip.key)}
              onClick={() => clearChip(chip.key)}
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 text-foreground/80 transition hover:border-destructive/40 hover:text-destructive"
              title="Remove this filter"
            >
              {chip.label}
              <X className="h-3 w-3" />
            </button>
          ))
        )}
        {typeof resultCount === "number" && (
          <span className="ml-auto font-medium text-foreground/70">
            {resultCount} {resultCount === 1 ? "course" : "courses"} match
          </span>
        )}
        {period?.finalized && (
          <span className="rounded-full bg-muted px-2 py-0.5">
            This period is finalised — figures are frozen
          </span>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className="w-[12.5rem]" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
