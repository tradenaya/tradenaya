"use client"

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { PnlAnalytics } from "@/automation/analytics/types"
import { apiGet, toQuery, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatMoney, formatShortDate, pnlText, signClass } from "./format"

const AXIS_STROKE = "#a89880"
const GRID_STROKE = "rgba(168,152,128,0.15)"

export function PnlChartCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<PnlAnalytics>(
    () => apiGet("/api/analytics/pnl", { ...toQuery(filters), granularity: filters.granularity }),
    [filters.botId, filters.symbol, filters.side, filters.startTime, filters.endTime, filters.granularity],
  )

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>PnL by Period</CardTitle>
            <CardDescription>Realized per {filters.granularity === "weekly" ? "week" : filters.granularity === "monthly" ? "month" : "day"}, cumulative line</CardDescription>
          </div>
          {data && (
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Realized </span>
                <span className={signClass((data as PnlAnalytics).realizedTotal)}>{pnlText((data as PnlAnalytics).realizedTotal)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Unrealized </span>
                <span className={signClass((data as PnlAnalytics).unrealizedTotal)}>{pnlText((data as PnlAnalytics).unrealizedTotal)}</span>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data?.points ?? []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(ms) => formatShortDate(ms)}
                  stroke={AXIS_STROKE}
                  tick={{ fill: AXIS_STROKE, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke={AXIS_STROKE}
                  tick={{ fill: AXIS_STROKE, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                  tickFormatter={(v) => formatMoney(v, 0)}
                />
                <Tooltip
                  formatter={(value, name) => [formatMoney(Number(value)), name === "cumulative" ? "Cumulative" : "Realized"]}
                  labelFormatter={(ms) => formatShortDate(Number(ms))}
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "var(--foreground)" }}
                />
                <Bar dataKey="realized" fill="#c99a58" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
