import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading placeholders shaped like the content they stand in for, so screens
 * keep their layout while data loads instead of showing blank cards.
 */

/** Row of stat tiles (label + value), e.g. wallet balances or summary KPIs. */
export function StatsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-4 md:grid-cols-4", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Table placeholder with a header row and `rows` body rows. */
export function TableSkeleton({ rows = 5, columns = 6, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div className={cn("w-full space-y-2", className)} aria-busy="true" aria-label="Loading">
      <div className="flex gap-3 border-b border-border pb-2">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-3 py-1.5">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-4 flex-1", c === 0 && "max-w-28")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Chart placeholder: axis-free area with a few bars. */
export function ChartSkeleton({ height = 220, className }: { height?: number; className?: string }) {
  const bars = [40, 65, 50, 80, 55, 70, 45, 85, 60, 75];
  return (
    <div className={cn("flex w-full items-end gap-2", className)} style={{ height }} aria-busy="true" aria-label="Loading">
      {bars.map((h, i) => (
        <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

/** Vertical list of rows with a leading avatar/icon dot, e.g. activity feeds. */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Grid of card placeholders, e.g. bot cards or coin cards. */
export function CardGridSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-3/4" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        </div>
      ))}
    </div>
  );
}
