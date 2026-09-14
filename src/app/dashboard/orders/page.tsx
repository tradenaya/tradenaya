"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, History, RefreshCw, Search } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { OrderHistoryRow, Paged } from "@/automation/order-history/types"
import { apiGet, apiSend } from "@/components/analytics/api"
import { useAsyncData } from "@/components/analytics/use-data"
import { formatDate, formatPrice, pnlText, signClass } from "@/components/analytics/format"
import { orderTypeLabel, orderContextLabel, sideBadgeClass, sideLabel } from "@/components/trading/terms"

const PAGE_SIZE = 25

const CONTEXT_META: Record<string, { label: string; className: string }> = {
  entry: { label: "Entry", className: "bg-emerald-500/15 text-emerald-400" },
  stop_loss: { label: "Stop Loss", className: "bg-red-500/15 text-red-400" },
  take_profit: { label: "Take Profit", className: "bg-emerald-500/15 text-emerald-400" },
  close_position: { label: "Closed", className: "bg-amber-500/15 text-amber-400" },
}

function contextMeta(context: string): { label: string; className: string } {
  return CONTEXT_META[context] ?? { label: orderContextLabel(context), className: "bg-zinc-500/15 text-zinc-400" }
}

function statusBadge(status: string) {
  const upper = status.toUpperCase()
  const cls =
    upper.includes("REJECT") || upper.includes("FAIL")
      ? "bg-red-500/15 text-red-400"
      : upper.includes("CANCEL") || upper.includes("EXPIR")
        ? "bg-zinc-500/15 text-zinc-400"
        : upper.includes("FILL")
          ? "bg-emerald-500/15 text-emerald-400"
          : upper.includes("PART")
            ? "bg-amber-500/15 text-amber-400"
            : "bg-zinc-500/15 text-zinc-400"
  return <Badge className={cls}>{status}</Badge>
}

export default function OrdersPage() {
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [searchInput])

  const { data, error, loading, refresh } = useAsyncData<Paged<OrderHistoryRow>>(
    () =>
      apiGet("/api/orders", {
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
      }),
    [page, search],
  )

  const syncFromExchange = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const result = await apiSend<{ synced: number; total: number }>("/api/orders/sync", { method: "POST" })
      toast.success(
        result.total === 0
          ? "No closed orders were found on the exchange"
          : `${result.synced} new order${result.synced === 1 ? "" : "s"} synced from exchange`,
      )
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to sync order history")
    } finally {
      setSyncing(false)
    }
  }

  const orders = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold">Order History</h1>
        <p className="text-sm text-muted-foreground">
          Every futures order placed from your account, newest first.
        </p>
      </div>

      <Card className="bg-card">
        <CardHeader className="border-b">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Orders</CardTitle>
              <CardDescription>{total} total</CardDescription>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="relative flex-1 sm:w-72 sm:flex-none">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search symbol, status, order id…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={syncFromExchange} disabled={syncing}>
                <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing…" : "Sync from exchange"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {error && !data ? (
            <p className="py-8 text-center text-sm text-red-400">{error}</p>
          ) : loading && !data ? (
            <Skeleton className="h-96 w-full rounded-lg" />
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <History className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {search
                  ? `No orders match "${search}".`
                  : "No orders yet. Use “Sync from exchange” to pull your API trade history, or wait for automation to place trades."}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Context</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Trigger</TableHead>
                      <TableHead className="text-right">PnL</TableHead>
                      <TableHead className="text-right">ROI</TableHead>
                      <TableHead className="text-right">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => {
                      const ctx = contextMeta(order.orderContext)
                      return (
                        <TableRow key={order.id}>
                          <TableCell>
                            <div className="font-medium text-foreground">#{order.id}</div>
                            <div className="text-xs text-muted-foreground">
                              {order.clientOrderId ?? order.exchangeOrderId ?? "—"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-foreground">{order.symbol}</div>
                            <Badge className={sideBadgeClass(order.side)}>{sideLabel(order.side)}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={ctx.className}>{ctx.label}</Badge>
                            <div className="mt-1 text-xs text-muted-foreground">{orderTypeLabel(order.orderType)}</div>
                          </TableCell>
                          <TableCell>{statusBadge(order.status)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPrice(order.quantity)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPrice(order.price)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPrice(order.triggerPrice)}
                          </TableCell>
                           <TableCell
                             className={`text-right font-medium tabular-nums ${order.realizedPnl == null ? "text-muted-foreground" : signClass(order.realizedPnl)}`}
                           >
                             {order.realizedPnl == null ? "—" : pnlText(order.realizedPnl)}
                           </TableCell>
                           <TableCell className="text-right tabular-nums">
                             {order.amountUsed && order.realizedPnl != null
                               ? (() => {
                                   const pct = (order.realizedPnl / order.amountUsed) * 100;
                                   return (
                                     <span className={signClass(pct)}>
                                       {pct > 0 ? "+" : ""}
                                       {pct.toFixed(2)}%
                                     </span>
                                   );
                                 })()
                               : "—"}
                           </TableCell>
                           <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
                             {formatDate(order.createdAt)}
                           </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Page {data?.page ?? 1} of {totalPages} · {total} orders
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
      </Card>
    </div>
  )
}
