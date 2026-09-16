"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { BacktestSummary } from "@/automation/analytics/types"
import { apiGet, apiSend, type AnalyticsFilterState } from "./api"
import { BacktestDetailDialog } from "./BacktestDetailDialog"
import { RunBacktestDialog } from "./RunBacktestDialog"
import { useAsyncData } from "./use-data"
import { formatDate, formatMoney, formatPercent, pnlText, signClass } from "./format"

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  QUEUED: { label: "Queued", className: "bg-muted text-muted-foreground" },
  RUNNING: { label: "Running", className: "bg-blue-500/15 text-blue-400" },
  COMPLETED: { label: "Completed", className: "bg-emerald-500/15 text-emerald-400" },
  FAILED: { label: "Failed", className: "bg-red-500/15 text-red-400" },
  CANCELLED: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
}

export function BacktestsCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading, refresh } = useAsyncData<BacktestSummary[]>(
    () => apiGet("/api/analytics/backtests", { limit: 50 }),
    [filters.botId],
    { pollMs: 10_000 },
  )

  const [runOpen, setRunOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const backtests = data ?? []

  const remove = async (id: number) => {
    if (!window.confirm(`Delete backtest #${id}?`)) return
    setDeletingId(id)
    try {
      await apiSend(`/api/analytics/backtests/${id}`, { method: "DELETE" })
      refresh()
    } catch (e) {
      console.error("Failed to delete backtest", e)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Backtests</CardTitle>
            <CardDescription>Historical simulations of the automation pipeline</CardDescription>
          </div>
          <Button size="sm" onClick={() => setRunOpen(true)}>
            Run Backtest
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data ? (
          <Skeleton className="h-56 w-full rounded-lg" />
        ) : backtests.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <p className="text-sm text-muted-foreground">No backtests yet.</p>
            <Button variant="outline" size="sm" onClick={() => setRunOpen(true)}>
              Run your first backtest
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14 hidden sm:table-cell">#</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="hidden sm:table-cell">TF</TableHead>
                  <TableHead className="hidden lg:table-cell">Window</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Capital</TableHead>
                  <TableHead className="text-right">Return</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">PnL</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Win Rate</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">Max DD</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Trades</TableHead>
                  <TableHead className="text-right hidden xl:table-cell">Policy</TableHead>
                  <TableHead className="hidden lg:table-cell">Ran</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {backtests.map((b) => {
                  const badge = STATUS_BADGE[b.status] ?? { label: b.status, className: "bg-muted text-muted-foreground" }
                  return (
                    <TableRow key={b.id} className="cursor-pointer" onClick={() => { setDetailId(b.id); setDetailOpen(true) }}>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">#{b.id}</TableCell>
                      <TableCell className="font-medium text-foreground">{b.symbol}</TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">{b.timeframe}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">
                        {formatDate(new Date(b.startTime).toISOString(), { year: "numeric", month: "short", day: "2-digit" })} →{" "}
                        {formatDate(new Date(b.endTime).toISOString(), { year: "numeric", month: "short", day: "2-digit" })}
                      </TableCell>
                      <TableCell>
                        <Badge className={badge.className}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums hidden md:table-cell">{formatMoney(b.initialCapital)}</TableCell>
                      <TableCell className={`text-right font-medium tabular-nums ${signClass(b.totalReturnPct)}`}>{formatPercent(b.totalReturnPct)}</TableCell>
                      <TableCell className={`text-right tabular-nums hidden sm:table-cell ${signClass(b.totalPnl)}`}>{pnlText(b.totalPnl)}</TableCell>
                      <TableCell className="text-right tabular-nums hidden sm:table-cell">{formatPercent(b.winRate)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground hidden lg:table-cell">{formatPercent(b.maxDrawdownPct)}</TableCell>
                      <TableCell className="text-right tabular-nums hidden md:table-cell">{b.tradeCount ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground hidden xl:table-cell">{b.executionPolicy ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground hidden lg:table-cell">{formatDate(b.createdAt)}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                          disabled={deletingId === b.id}
                          onClick={() => remove(b.id)}
                        >
                          {deletingId === b.id ? "…" : "Delete"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <RunBacktestDialog open={runOpen} onOpenChange={setRunOpen} onCreated={refresh} />
      <BacktestDetailDialog key={detailId} open={detailOpen} onOpenChange={setDetailOpen} backtestId={detailId} />
    </Card>
  )
}
