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
import type { SymbolPerformance } from "@/automation/analytics/types"
import { apiGet, toQuery, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatMoney, formatPercent, pnlText, signClass } from "./format"

export function SymbolPerformanceCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<SymbolPerformance[]>(
    () => apiGet("/api/analytics/symbols", toQuery(filters)),
    [filters.botId, filters.symbol, filters.side, filters.startTime, filters.endTime],
  )

  const symbols = data ?? []

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Symbol Performance</CardTitle>
        <CardDescription>PnL breakdown by trading pair</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : symbols.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No data</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Long / Short</TableHead>
                <TableHead className="text-right">Win Rate</TableHead>
                <TableHead className="text-right">Avg PnL</TableHead>
                <TableHead className="text-right">PnL</TableHead>
                <TableHead className="text-right">Fees</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {symbols.map((s) => (
                <TableRow key={s.symbol}>
                  <TableCell className="font-medium text-foreground">{s.symbol}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.trades}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.longTrades} / {s.shortTrades}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(s.winRate)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${signClass(s.averagePnl)}`}>{pnlText(s.averagePnl)}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${signClass(s.pnl)}`}>{pnlText(s.pnl)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(s.fees)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
