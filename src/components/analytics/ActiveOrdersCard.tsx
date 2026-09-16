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
import type { ActiveOrderAnalytics } from "@/automation/analytics/types"
import { apiGet, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatDate, formatPrice } from "./format"
import { sideBadgeClass, sideLabel } from "@/components/trading/terms"

const KIND_BADGE: Record<string, { label: string; className: string }> = {
  ENTRY: { label: "Entry", className: "bg-amber-500/15 text-amber-400" },
  TAKE_PROFIT: { label: "Take Profit", className: "bg-emerald-500/15 text-emerald-400" },
  STOP_LOSS: { label: "Stop Loss", className: "bg-red-500/15 text-red-400" },
}

export function ActiveOrdersCard({ filters }: { filters: AnalyticsFilterState }) {
  const { data, loading } = useAsyncData<ActiveOrderAnalytics[]>(
    () => apiGet("/api/analytics/orders"),
    [filters.botId],
    { pollMs: 15_000 },
  )

  const orders = data ?? []

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Active Orders</CardTitle>
        <CardDescription>Working entries and protective exits</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : orders.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No active orders.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="hidden sm:table-cell">Kind</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Trigger</TableHead>
                <TableHead className="text-right hidden md:table-cell">Qty</TableHead>
                <TableHead className="hidden lg:table-cell">Status</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => {
                const badge = KIND_BADGE[o.kind] ?? { label: o.kind, className: "bg-muted text-muted-foreground" }
                return (
                  <TableRow key={o.executionId}>
                    <TableCell>
                      <div className="font-medium text-foreground">{o.symbol}</div>
                      <div className="text-xs text-muted-foreground">{o.botName}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={sideBadgeClass(o.side)}>{sideLabel(o.side)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPrice(o.price)}</TableCell>
                    <TableCell className="text-right tabular-nums hidden sm:table-cell">{o.triggerPrice != null ? formatPrice(o.triggerPrice) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums hidden md:table-cell">{o.quantity?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">{o.status ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground hidden lg:table-cell">{formatDate(o.createdAt)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
