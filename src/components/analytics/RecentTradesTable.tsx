"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ClosedTradeSummary, Paged } from "@/automation/analytics/types"
import { apiGet, toQuery, type AnalyticsFilterState } from "./api"
import { useAsyncData } from "./use-data"
import { formatDate, formatMoney, formatPrice, pnlText, signClass } from "./format"
import { TradeDetailDialog } from "./TradeDetailDialog"

const PAGE_SIZE = 15

export function RecentTradesTable({ filters }: { filters: AnalyticsFilterState }) {
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState("closedAt")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data, loading } = useAsyncData<Paged<ClosedTradeSummary>>(
    () =>
      apiGet("/api/analytics/trades", {
        ...toQuery(filters),
        page,
        pageSize: PAGE_SIZE,
        sortBy,
        sortDir,
      }),
    [page, sortBy, sortDir, filters.botId, filters.symbol, filters.side, filters.startTime, filters.endTime],
  )

  const trades = data?.items ?? []
  const totalPages = data?.totalPages ?? 1
  const total = data?.total ?? 0

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortBy(key)
      setSortDir("desc")
    }
  }

  const sortIndicator = (key: string) => (sortBy === key ? (sortDir === "asc" ? " ↑" : " ↓") : "")

  return (
    <Card className="bg-card">
      <CardHeader className="border-b">
        <CardTitle>Closed Trades</CardTitle>
        <CardDescription>{total} total · click a row for details</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {loading && !data ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : trades.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No closed trades match the current filters.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Exit Reason</TableHead>
                  <TableHead className="cursor-pointer text-right select-none" onClick={() => toggleSort("entry_price")}>
                    Entry{sortIndicator("entry_price")}
                  </TableHead>
                  <TableHead className="cursor-pointer text-right select-none" onClick={() => toggleSort("exit_price")}>
                    Exit{sortIndicator("exit_price")}
                  </TableHead>
                  <TableHead className="cursor-pointer text-right select-none" onClick={() => toggleSort("realized_pnl")}>
                    Net PnL{sortIndicator("realized_pnl")}
                  </TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="cursor-pointer text-right select-none" onClick={() => toggleSort("closed_at")}>
                    Closed{sortIndicator("closed_at")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => (
                  <TableRow
                    key={trade.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(trade.id)}
                  >
                    <TableCell>
                      <div className="font-medium text-foreground">{trade.symbol}</div>
                      <div className="text-xs text-muted-foreground">{trade.botName}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={trade.side === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}>
                        {trade.side === "BUY" ? "Long" : "Short"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{trade.exitReason}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPrice(trade.entryPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPrice(trade.exitPrice)}</TableCell>
                    <TableCell className={`text-right font-medium tabular-nums ${signClass(trade.netPnl)}`}>
                      {pnlText(trade.netPnl)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(trade.fees)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatDate(trade.exitTime)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Page {data?.page ?? 1} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft size={14} /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <TradeDetailDialog open={selectedId != null} onOpenChange={(open) => !open && setSelectedId(null)} tradeId={selectedId} />
    </Card>
  )
}
