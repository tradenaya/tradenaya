"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { TradeStatistics } from "@/automation/analytics/types"
import { apiGet, toQuery, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatDuration, formatMoney, formatPercent, pnlClass, pnlText } from "./format"

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${valueClass ?? "text-foreground"}`}>{value}</p>
    </div>
  )
}

export function TradeStatsCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<TradeStatistics>(
    () => apiGet("/api/analytics/statistics", toQuery(filters)),
    [filters.botId, filters.symbol, filters.side, filters.startTime, filters.endTime],
  )

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Trade Statistics</CardTitle>
        <CardDescription>Distribution of closed trades</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data ? (
          <Skeleton className="h-56 w-full rounded-lg" />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="Trades" value={String(data?.totalTrades ?? 0)} />
            <Stat label="Long / Short" value={`${data?.longTrades ?? 0} / ${data?.shortTrades ?? 0}`} />
            <Stat label="Win Rate" value={formatPercent(data?.winRate)} />
            <Stat label="Wins" value={String(data?.winningTrades ?? 0)} />
            <Stat label="Losses" value={String(data?.losingTrades ?? 0)} />
            <Stat label="Gross Profit" value={formatMoney(data?.grossProfit)} valueClass={pnlClass(data?.grossProfit)} />
            <Stat label="Gross Loss" value={formatMoney(data?.grossLoss)} valueClass={pnlClass(-(data?.grossLoss ?? 0))} />
            <Stat label="Profit Factor" value={data?.profitFactor == null ? "∞" : data.profitFactor.toFixed(2)} />
            <Stat label="Avg Trade" value={pnlText(data?.averageTradePnl)} valueClass={pnlClass(data?.averageTradePnl)} />
            <Stat label="Avg Win" value={formatMoney(data?.averageProfit)} valueClass={pnlClass(data?.averageProfit)} />
            <Stat label="Avg Loss" value={formatMoney(data?.averageLoss)} valueClass={pnlClass(data?.averageLoss)} />
            <Stat label="Largest Win" value={formatMoney(data?.largestWin)} valueClass={pnlClass(data?.largestWin)} />
            <Stat label="Largest Loss" value={formatMoney(data?.largestLoss)} valueClass={pnlClass(data?.largestLoss)} />
            <Stat label="Avg Duration" value={formatDuration(data?.averageTradeDurationMs)} />
            <Stat label="Expectancy" value={pnlText(data?.expectancy)} valueClass={pnlClass(data?.expectancy)} />
            <Stat label="Fees Paid" value={formatMoney(data?.totalFees)} />
            <Stat label="Consecutive W" value={String(data?.maxConsecutiveWins ?? 0)} />
            <Stat label="Consecutive L" value={String(data?.maxConsecutiveLosses ?? 0)} />
            <Stat label="Breakeven" value={String(data?.breakevenTrades ?? 0)} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
