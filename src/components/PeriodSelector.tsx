import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { academics } from "@/lib/api";
import { academicPeriodQO } from "@/lib/queries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The academic session + semester selector from the brief's top bar (§2B).
 *
 * Changing the period is an institution-wide action (it re-scopes the whole
 * dashboard and every default filter), so only administrators can write it —
 * everyone else sees the active period as read-only context, which is what
 * stops two people reporting on two different semesters by accident.
 */
export function PeriodSelector({ canEdit = false }: { canEdit?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(academicPeriodQO);

  const setCurrent = useMutation({
    mutationFn: (semesterId: string) => academics.setCurrentSemester(semesterId),
    onSuccess: () => {
      toast.success("Reporting period updated");
      qc.invalidateQueries({ queryKey: ["academics"] });
      // Everything period-scoped must re-read: tables, dashboard, exports.
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not switch period"),
  });

  const semester = data?.semester ?? null;
  const session = data?.academicSession ?? null;
  const label = semester
    ? `${session ? `${session.name} · ` : ""}${semester.name}`
    : (session?.name ?? "No academic period");

  const body = (
    <span className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/70 px-2.5 py-1.5 text-xs font-medium shadow-elegant">
      <CalendarRange className="h-3.5 w-3.5 text-primary" />
      <span className="hidden max-w-[16rem] truncate sm:inline">{label}</span>
      {semester?.finalizedAt ? (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          Finalised
        </span>
      ) : null}
      {isLoading || setCurrent.isPending ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      ) : canEdit ? (
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      ) : null}
    </span>
  );

  if (!canEdit) {
    return <span title="The institution's active reporting period">{body}</span>;
  }

  const semesters = data?.semesters ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="rounded-lg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Select the reporting period"
        >
          {body}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs uppercase tracking-widest text-muted-foreground">
          {session ? session.name : "Academic period"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {semesters.length === 0 && (
          <DropdownMenuItem disabled>No semesters defined yet</DropdownMenuItem>
        )}
        {semesters.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onSelect={() => !s.isCurrent && setCurrent.mutate(s.id)}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex flex-col">
              <span className={cn("text-sm", s.isCurrent && "font-semibold")}>{s.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {s.startsOn
                  ? `${new Date(s.startsOn).toLocaleDateString()} – ${
                      s.endsOn ? new Date(s.endsOn).toLocaleDateString() : "open"
                    }`
                  : "No dates set"}
                {s.finalizedAt ? " · finalised" : ""}
              </span>
            </span>
            {s.isCurrent && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-[11px] text-muted-foreground">
          Every table, filter and export follows this period.
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
