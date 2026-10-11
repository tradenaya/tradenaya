"use client"

import { useMemo, useState } from "react"
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import { ErrorState } from "@/components/ui/error-state"
import { ChartSkeleton } from "@/components/ui/skeletons"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { STRATEGIES } from "@/automation/strategy/catalog"
import type { StrategyComparison, StrategyComparisonRow } from "@/automation/analytics/types"
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider"
import { cn } from "@/lib/utils"
import { apiGet } from "./api"
import { useAsyncData } from "./use-data"
import { formatDuration, formatMoney, formatPercent, formatShortDate, pnlText, signClass } from "./format"

const AXIS_STROKE = "#9aa4b6"
const GRID_STROKE = "rgba(154,164,182,0.15)"
/** Fixed colour per strategy (catalog order), validated for the dark surface. Colour follows the strategy, never its rank. */
const STRATEGY_COLORS = ["#b0823f", "#3d8fd1", "#2fa37a"]
const colorOf = (id: string) => STRATEGY_COLORS[Math.max(0, STRATEGIES.findIndex((s) => s.id === id)) % STRATEGY_COLORS.length]

const DAY = 86_400_000
const PRESETS = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "all", label: "All time", days: null },
] as const

/** Start of a preset window (module-level so it is never evaluated during render). */
function daysAgo(days: number): number {
  return Date.now() - days * DAY
}

