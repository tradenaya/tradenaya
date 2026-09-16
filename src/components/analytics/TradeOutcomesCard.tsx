"use client"

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { OutcomeAnalytics, TradeOutcome } from "@/automation/analytics/types"
import { apiGet, toQuery, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatPercent, pnlText, signClass } from "./format"

const STATUS_META: Record<TradeOutcome, { label: string; color: string }> = {
  WIN: { label: "Won", color: "#34d399" },
  LOSS: { label: "Lost", color: "#f87171" },
  BREAKEVEN: { label: "Hold / Breakeven", color: "#60a5fa" },
  CANCELLED: { label: "Cancelled", color: "#94a3b8" },
}

const STATUS_ORDER: TradeOutcome[] = ["WIN", "LOSS", "BREAKEVEN", "CANCELLED"]

export function TradeOutcomesCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<OutcomeAnalytics>(
    () => apiGet("/api/analytics/outcomes", toQuery(filters)),
    [filters.botId, filters.symbol, filters.side, filters.startTime, filters.endTime],
  )

  const pieData = (data?.statuses ?? [])
    .filter((s) => s.count > 0)
    .map((s) => ({ name: s.status, value: s.count }))

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Trade Outcomes</CardTitle>
        <CardDescription>Every closed trade classified by result</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {loading && !data ? (
          <Skeleton className="h-56 w-full rounded-lg" />
        ) : (
          <>
            <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
              <span className="font-semibold text-foreground">Win Rate {formatPercent(data?.winRate)}</span>
              <span className="text-muted-foreground">
                {" "}· based on {data?.resolvedTrades ?? 0} resolved trade{data?.resolvedTrades === 1 ? "" : "s"} (wins vs losses only; cancelled & held excluded)
              </span>
            </div>

            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-44 w-full sm:w-1/2">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2} isAnimationActive={false}>
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={STATUS_META[entry.name as TradeOutcome]?.color ?? "#64748b"} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "var(--foreground)" }}
                        formatter={(value, name) => [`${value} trades`, STATUS_META[name as TradeOutcome]?.label ?? String(name)]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
                )}
              </div>

              <ul className="w-full space-y-1.5 text-sm sm:w-1/2">
                {STATUS_ORDER.map((status) => {
                  const stat = data?.statuses.find((s) => s.status === status)
                  if (!stat) return null
                  const meta = STATUS_META[status]
                  return (
                    <li key={status} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                        {meta.label}
                        <span className="text-muted-foreground">
                          {stat.count} · {formatPercent(stat.rate)}
                        </span>
                      </span>
                      <span className={signClass(stat.pnl)}>{pnlText(stat.pnl)}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}