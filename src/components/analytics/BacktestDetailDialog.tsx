"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { BacktestDetail } from "@/automation/analytics/types"
import { apiGet } from "./api"
import { formatDate, formatMoney, formatPercent, formatShortDate, pnlText, signClass } from "./format"

const AXIS_STROKE = "#9aa4b6"
const GRID_STROKE = "rgba(154,164,182,0.15)"

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  QUEUED: { label: "Queued", className: "bg-muted text-muted-foreground" },
  RUNNING: { label: "Running", className: "bg-blue-500/15 text-blue-400" },
  COMPLETED: { label: "Completed", className: "bg-emerald-500/15 text-emerald-400" },
  FAILED: { label: "Failed", className: "bg-red-500/15 text-red-400" },
  CANCELLED: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
}

function Metric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${valueClass ?? "text-foreground"}`}>{value}</p>
    </div>
  )
}

export function BacktestDetailDialog({
  open,
  onOpenChange,
  backtestId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  backtestId: number | null
}) {
  const [data, setData] = useState<BacktestDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = data === null && error === null

  useEffect(() => {
    if (!open || backtestId == null) return
    let cancelled = false
    apiGet<BacktestDetail>(`/api/analytics/backtests/${backtestId}`)
      .then((detail) => {
        if (!cancelled) setData(detail)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load backtest")
      })
    return () => {
      cancelled = true
    }
  }, [open, backtestId])

  const metrics = data?.metrics

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Backtest {data ? `#${data.id}` : ""}</DialogTitle>
          <DialogDescription>
            {data
              ? `${data.symbol} · ${data.timeframe} · ${formatDate(new Date(data.startTime).toISOString(), { year: "numeric", month: "short", day: "2-digit" })} → ${formatDate(new Date(data.endTime).toISOString(), { year: "numeric", month: "short", day: "2-digit" })}`
              : "Loading"}
          </DialogDescription>
        </DialogHeader>

        {loading && !data && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {data && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_BADGE[data.status] && <Badge className={STATUS_BADGE[data.status].className}>{STATUS_BADGE[data.status].label}</Badge>}
              <Badge className="bg-muted text-muted-foreground">{data.executionPolicy ?? "—"} policy</Badge>
              <Badge className="bg-muted text-muted-foreground">{data.slippageApplied ? "Slippage on" : "No slippage"}</Badge>
              {data.botId != null && <Badge className="bg-muted text-muted-foreground">bot #{data.botId}</Badge>}
            </div>

            {data.errorMessage && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{data.errorMessage}</p>}

            {metrics && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric label="Return" value={formatPercent(metrics.totalReturnPct)} valueClass={signClass(metrics.totalPnl)} />
                  <Metric label="Final Balance" value={formatMoney(metrics.finalBalance)} />
                  <Metric label="Total PnL" value={pnlText(metrics.totalPnl)} valueClass={signClass(metrics.totalPnl)} />
                  <Metric label="Trades" value={String(metrics.tradeCount)} />
                  <Metric label="Win Rate" value={formatPercent(metrics.winRate)} />
                  <Metric label="Profit Factor" value={metrics.profitFactor == null ? "∞" : metrics.profitFactor.toFixed(2)} />
                  <Metric label="Max Drawdown" value={`${formatPercent(metrics.maxDrawdownPct)}`} valueClass="text-red-400" />
                  <Metric label="Exposure" value={formatPercent(metrics.exposurePct)} />
                </div>

                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.equityCurve} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="btEquityFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
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
                      <YAxis stroke={AXIS_STROKE} tick={{ fill: AXIS_STROKE, fontSize: 11 }} tickLine={false} axisLine={false} width={70} tickFormatter={(v) => formatMoney(v, 0)} />
                      <Tooltip
                        formatter={(value, name) => [formatMoney(Number(value)), name === "equity" ? "Equity" : name]}
                        labelFormatter={(ms) => formatShortDate(Number(ms))}
                        contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "var(--foreground)" }}
                      />
                      <Area type="monotone" dataKey="equity" stroke="#34d399" strokeWidth={2} fill="url(#btEquityFill)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {data.trades.length > 0 && (
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Side</TableHead>
                          <TableHead className="text-right">Entry</TableHead>
                          <TableHead className="text-right">Exit</TableHead>
                          <TableHead className="text-right">Net PnL</TableHead>
                          <TableHead className="text-right">Return</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.trades.map((trade, index) => (
                          <TableRow key={trade.tradeId}>
                            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                            <TableCell className="text-foreground">{trade.symbol}</TableCell>
                            <TableCell>
                              <Badge className={trade.side === "LONG" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}>
                                {trade.side}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{trade.entryPrice.toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums">{trade.exitPrice.toFixed(2)}</TableCell>
                            <TableCell className={`text-right font-medium tabular-nums ${signClass(trade.netPnl)}`}>{pnlText(trade.netPnl)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatPercent(trade.returnPct)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{trade.exitReason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
