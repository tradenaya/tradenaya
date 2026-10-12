import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CardGridSkeleton, ChartSkeleton, ListSkeleton, StatsSkeleton, TableSkeleton } from "@/components/ui/skeletons";

/**
 * Whole-screen loading placeholders, shaped like each screen's real layout.
 * Shown while a screen opens (route loading.tsx) and on a browser refresh
 * while the session is being checked (AuthHydrator), so the user sees the
 * page's structure right away instead of a blank screen.
 */

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4 px-3 py-5 sm:px-6" aria-busy="true" aria-label="Loading">
      {children}
    </div>
  );
}

/** Page title + subtitle. */
function Heading() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-3.5 w-72 max-w-full" />
    </div>
  );
}

/** A card with a header bar and some body content. */
function Panel({ children, action = false }: { children: ReactNode; action?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
        {action && <Skeleton className="h-8 w-28 rounded-md" />}
      </div>
      <div className="p-4 sm:px-6">{children}</div>
    </div>
  );
}

export function DashboardPageSkeleton() {
  return (
    <Frame>
      <Heading />
      <Panel>
        <StatsSkeleton count={5} className="md:grid-cols-5" />
      </Panel>
      <Panel action>
        <CardGridSkeleton count={4} className="xl:grid-cols-4" />
      </Panel>
      <Panel>
        <StatsSkeleton count={4} />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <CardGridSkeleton count={2} className="xl:grid-cols-2" />
        </Panel>
        <Panel>
          <ListSkeleton rows={3} />
        </Panel>
      </div>
    </Frame>
  );
}

export function BotsPageSkeleton() {
  return (
    <Frame>
      <Heading />
      <Panel action>
        <CardGridSkeleton count={4} className="xl:grid-cols-4" />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <CardGridSkeleton count={2} className="sm:grid-cols-1 xl:grid-cols-1" />
        </div>
        <Panel>
          <ListSkeleton rows={4} />
        </Panel>
      </div>
      <Panel>
        <div className="grid gap-3 lg:grid-cols-2">
          <ListSkeleton rows={5} />
          <ListSkeleton rows={5} />
        </div>
      </Panel>
    </Frame>
  );
}

export function PositionsPageSkeleton() {
  return (
    <Frame>
      <Heading />
      <Panel>
        <TableSkeleton rows={4} columns={9} />
      </Panel>
      <Panel>
        <TableSkeleton rows={4} columns={10} />
      </Panel>
    </Frame>
  );
}

/** One big table with a search / action bar (orders, position history, market). */
export function TablePageSkeleton({ rows = 10, columns = 8 }: { rows?: number; columns?: number }) {
  return (
    <Frame>
      <Heading />
      <Panel action>
        <TableSkeleton rows={rows} columns={columns} />
      </Panel>
    </Frame>
  );
}

export function AnalyticsPageSkeleton() {
  return (
    <Frame>
      <Heading />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-36 rounded-md" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <ChartSkeleton height={256} />
        </Panel>
        <Panel>
          <ChartSkeleton height={256} />
        </Panel>
      </div>
      <Panel>
        <TableSkeleton rows={5} columns={7} />
      </Panel>
    </Frame>
  );
}

export function PortfolioPageSkeleton() {
  return (
    <Frame>
      <Heading />
      <Panel>
        <StatsSkeleton count={4} />
      </Panel>
      <Panel>
        <TableSkeleton rows={6} columns={6} />
      </Panel>
    </Frame>
  );
}

export function TradePageSkeleton() {
  return (
    <div className="space-y-3 px-3 py-4 sm:px-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-xl border border-border bg-card p-4">
          <ChartSkeleton height={420} />
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-9 w-full rounded-md" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md" />
          ))}
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel>
          <ListSkeleton rows={2} />
        </Panel>
        <Panel>
          <ListSkeleton rows={2} />
        </Panel>
      </div>
    </div>
  );
}

/** The skeleton matching the screen at `pathname`. */
export function PageSkeleton({ pathname }: { pathname: string }) {
  const p = pathname.replace(/\/+$/, "");
  if (p.startsWith("/trade/")) return <TradePageSkeleton />;
  if (p === "/dashboard/bots") return <BotsPageSkeleton />;
  if (p === "/dashboard/positions") return <PositionsPageSkeleton />;
  if (p === "/dashboard/analytics") return <AnalyticsPageSkeleton />;
  if (p === "/dashboard/portfolio") return <PortfolioPageSkeleton />;
  if (p === "/dashboard/market") return <TablePageSkeleton rows={12} columns={5} />;
  if (p === "/dashboard/orders" || p === "/dashboard/position-history") return <TablePageSkeleton />;
  return <DashboardPageSkeleton />;
}

/** Top bar + the screen's skeleton: what a refresh shows before the session is confirmed. */
export function AppShellSkeleton({ pathname }: { pathname: string }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#070605", color: "#eee5d8" }}>
      <div className="flex h-16 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
      </div>
      <PageSkeleton pathname={pathname} />
    </div>
  );
}
