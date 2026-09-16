"use client"

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
import type { StrategyPerformance } from "@/automation/analytics/types"
import { apiGet, toQuery, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatPercent, pnlText, signClass } from "./format"

export function StrategyPerformanceCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<StrategyPerformance[]>(
    () => apiGet("/api/analytics/strategies", toQuery(filters)),
    [filters.botId, filters.symbol, filters.side, filters.startTime, filters.endTime],
  )

  const strategies = data ?? []

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Strategy Performance</CardTitle>
        <CardDescription>PnL and drawdown by strategy</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : strategies.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No data</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Bots</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Trades</TableHead>
                <TableHead className="text-right">Win Rate</TableHead>
                <TableHead className="text-right hidden md:table-cell">Profit Factor</TableHead>
                <TableHead className="text-right hidden md:table-cell">Max DD</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Avg Trade</TableHead>
                <TableHead className="text-right">PnL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {strategies.map((s) => (
                <TableRow key={s.strategy}>
                  <TableCell className="font-medium text-foreground">{s.strategy}</TableCell>
                  <TableCell className="text-right tabular-nums hidden sm:table-cell">{s.bots}</TableCell>
                  <TableCell className="text-right tabular-nums hidden sm:table-cell">{s.trades}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(s.winRate)}</TableCell>
                  <TableCell className="text-right tabular-nums hidden md:table-cell">{s.profitFactor == null ? "∞" : s.profitFactor.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground hidden md:table-cell">{formatPercent(s.maxDrawdownPct)}</TableCell>
                  <TableCell className={`text-right tabular-nums hidden sm:table-cell ${signClass(s.averageTrade)}`}>{pnlText(s.averageTrade)}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${signClass(s.pnl)}`}>{pnlText(s.pnl)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
