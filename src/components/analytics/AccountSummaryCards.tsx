"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { AccountSummary } from "@/automation/analytics/types"
import { apiGet, toQuery, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatMoney, formatPercent, pnlClass, pnlText } from "./format"

function StatCard({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string
  value: string
  sub?: string
  valueClass?: string
}) {
  return (
    <Card className="bg-card">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`text-xl font-semibold ${valueClass ?? "text-foreground"}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export function AccountSummaryCards({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<AccountSummary>(
    () => apiGet("/api/analytics/summary", toQuery(filters)),
    [filters.botId, filters.symbol, filters.side, filters.startTime, filters.endTime],
  )

  if (loading && !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    )
  }

  const s = data as AccountSummary | null
  if (!s) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total PnL" value={pnlText(s.totalPnl)} sub={`${formatMoney(s.realizedPnl)} realized`} valueClass={pnlClass(s.totalPnl)} />
      <StatCard label="Unrealized" value={pnlText(s.unrealizedPnl)} sub={`${s.openPositions} open position${s.openPositions === 1 ? "" : "s"}`} valueClass={pnlClass(s.unrealizedPnl)} />
      <StatCard label="Today" value={pnlText(s.todayPnl)} sub="Realized today" valueClass={pnlClass(s.todayPnl)} />
      <StatCard label="This Week" value={pnlText(s.weeklyPnl)} sub="Realized in last 7 days" valueClass={pnlClass(s.weeklyPnl)} />
      <StatCard label="This Month" value={pnlText(s.monthlyPnl)} sub="Realized this month" valueClass={pnlClass(s.monthlyPnl)} />
      <StatCard
        label="Win Rate"
        value={formatPercent(s.winRate)}
        sub={`${s.winningTrades}W / ${s.losingTrades}L of ${s.totalTrades} trades`}
      />
      <StatCard
        label="Profit Factor"
        value={s.profitFactor == null ? "∞" : s.profitFactor.toFixed(2)}
        sub={`${formatMoney(s.totalFees)} total fees`}
      />
      <StatCard
        label="Max Drawdown"
        value={`${formatMoney(s.maxDrawdown)} (${formatPercent(s.maxDrawdownPct)})`}
        sub={`${s.activeBots}/${s.totalBots} bots active`}
        valueClass={s.maxDrawdown > 0 ? "text-red-400" : "text-foreground"}
      />
    </div>
  )
}
