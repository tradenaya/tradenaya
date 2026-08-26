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
import type { OpenPositionAnalytics } from "@/automation/analytics/types"
import { apiGet, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatDate, formatMoney, formatPercent, formatPrice, pnlText, signClass } from "./format"

function ProtectionBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    PROTECTED: { label: "Protected", className: "bg-emerald-500/15 text-emerald-400" },
    TRAILING: { label: "Trailing", className: "bg-amber-500/15 text-amber-400" },
    UNPROTECTED: { label: "Unprotected", className: "bg-red-500/15 text-red-400" },
    PENDING: { label: "Pending", className: "bg-muted text-muted-foreground" },
  }
  const entry = map[status] ?? { label: status, className: "bg-muted text-muted-foreground" }
  return <Badge className={entry.className}>{entry.label}</Badge>
}

export function OpenPositionsCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<OpenPositionAnalytics[]>(
    () => apiGet("/api/analytics/positions"),
    [filters.botId],
    { pollMs: 15_000 },
  )

  const positions = data ?? []

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Open Positions</CardTitle>
        <CardDescription>Live unrealized PnL by position</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : positions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No open positions.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Mark</TableHead>
                <TableHead className="text-right">Unrealized</TableHead>
                <TableHead className="text-right">Stop Loss</TableHead>
                <TableHead className="text-right">Take Profit</TableHead>
                <TableHead>Protection</TableHead>
                <TableHead>Opened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((p) => (
                <TableRow key={p.positionId}>
                  <TableCell>
                    <div className="font-medium text-foreground">{p.symbol}</div>
                    <div className="text-xs text-muted-foreground">{p.botName}</div>
                  </TableCell>
                  <TableCell>
                    <Badge className={p.side === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}>
                      {p.side === "BUY" ? "Long" : "Short"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.quantity != null ? `${p.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "—"}
                    <div className="text-xs text-muted-foreground">{p.leverage != null ? `${p.leverage}x` : ""}{p.margin != null ? ` · ${formatMoney(p.margin)}` : ""}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPrice(p.entryPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPrice(p.currentPrice)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${signClass(p.unrealizedPnl)}`}>{pnlText(p.unrealizedPnl)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPrice(p.stopLoss)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPrice(p.takeProfit)}</TableCell>
                  <TableCell>
                    <ProtectionBadge status={p.protectionStatus} />
                    {p.trailingEnabled && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        Trailing {formatPercent(p.trailingDistancePct)}%
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(p.openTime)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