const toEpoch = (value: string | null, endOfDay: boolean) =>
  value ? new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`).getTime() : null
const fromEpoch = (ms: number | null) => (ms == null ? "" : new Date(ms).toISOString().slice(0, 10))

/** One time-indexed dataset: each strategy's cumulative PnL carried forward between its trades. */
function mergeCurves(rows: StrategyComparisonRow[]) {
  const times = [...new Set(rows.flatMap((r) => r.curve.map((p) => p.timestamp)))].sort((a, b) => a - b)
  const cursor = new Map(rows.map((r) => [r.strategy, { i: 0, value: 0 }]))
  return times.map((timestamp) => {
    const point: Record<string, number> = { timestamp }
    for (const row of rows) {
      const c = cursor.get(row.strategy)!
      while (c.i < row.curve.length && row.curve[c.i].timestamp <= timestamp) c.value = row.curve[c.i++].cumulativePnl
      point[row.strategy] = c.value
    }
    return point
  })
}

export function StrategyComparisonCard() {
  useDisplayCurrency() // re-render when the display currency / INR rate changes
  const [selected, setSelected] = useState<string[]>(STRATEGIES.map((s) => s.id))
  const [preset, setPreset] = useState<string>("30d")
  const [range, setRange] = useState<{ startTime: number | null; endTime: number | null }>(() => ({ startTime: daysAgo(30), endTime: null }))

  const { data, loading, errorInfo, refresh } = useAsyncData<StrategyComparison>(
    () => apiGet("/api/analytics/compare", { strategies: selected.join(","), startTime: range.startTime, endTime: range.endTime }),
    [selected.join(","), range.startTime, range.endTime],
  )

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => selected.includes(r.strategy)), [data, selected])
  const chartData = useMemo(() => mergeCurves(rows), [rows])
  const anyTrades = rows.some((r) => r.trades > 0)

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? (cur.length > 1 ? cur.filter((s) => s !== id) : cur) : [...cur, id]))

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    setPreset(id)
    setRange({ startTime: p.days == null ? null : daysAgo(p.days), endTime: null })
  }

  // Best value per metric, so the leader is marked by text (not colour alone).
  const best = (pick: (r: StrategyComparisonRow) => number | null, higher = true) => {
    const vals = rows.filter((r) => r.trades > 0).map((r) => ({ id: r.strategy, v: pick(r) })).filter((x) => x.v != null) as { id: string; v: number }[]
    if (vals.length < 2) return null
    return vals.reduce((a, b) => (higher ? (b.v > a.v ? b : a) : b.v < a.v ? b : a)).id
  }
  const leaders = {
    netPnl: best((r) => r.netPnl),
    winRate: best((r) => r.winRate),
    profitFactor: best((r) => r.profitFactor),
    maxDrawdown: best((r) => r.maxDrawdown, false),
  }
  const mark = (metric: keyof typeof leaders, id: string) => (leaders[metric] === id ? <span className="ml-1 text-[10px] font-semibold uppercase text-emerald-400">best</span> : null)

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Strategy comparison</CardTitle>
        <CardDescription>Live closed trades of each strategy over the same period, after fees</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Controls: one row above the chart */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Strategies</span>
            <div className="flex flex-wrap gap-1.5">
              {STRATEGIES.map((s) => {
                const on = selected.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(s.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      on ? "border-border bg-muted text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: on ? colorOf(s.id) : "transparent", boxShadow: `inset 0 0 0 1px ${colorOf(s.id)}` }} />
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Period</span>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={preset === p.id}
                  onClick={() => applyPreset(p.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    preset === p.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">From</span>
            <DatePicker
              value={fromEpoch(range.startTime)}
              maxDate={fromEpoch(range.endTime)}
              placeholder="From date"
              onChange={(value) => {
                setPreset("custom")
                const startTime = toEpoch(value, false)
                setRange((r) => ({ startTime, endTime: r.endTime != null && startTime != null && startTime > r.endTime ? toEpoch(value, true) : r.endTime }))
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">To</span>
            <DatePicker
              value={fromEpoch(range.endTime)}
              minDate={fromEpoch(range.startTime)}
              placeholder="Today"
              onChange={(value) => {
                setPreset("custom")
                const endTime = toEpoch(value, true)
                setRange((r) => ({ startTime: r.startTime != null && endTime != null && r.startTime > endTime ? toEpoch(value, false) : r.startTime, endTime }))
              }}
            />
          </div>
        </div>

        {errorInfo != null ? (
          <ErrorState error={errorInfo} title="Couldn't compare strategies" onRetry={refresh} />
        ) : loading && !data ? (
          <ChartSkeleton />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategy</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Win rate</TableHead>
                    <TableHead className="text-right">Net PnL</TableHead>
                    <TableHead className="text-right">Avg / trade</TableHead>
                    <TableHead className="text-right">Avg win · loss</TableHead>
                    <TableHead className="text-right">Profit factor</TableHead>
                    <TableHead className="text-right">Max drawdown</TableHead>
                    <TableHead className="text-right">Avg hold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.strategy}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(r.strategy) }} />
                          <div>
                            <div className="font-medium text-foreground">{r.label}</div>
                            <div className="text-[11px] text-muted-foreground">{r.bots} bot{r.bots === 1 ? "" : "s"}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.trades}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.trades ? formatPercent(r.winRate) : "—"}{mark("winRate", r.strategy)}</TableCell>
                      <TableCell className={cn("text-right font-medium tabular-nums", signClass(r.netPnl))}>{r.trades ? pnlText(r.netPnl) : "—"}{mark("netPnl", r.strategy)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", signClass(r.averageTradePnl))}>{r.trades ? pnlText(r.averageTradePnl) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.trades ? `${formatMoney(r.averageWin)} · ${formatMoney(Math.abs(r.averageLoss))}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.trades ? (r.profitFactor == null ? "∞" : r.profitFactor.toFixed(2)) : "—"}
                        {mark("profitFactor", r.strategy)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.trades ? formatMoney(r.maxDrawdown) : "—"}{mark("maxDrawdown", r.strategy)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{r.trades ? formatDuration(r.averageDurationMs) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {anyTrades ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                    <XAxis
                      dataKey="timestamp"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(ms) => formatShortDate(Number(ms))}
                      stroke={AXIS_STROKE}
                      tick={{ fill: AXIS_STROKE, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis stroke={AXIS_STROKE} tick={{ fill: AXIS_STROKE, fontSize: 11 }} tickLine={false} axisLine={false} width={72} tickFormatter={(v) => formatMoney(Number(v), 0)} />
                    <Tooltip
                      formatter={(value, name) => [pnlText(Number(value)), STRATEGIES.find((s) => s.id === name)?.label ?? String(name)]}
                      labelFormatter={(ms) => formatShortDate(Number(ms))}
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "var(--foreground)" }}
                      itemStyle={{ color: "var(--foreground)" }}
                    />
                    <Legend formatter={(value) => <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{STRATEGIES.find((s) => s.id === value)?.label ?? value}</span>} />
                    {rows.map((r) => (
                      <Line key={r.strategy} type="stepAfter" dataKey={r.strategy} stroke={colorOf(r.strategy)} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                No closed trades for these strategies in this period yet. Run a bot on each strategy (or run backtests) to compare them.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Cumulative PnL in the chart is the running total of closed-trade net PnL. Strategies with few trades are not yet a reliable comparison.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
