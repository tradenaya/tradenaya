"use client"

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { ExitAnalytics } from "@/automation/analytics/types"
import { apiGet, toQuery, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatMoney, formatPercent, pnlText, signClass } from "./format"

const COLORS: Record<string, string> = {
  TAKE_PROFIT: "#34d399",
  STOP_LOSS: "#f87171",
  TRAILING_STOP: "#fbbf24",
  MANUAL_CLOSE: "#60a5fa",
  EXCHANGE_CLOSE: "#c084fc",
  END_OF_BACKTEST: "#94a3b8",
  OTHER: "#64748b",
}

export function ExitReasonCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<ExitAnalytics>(
    () => apiGet("/api/analytics/exits", toQuery(filters)),
    [filters.botId, filters.symbol, filters.side, filters.startTime, filters.endTime],
  )

  const pieData = data?.reasons
    .filter((r) => r.count > 0)
    .map((r) => ({ name: r.reason, value: r.count })) ?? []

  const tpSl = data?.tpSl

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Exit Reasons</CardTitle>
        <CardDescription>How closed trades were exited</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {loading && !data ? (
          <Skeleton className="h-56 w-full rounded-lg" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-[11px] uppercase text-muted-foreground">Take Profit</p>
                <p className="text-sm font-semibold text-emerald-400">{tpSl?.tpHits ?? 0} ({formatPercent(tpSl?.tpPct)})</p>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-[11px] uppercase text-muted-foreground">Stop Loss</p>
                <p className="text-sm font-semibold text-red-400">{tpSl?.slHits ?? 0} ({formatPercent(tpSl?.slPct)})</p>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-[11px] uppercase text-muted-foreground">Trailing</p>
                <p className="text-sm font-semibold text-amber-400">{tpSl?.trailingHits ?? 0} ({formatPercent(tpSl?.trailingPct)})</p>
              </div>
            </div>

            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-44 w-full sm:w-1/2">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2} isAnimationActive={false}>
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={COLORS[entry.name] ?? "#64748b"} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "var(--foreground)" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
                )}
              </div>

              <ul className="w-full space-y-1.5 text-sm sm:w-1/2">
                {data?.reasons.map((r) => (
                  <li key={r.reason} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[r.reason] ?? "#64748b" }} />
                      {r.reason}
                      <span className="text-muted-foreground">({r.count})</span>
                    </span>
                    <span className={signClass(r.pnl)}>{pnlText(r.pnl)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {tpSl && tpSl.trailing.trailingClosedTrades > 0 && (
              <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">Trailing Stop Performance</p>
                <p className="mt-1 text-muted-foreground">
                  {tpSl.trailing.trailingMovements} trailing movements · avg MFE {formatPercent(tpSl.trailing.averageMfePct, 2)} ·
                  avg {formatMoney(tpSl.trailing.averagePnl)} per trailing close · profit protected {formatMoney(tpSl.trailing.profitProtected)}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
