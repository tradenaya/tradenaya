"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { ActivityFeed } from "@/automation/analytics/types"
import { apiGet, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatDate } from "./format"

function SeverityBadge({ severity }: { severity: "INFO" | "WARNING" | "ERROR" }) {
  if (severity === "ERROR") return <Badge className="bg-red-500/15 text-red-400">Error</Badge>
  if (severity === "WARNING") return <Badge className="bg-amber-500/15 text-amber-400">Warn</Badge>
  return <Badge className="bg-muted text-muted-foreground">Info</Badge>
}

export function ActivityCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<ActivityFeed>(
    () => apiGet("/api/analytics/activity", { limit: 80 }),
    [filters.botId],
    { pollMs: 20_000 },
  )

  const items = data?.items ?? []

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Activity Feed</CardTitle>
        <CardDescription>Scheduler, position and execution events</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border border-border bg-background/40 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                    <SeverityBadge severity={item.severity} />
                    <span>{item.type}</span>
                    {item.symbol && <span className="text-foreground">{item.symbol}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(item.timestamp)}</span>
                </div>
                <p className="mt-1 text-sm text-foreground">{item.message}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
