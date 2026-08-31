import { cn } from "@/lib/utils";
import { Skeleton } from "./ui/skeleton";

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-2xl border border-border/70 bg-card p-5 shadow-elegant", className)}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-10 w-14 rounded-xl" />
      </div>
      <Skeleton className="mt-4 h-2 w-full rounded-full" />
      <div className="mt-2 flex justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

export function StatSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-2xl border border-border/70 bg-card p-5 shadow-elegant", className)}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="mt-3 h-8 w-16" />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elegant">
      <div className="flex gap-4 border-b border-border/60 bg-muted/40 p-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-border/40 p-4 last:border-0">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
