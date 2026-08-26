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
import type { TradeDetail } from "@/automation/analytics/types"
import { apiGet } from "./api"
import { formatDate, formatDuration, formatMoney, formatPrice, pnlText, signClass } from "./format"

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium text-foreground ${valueClass ?? ""}`}>{value}</span>
    </div>
  )
}

export function TradeDetailDialog({
  open,
  onOpenChange,
  tradeId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tradeId: number | null
}) {
  const [data, setData] = useState<TradeDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = data === null && error === null

  useEffect(() => {
    if (!open || tradeId == null) return
    let cancelled = false
    apiGet<TradeDetail>(`/api/analytics/trades/${tradeId}`)
      .then((detail) => {
        if (!cancelled) setData(detail)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load trade")
      })
    return () => {
      cancelled = true
    }
  }, [open, tradeId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Trade {data ? `#${data.id}` : ""}</DialogTitle>
          <DialogDescription>
            {data ? `${data.symbol} · ${data.botName} · ${formatDate(data.exitTime)}` : "Loading trade details"}
          </DialogDescription>
        </DialogHeader>

        {loading && !data && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        {data && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge className={data.side === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}>
                {data.side === "BUY" ? "Long" : "Short"}
              </Badge>
              <Badge className="bg-muted text-muted-foreground">{data.exitReason}</Badge>
              {data.trailingActivated && <Badge className="bg-amber-500/15 text-amber-400">Trailing</Badge>}
            </div>

            <div className="divide-y divide-border">
              <Row label="Net PnL" value={pnlText(data.netPnl)} valueClass={signClass(data.netPnl)} />
              <Row label="Gross PnL" value={formatMoney(data.realizedPnl)} valueClass={signClass(data.realizedPnl)} />
              <Row label="Fees" value={formatMoney(data.fees)} />
              <Row label="Quantity" value={data.quantity != null ? data.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"} />
              <Row label="Entry Price" value={formatPrice(data.entryPrice)} />
              <Row label="Exit Price" value={formatPrice(data.exitPrice)} />
              <Row label="Leverage" value={data.leverage != null ? `${data.leverage}x` : "—"} />
              <Row label="Strategy" value={data.strategy} />
              <Row label="Duration" value={formatDuration(data.durationMs)} />
              <Row label="Entry Time" value={formatDate(data.entryTime)} />
              <Row label="Exit Time" value={formatDate(data.exitTime)} />
              <Row label="Max Favorable" value={data.highestPrice != null ? formatPrice(data.highestPrice) : "—"} />
              <Row label="Max Adverse" value={data.lowestPrice != null ? formatPrice(data.lowestPrice) : "—"} />
            </div>

            {data.events.length > 0 && (
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Timeline</p>
                <ul className="space-y-1.5">
                  {data.events.map((event) => (
                    <li key={event.id} className="flex items-start justify-between gap-3 text-xs">
                      <span className="text-foreground">
                        <span className="mr-1.5 font-medium text-muted-foreground">{event.type}</span>
                        {event.message}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{formatDate(event.timestamp)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
