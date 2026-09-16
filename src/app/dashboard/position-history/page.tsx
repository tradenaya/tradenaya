"use client"

import { Fragment, useState } from "react"
import { ChevronLeft, ChevronRight, Layers, ChevronDown, ChevronUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { apiGet } from "@/components/analytics/api"
import { useAsyncData } from "@/components/analytics/use-data"
import { formatPrice, pnlText, signClass, formatDuration, formatMoney } from "@/components/analytics/format"
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider"

const PAGE_SIZE = 25

interface ClosedTrade {
  id: number
  tradeId: string
  symbol: string
  side: "BUY" | "SELL"
  entryPrice: number
  exitPrice: number
  quantity: number
  investment: number
  profitLoss: number
  fees: number
  grossProfit: number
  commission: number
  fundingFee: number
  percentage: number
  exitReason: string
  outcome: "WIN" | "LOSS" | "BREAKEVEN"
  botName: string
  strategy: string
  leverage: number | null
  entryTime: string
  exitTime: string
  durationMs: number
  balanceAfter: number | null
  stopLoss: number | null
  takeProfit: number | null
  trailingActivated: boolean
  highestPrice: number | null
  lowestPrice: number | null
  positionSize: number | null
}

interface ActivePosition {
  positionId: number | null
  botId: number
  botName: string
  symbol: string
  side: "BUY" | "SELL"
  state: string
  entryPrice: number | null
  currentPrice: number | null
  unrealizedPnl: number | null
  leverage: number | null
  openTime: string
  durationMs: number
  stopLoss: number | null
  takeProfit: number | null
  trailingActivated: boolean
}

interface PositionHistoryData {
  closed: ClosedTrade[]
  active: ActivePosition[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

function sideBadge(side: string): string {
  return side === "BUY"
    ? "bg-emerald-500/15 text-emerald-400"
    : "bg-red-500/15 text-red-400"
}

function outcomeBadge(outside: string): string {
  if (outside === "WIN") return "bg-emerald-500/15 text-emerald-400"
  if (outside === "LOSS") return "bg-red-500/15 text-red-400"
  return "bg-zinc-500/15 text-zinc-400"
}

function exitReasonLabel(reason: string): string {
  const upper = (reason ?? "").toUpperCase()
  if (upper.includes("TAKE_PROFIT") || upper.includes("TP")) return "TP Hit"
  if (upper.includes("STOP_LOSS") || upper.includes("SL")) return "SL Hit"
  if (upper.includes("TRAILING")) return "Trailing"
  if (upper.includes("MANUAL")) return "Manual"
  if (upper.includes("CIRCUIT")) return "Circuit Break"
  if (upper.includes("CANCEL")) return "Cancelled"
  if (upper.includes("EXPIRY") || upper.includes("EXPIRED")) return "Expired"
  if (upper.includes("RECOVERY")) return "Recovered"
  return reason || "—"
}

function exitReasonBadgeClass(reason: string): string {
  const upper = (reason ?? "").toUpperCase()
  if (upper.includes("TAKE_PROFIT") || upper.includes("TP")) return "bg-emerald-500/15 text-emerald-400"
  if (upper.includes("STOP_LOSS") || upper.includes("SL")) return "bg-red-500/15 text-red-400"
  if (upper.includes("TRAILING")) return "bg-violet-500/15 text-violet-400"
  if (upper.includes("MANUAL")) return "bg-amber-500/15 text-amber-400"
  if (upper.includes("CANCEL")) return "bg-zinc-500/15 text-zinc-400"
  if (upper.includes("RECOVERY")) return "bg-orange-500/15 text-orange-400"
  return "bg-zinc-500/15 text-zinc-400"
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—"
  try {
    const d = new Date(ts)
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch {
    return "—"
  }
}

export default function PositionHistoryPage() {
  useDisplayCurrency();
  const [page, setPage] = useState(1)
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null)

  const { data, error, loading } = useAsyncData<PositionHistoryData>(
    () => apiGet("/api/position-history", { page, pageSize: PAGE_SIZE, sortBy: "closedAt", sortDir: "desc" }),
    [page],
  )

  const closed = data?.closed ?? []
  const active = data?.active ?? []
  const totalPages = data?.totalPages ?? 1
  const total = data?.total ?? 0

  return (
    <div className="space-y-4 px-3 sm:px-6 py-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Position History</h1>
        <p className="text-sm text-muted-foreground">
          Completed positions with entry, exit, P&amp;L and running balance.
        </p>
      </div>

      {error && !data ? (
        <Card className="bg-card">
          <CardContent className="py-12 text-center text-sm text-red-400">{error}</CardContent>
        </Card>
      ) : loading && !data ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : (
        <>
          {active.length > 0 && (
            <Card className="bg-card">
              <CardHeader className="border-b">
                <CardTitle>Open Positions ({active.length})</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Bot</TableHead>
                        <TableHead className="text-right">Entry</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">SL</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">TP</TableHead>
                        <TableHead className="text-right">Unrealized PnL</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Lev</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {active.map((pos, i) => (
                        <TableRow key={pos.positionId ?? `active-${i}`}>
                          <TableCell className="font-medium">{pos.symbol}</TableCell>
                          <TableCell>
                            <Badge className={sideBadge(pos.side)}>{pos.side}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-blue-500/15 text-blue-400">{pos.state}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{pos.botName}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPrice(pos.entryPrice)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPrice(pos.currentPrice)}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-red-400 hidden sm:table-cell">
                            {pos.stopLoss != null ? formatPrice(pos.stopLoss) : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-emerald-400 hidden sm:table-cell">
                            {pos.takeProfit != null ? formatPrice(pos.takeProfit) : "—"}
                          </TableCell>
                          <TableCell className={`text-right font-medium tabular-nums ${signClass(pos.unrealizedPnl)}`}>
                            {pnlText(pos.unrealizedPnl)}
                          </TableCell>
                          <TableCell className="text-right hidden sm:table-cell">{pos.leverage ? `${pos.leverage}x` : "—"}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground hidden lg:table-cell">{formatDuration(pos.durationMs)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="bg-card">
            <CardHeader className="border-b">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Closed Positions ({total})</CardTitle>
                {total > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Page {page} of {totalPages}
                    </span>
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
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {closed.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Layers className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No completed positions yet. They will appear once a trade hits TP, SL, or is cancelled.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[700px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead className="text-right">Entry</TableHead>
                        <TableHead className="text-right">Exit</TableHead>
                        <TableHead className="text-right hidden md:table-cell">Size</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Lev</TableHead>
                        <TableHead className="hidden md:table-cell">Outcome</TableHead>
                        <TableHead>Exit Reason</TableHead>
                        <TableHead className="text-right">P&amp;L</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Gross</TableHead>
                        <TableHead className="text-right hidden xl:table-cell">Fees</TableHead>
                        <TableHead className="text-right hidden xl:table-cell">Funding</TableHead>
                        <TableHead className="text-right hidden md:table-cell">ROI</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {closed.map((trade) => {
                        const pct = trade.percentage
                        const isExpanded = expandedTrade === trade.id
                        return (
                          <Fragment key={`closed-${trade.tradeId}`}>
                            <TableRow
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => setExpandedTrade(isExpanded ? null : trade.id)}
                            >
                              <TableCell className="w-8 py-2">
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </TableCell>
                              <TableCell className="font-medium">{trade.symbol}</TableCell>
                              <TableCell>
                                <Badge className={sideBadge(trade.side)}>{trade.side}</Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">{formatPrice(trade.entryPrice)}</TableCell>
                              <TableCell className="text-right tabular-nums text-xs">{formatPrice(trade.exitPrice)}</TableCell>
                              <TableCell className="text-right tabular-nums text-xs hidden md:table-cell">
                                {trade.positionSize != null ? trade.positionSize.toFixed(4) : "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground hidden lg:table-cell">
                                {trade.leverage ? `${trade.leverage}x` : "—"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                <Badge className={outcomeBadge(trade.outcome)}>
                                  {trade.outcome === "WIN" ? "Won" : trade.outcome === "LOSS" ? "Lost" : "Flat"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge className={exitReasonBadgeClass(trade.exitReason)}>
                                  {exitReasonLabel(trade.exitReason)}
                                </Badge>
                              </TableCell>
                              <TableCell className={`text-right font-medium tabular-nums ${signClass(trade.profitLoss)}`}>
                                {pnlText(trade.profitLoss)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground hidden lg:table-cell">
                                {trade.grossProfit != null && trade.grossProfit !== 0
                                  ? `${signClass(trade.grossProfit) === "text-emerald-400" ? "+" : ""}$${Math.abs(trade.grossProfit).toFixed(4)}`
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground hidden xl:table-cell">
                                {trade.commission != null && trade.commission > 0 ? `-$${trade.commission.toFixed(4)}` : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground hidden xl:table-cell">
                                {trade.fundingFee != null && trade.fundingFee !== 0 ? `${trade.fundingFee > 0 ? "-" : "+"}$${Math.abs(trade.fundingFee).toFixed(4)}` : "—"}
                              </TableCell>
                              <TableCell className={`text-right tabular-nums text-xs hidden md:table-cell ${signClass(pct)}`}>
                                {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground hidden sm:table-cell">{formatDuration(trade.durationMs)}</TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow key={`detail-${trade.tradeId}`} className="bg-muted/30">
                                <TableCell colSpan={15} className="py-3 px-4">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs min-w-0">
                                    <div>
                                      <span className="text-muted-foreground">Outcome</span>
                                      <p className={`font-bold ${trade.outcome === "WIN" ? "text-emerald-400" : trade.outcome === "LOSS" ? "text-red-400" : "text-zinc-400"}`}>
                                        {trade.outcome === "WIN" ? "Won" : trade.outcome === "LOSS" ? "Lost" : "Breakeven"}
                                        {trade.profitLoss >= 0 ? ` +$${trade.profitLoss.toFixed(2)}` : ` -$${Math.abs(trade.profitLoss).toFixed(2)}`}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Exit Reason</span>
                                      <p className="font-bold">
                                        <Badge className={exitReasonBadgeClass(trade.exitReason)}>
                                          {exitReasonLabel(trade.exitReason)}
                                        </Badge>
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">ROI</span>
                                      <p className={`font-bold ${signClass(trade.percentage)}`}>
                                        {trade.percentage >= 0 ? "+" : ""}{trade.percentage.toFixed(2)}%
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Gross Profit</span>
                                      <p className={`font-medium ${signClass(trade.grossProfit)}`}>
                                        {trade.grossProfit != null && trade.grossProfit !== 0
                                          ? `${trade.grossProfit > 0 ? "+" : "-"}$${Math.abs(trade.grossProfit).toFixed(4)}`
                                          : "—"}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Commission</span>
                                      <p className="font-medium">-{trade.commission != null && trade.commission > 0 ? `$${trade.commission.toFixed(4)}` : "—"}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Funding</span>
                                      <p className="font-medium">{trade.fundingFee != null && trade.fundingFee !== 0 ? `${trade.fundingFee > 0 ? "-" : "+"}$${Math.abs(trade.fundingFee).toFixed(4)}` : "—"}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Net P&amp;L</span>
                                      <p className={`font-bold ${signClass(trade.profitLoss)}`}>
                                        {trade.profitLoss != null ? `${trade.profitLoss >= 0 ? "+" : "-"}$${Math.abs(trade.profitLoss).toFixed(4)}` : "—"}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Bot</span>
                                      <p className="font-medium">{trade.botName}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Strategy</span>
                                      <p className="font-medium">{trade.strategy}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Investment</span>
                                      <p className="font-medium">${trade.investment.toFixed(2)}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Position Size</span>
                                      <p className="font-medium">{trade.positionSize != null ? `${trade.positionSize.toFixed(4)} ${trade.symbol.replace("USDT", "")}` : "—"}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Stop Loss</span>
                                      <p className="font-medium text-red-400">{trade.stopLoss != null ? formatPrice(trade.stopLoss) : "—"}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Take Profit</span>
                                      <p className="font-medium text-emerald-400">{trade.takeProfit != null ? formatPrice(trade.takeProfit) : "—"}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Trailing Stop</span>
                                      <p className="font-medium">{trade.trailingActivated ? "Activated" : "Not triggered"}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Balance After</span>
                                      <p className="font-medium">
                                        {trade.balanceAfter != null
                                          ? `${trade.balanceAfter >= 0 ? "" : "-"}${formatMoney(Math.abs(trade.balanceAfter))}`
                                          : "—"}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Entry Time</span>
                                      <p className="font-medium">{formatTimestamp(trade.entryTime)}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Exit Time</span>
                                      <p className="font-medium">{formatTimestamp(trade.exitTime)}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Highest Price</span>
                                      <p className="font-medium">{trade.highestPrice != null ? formatPrice(trade.highestPrice) : "—"}</p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Lowest Price</span>
                                      <p className="font-medium">{trade.lowestPrice != null ? formatPrice(trade.lowestPrice) : "—"}</p>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {total > PAGE_SIZE && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
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
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
