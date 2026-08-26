"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { ActiveOrderAnalytics, BotSummary, OpenPositionAnalytics } from "@/automation/analytics/types"
import { apiGet, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"

function Chip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="bg-card">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold text-foreground">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export function BotStatusCards({ filters }: { filters: AnalyticsFilterState }) {
  const bots = useAsyncData<BotSummary[]>(() => apiGet("/api/analytics/bots"), [filters.botId], { pollMs: 15_000 })
  const positions = useAsyncData<OpenPositionAnalytics[]>(
    () => apiGet("/api/analytics/positions", { botId: filters.botId ?? null }),
    [filters.botId],
    { pollMs: 15_000 },
  )
  const orders = useAsyncData<ActiveOrderAnalytics[]>(
    () => apiGet("/api/analytics/orders", { botId: filters.botId ?? null }),
    [filters.botId],
    { pollMs: 15_000 },
  )

  const botList = bots.data ?? []
  const running = botList.filter((b) => b.status === "RUNNING").length
  const enabled = botList.filter((b) => b.enabled).length
  const recovering = botList.filter((b) => b.recoveryState === "RECOVERING").length
  const errored = botList.filter((b) => b.status === "ERROR").length

  if (bots.loading && !bots.data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Chip label="Bots" value={`${running}/${botList.length}`} sub={`${enabled} enabled`} />
      <Chip label="Open Positions" value={String(positions.data?.length ?? 0)} sub="Across all bots" />
      <Chip label="Active Orders" value={String(orders.data?.length ?? 0)} sub="Pending entries & exits" />
      <Chip label="Needs Attention" value={String(recovering + errored)} sub={`${errored} errored · ${recovering} recovering`} />
    </div>
  )
}
