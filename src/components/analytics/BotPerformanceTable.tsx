"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { BotSummary } from "@/automation/analytics/types"
import { apiGet, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatDate, formatMoney, formatPercent, pnlText, signClass } from "./format"

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    RUNNING: { label: "Running", className: "bg-emerald-500/15 text-emerald-400" },
    PAUSED: { label: "Paused", className: "bg-amber-500/15 text-amber-400" },
    STOPPED: { label: "Stopped", className: "bg-muted text-muted-foreground" },
    ERROR: { label: "Error", className: "bg-red-500/15 text-red-400" },
    RECOVERING: { label: "Recovering", className: "bg-orange-500/15 text-orange-400" },
    IDLE: { label: "Idle", className: "bg-muted text-muted-foreground" },
  }
  const entry = map[status] ?? { label: status, className: "bg-muted text-muted-foreground" }
  return <Badge className={entry.className}>{entry.label}</Badge>
}

export function BotPerformanceTable({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<BotSummary[]>(
    () => apiGet("/api/analytics/bots"),
    [filters.botId],
    { pollMs: 15_000 },
  )

  const bots = data ?? []

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Bots</CardTitle>
        <CardDescription>Live status and per-bot performance</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : bots.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No bots configured yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bot</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Capital</TableHead>
                <TableHead className="text-right">Position PnL</TableHead>
                <TableHead className="text-right">Today</TableHead>
                <TableHead className="text-right">Total PnL</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Win Rate</TableHead>
                <TableHead>Last Trade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bots.map((bot) => (
                <TableRow key={bot.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{bot.name}</div>
                    <div className="text-xs text-muted-foreground">
                      #{bot.id} · {bot.leverage}x · {bot.capitalMode}
                    </div>
                    {bot.lastError && <div className="mt-0.5 max-w-[220px] truncate text-xs text-red-400">{bot.lastError}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={bot.status} />
                      {!bot.enabled && <span className="text-[11px] text-muted-foreground">disabled</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(bot.capital)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${signClass(bot.currentPnl)}`}>{pnlText(bot.currentPnl)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${signClass(bot.todayPnl)}`}>{pnlText(bot.todayPnl)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${signClass(bot.totalPnl)}`}>{pnlText(bot.totalPnl)}</TableCell>
                  <TableCell className="text-right tabular-nums">{bot.tradeCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(bot.winRate)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {bot.lastTrade ? (
                      <span>
                        {bot.lastTrade.exitReason} · {formatDate(bot.lastTrade.exitTime, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    ) : bot.lastActivity ? (
                      formatDate(bot.lastActivity.timestamp)
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
