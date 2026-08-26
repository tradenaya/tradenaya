"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { EquityAnalytics } from "@/automation/analytics/types"
import { apiGet, toQuery, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatMoney, formatPercent, formatShortDate, signClass } from "./format"

const AXIS_STROKE = "#9aa4b6"
const GRID_STROKE = "rgba(154,164,182,0.15)"

export function EquityCurveCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<EquityAnalytics>(
    () => apiGet("/api/analytics/equity", toQuery(filters)),
    [filters.botId, filters.symbol, filters.side, filters.startTime, filters.endTime],
  )

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Equity Curve</CardTitle>
            <CardDescription>Account value incl. realized and unrealized PnL</CardDescription>
          </div>
          {data && (
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Equity </span>
                <span className={signClass((data as EquityAnalytics).currentEquity)}>
                  {formatMoney((data as EquityAnalytics).currentEquity)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Max DD </span>
                <span className={formatPercent((data as EquityAnalytics).maxDrawdownPct)}>
                  {formatPercent((data as EquityAnalytics).maxDrawdownPct)}
                </span>
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
              <AreaChart data={data?.points ?? []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#b8860b" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#b8860b" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
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
                  domain={["auto", "auto"]}
                  width={70}
                  tickFormatter={(v) => formatMoney(v, 0)}
                />
                <Tooltip
                  formatter={(value) => [formatMoney(Number(value)), "Equity"]}
                  labelFormatter={(ms) => formatShortDate(Number(ms))}
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "var(--foreground)" }}
                />
                <Area type="monotone" dataKey="equity" stroke="#b8860b" strokeWidth={2} fill="url(#equityFill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
