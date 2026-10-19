"use client"

import { Fragment, useState } from "react"
import { ChevronLeft, ChevronRight, Layers, ChevronDown, ChevronUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/ui/error-state"
import { TableSkeleton } from "@/components/ui/skeletons"
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
import { formatPrice, formatMoney, pnlText, signClass, formatDuration } from "@/components/analytics/format"
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider"
import { formatPct } from "@/lib/currency/store"
import { StopLossHistory } from "@/components/positions/StopLossHistory"
import { exitOutcome } from "@/automation/analytics/exit-outcome"

/** "−4.87% from entry". */
function fromEntry(entry: number | null, price: number | null): string | null {
  return entry != null && entry > 0 && price != null ? `${formatPct(((price - entry) / entry) * 100)} from entry` : null
}

/** Money made (+) / lost (−) if the position closed at `price` (before fees). */
function outcomeAt(side: "BUY" | "SELL", entry: number | null, quantity: number | null, price: number | null): number | null {
  if (entry == null || quantity == null || price == null) return null
  return (price - entry) * Math.abs(quantity) * (side === "BUY" ? 1 : -1)
}

/** "+12.40% of your money". */
function ofMoney(amount: number | null, margin: number | null): string | null {
  return amount != null && margin != null && margin > 0 ? `${formatPct((amount / margin) * 100)} of your money` : null
}

/** A price with its % from entry and, for stop / target, what it means in money. */
function LevelCell({ price, entry, side, quantity, margin, tone }: { price: number | null; entry: number | null; side: "BUY" | "SELL"; quantity: number | null; margin: number | null; tone?: string }) {
  if (price == null) return <span className="text-muted-foreground">—</span>
  const amount = outcomeAt(side, entry, quantity, price)
  return (
    <div className="space-y-0.5">
      <div className={tone}>{formatPrice(price)}</div>
      <div className="text-[11px] text-muted-foreground">{fromEntry(entry, price)}</div>
      {amount != null && (
        <div className="text-[11px]">
          <span className={signClass(amount)}>{pnlText(amount)}</span>
          {ofMoney(amount, margin) && <span className="text-muted-foreground"> · {ofMoney(amount, margin)}</span>}
        </div>
      )}
    </div>
  )
}

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
  /** Net P&L as a % of your own money (margin). */
  percentage: number
  margin: number
  priceMovePct: number
  executionId: number | null
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
  quantity: number | null
  margin: number | null
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

/** Exit badge named by what the trade earned ("Profit locked", not "SL hit", when a trailed stop closed it in profit). */
function ExitBadge({ trade }: { trade: { exitReason: string; profitLoss: number } }) {
  const o = exitOutcome(trade.exitReason, trade.profitLoss)
  return <Badge className={o.badge}>{o.label}</Badge>
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "—"
  try {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return "—"
    return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch {
    return "—"
  }
}

export default function PositionHistoryPage() {
  useDisplayCurrency();
  const [page, setPage] = useState(1)
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null)
  const [expandedOpen, setExpandedOpen] = useState<number | null>(null)

  const { data, error, errorInfo, loading, refresh } = useAsyncData<PositionHistoryData>(
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
        <h1 className="text-xl sm:text-2xl brand-heading">Position History</h1>
        <p className="text-sm text-muted-foreground">
          Completed positions with entry, exit, P&amp;L and running balance.
        </p>
      </div>

      {error && !data ? (
        <ErrorState error={errorInfo ?? error} title="Couldn't load position history" onRetry={refresh} />
      ) : loading && !data ? (
        <Card className="bg-card">
          <CardContent className="pt-4">
            <TableSkeleton rows={10} columns={9} />
          </CardContent>
        </Card>
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
                        <TableHead className="text-right hidden sm:table-cell">Stop-loss</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Target</TableHead>
                        <TableHead className="text-right">Profit / Loss now</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Lev</TableHead>
                        <TableHead className="text-right">Open for</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {active.map((pos, i) => (
                        <Fragment key={pos.positionId ?? `active-${i}`}>
                        <TableRow
                          className={pos.positionId != null ? "cursor-pointer hover:bg-muted/50" : undefined}
                          onClick={() => pos.positionId != null && setExpandedOpen(expandedOpen === pos.positionId ? null : pos.positionId)}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1">
                              {pos.positionId != null && (expandedOpen === pos.positionId ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                              {pos.symbol}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={sideBadge(pos.side)}>{pos.side}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-blue-500/15 text-blue-400">{pos.state}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{pos.botName}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPrice(pos.entryPrice)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <div>{formatPrice(pos.currentPrice)}</div>
                            <div className="text-[11px] text-muted-foreground">{fromEntry(pos.entryPrice, pos.currentPrice)}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs hidden sm:table-cell">
                            <LevelCell
                              price={pos.stopLoss}
                              entry={pos.entryPrice}
                              side={pos.side}
                              quantity={pos.quantity}
                              margin={pos.margin}
                              tone={(outcomeAt(pos.side, pos.entryPrice, pos.quantity, pos.stopLoss) ?? -1) >= 0 ? "text-emerald-400" : "text-red-400"}
                            />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs hidden sm:table-cell">
                            <LevelCell price={pos.takeProfit} entry={pos.entryPrice} side={pos.side} quantity={pos.quantity} margin={pos.margin} tone="text-emerald-400" />
                          </TableCell>
                          <TableCell className={`text-right font-medium tabular-nums ${signClass(pos.unrealizedPnl)}`}>
                            {pnlText(pos.unrealizedPnl)}
                            {ofMoney(pos.unrealizedPnl, pos.margin) && (
                              <div className="text-[11px] font-normal text-muted-foreground">{ofMoney(pos.unrealizedPnl, pos.margin)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right hidden sm:table-cell">{pos.leverage ? `${pos.leverage}x` : "—"}</TableCell>
                          <TableCell className="text-right text-xs whitespace-nowrap">
                            <div className="font-medium text-foreground">{formatDuration(pos.durationMs)}</div>
                            <div className="text-muted-foreground">since {formatTimestamp(pos.openTime)}</div>
                          </TableCell>
                        </TableRow>
                        {pos.positionId != null && expandedOpen === pos.positionId && (
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={11} className="px-4 py-3">
                              <StopLossHistory positionId={pos.positionId} />
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
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
                <>
                <ul className="space-y-3 md:hidden">
                  {closed.map((trade) => (
                    <ClosedTradeCard
                      key={`m-${trade.tradeId}`}
                      trade={trade}
                      expanded={expandedTrade === trade.id}
                      onToggle={() => setExpandedTrade(expandedTrade === trade.id ? null : trade.id)}
                    />
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <Table className="min-w-[820px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Symbol</TableHead>
                        <TableHead className="whitespace-nowrap">Opened / Closed</TableHead>
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
                        <TableHead className="text-right hidden md:table-cell" title="Net profit / loss as a % of your own money (margin)">% of your money</TableHead>
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
                              <TableCell className="whitespace-nowrap text-xs tabular-nums">
                                <div>
                                  <span className="text-muted-foreground">Opened </span>
                                  {formatTimestamp(trade.entryTime)}
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Closed </span>
                                  {formatTimestamp(trade.exitTime)}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge className={sideBadge(trade.side)}>{trade.side}</Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">{formatPrice(trade.entryPrice)}</TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                <div>{formatPrice(trade.exitPrice)}</div>
                                <div className="text-[11px] text-muted-foreground">{formatPct(trade.priceMovePct)} from entry</div>
                              </TableCell>
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
                                <ExitBadge trade={trade} />
                              </TableCell>
                              <TableCell className={`text-right font-medium tabular-nums ${signClass(trade.profitLoss)}`}>
                                {pnlText(trade.profitLoss)}
                                <div className="text-[11px] font-normal text-muted-foreground">{formatPct(trade.percentage)} of your money</div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground hidden lg:table-cell">
                                {trade.grossProfit != null && trade.grossProfit !== 0
                                  ? pnlText(trade.grossProfit)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground hidden xl:table-cell">
                                {trade.commission != null && trade.commission > 0 ? `-${formatMoney(trade.commission)}` : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs text-muted-foreground hidden xl:table-cell">
                                {trade.fundingFee != null && trade.fundingFee !== 0 ? (trade.fundingFee > 0 ? `-${formatMoney(trade.fundingFee)}` : `+${formatMoney(Math.abs(trade.fundingFee))}`) : "—"}
                              </TableCell>
                              <TableCell className={`text-right tabular-nums text-xs hidden md:table-cell ${signClass(pct)}`}>
                                {formatPct(pct)}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground hidden sm:table-cell">{formatDuration(trade.durationMs)}</TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow key={`detail-${trade.tradeId}`} className="bg-muted/30">
                                <TableCell colSpan={16} className="py-3 px-4">
                                  <TradeDetailGrid trade={trade} className="grid-cols-2 sm:grid-cols-4" />
                                  {trade.executionId != null && <StopLossHistory executionId={trade.executionId} className="mt-4 border-t border-border pt-3" />}
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
                </>
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


/** Full trade breakdown, shared by the desktop expanded row and the mobile card. */
function TradeDetailGrid({ trade, className = "" }: { trade: ClosedTrade; className?: string }) {
  return (
    <div className={`grid gap-x-4 gap-y-3 text-xs min-w-0 ${className}`}>
      <div>
        <span className="text-muted-foreground">Outcome</span>
        <p className={`font-bold ${trade.outcome === "WIN" ? "text-emerald-400" : trade.outcome === "LOSS" ? "text-red-400" : "text-zinc-400"}`}>
          {trade.outcome === "WIN" ? "Won" : trade.outcome === "LOSS" ? "Lost" : "Breakeven"}
          {" "}{pnlText(trade.profitLoss)}
        </p>
      </div>
      <div>
        <span className="text-muted-foreground">Exit Reason</span>
        <p className="font-bold">
          <ExitBadge trade={trade} />
        </p>
      </div>
      <div>
        <span className="text-muted-foreground">Return on your money</span>
        <p className={`font-bold ${signClass(trade.percentage)}`}>
          {formatPct(trade.percentage)}
        </p>
      </div>
      <div>
        <span className="text-muted-foreground">Gross Profit</span>
        <p className={`font-medium ${signClass(trade.grossProfit)}`}>
          {trade.grossProfit != null && trade.grossProfit !== 0
            ? pnlText(trade.grossProfit)
            : "—"}
        </p>
      </div>
      <div>
        <span className="text-muted-foreground">Commission</span>
        <p className="font-medium">-{trade.commission != null && trade.commission > 0 ? formatMoney(trade.commission) : "—"}</p>
      </div>
      <div>
        <span className="text-muted-foreground">Funding</span>
        <p className="font-medium">{trade.fundingFee != null && trade.fundingFee !== 0 ? (trade.fundingFee > 0 ? `-${formatMoney(trade.fundingFee)}` : `+${formatMoney(Math.abs(trade.fundingFee))}`) : "—"}</p>
      </div>
      <div>
        <span className="text-muted-foreground">Net P&amp;L</span>
        <p className={`font-bold ${signClass(trade.profitLoss)}`}>
          {trade.profitLoss != null ? pnlText(trade.profitLoss) : "—"}
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
        <span className="text-muted-foreground">Your money in</span>
        <p className="font-medium">{formatMoney(trade.margin)}</p>
        <p className="text-[11px] text-muted-foreground">Trade size {formatMoney(trade.investment)}{trade.leverage ? ` (${trade.leverage}x)` : ""}</p>
      </div>
      <div>
        <span className="text-muted-foreground">Position Size</span>
        <p className="font-medium">{trade.positionSize != null ? `${trade.positionSize.toFixed(4)} ${trade.symbol.replace("USDT", "")}` : "—"}</p>
      </div>
      <div>
        <span className="text-muted-foreground">Stop-loss (last)</span>
        <LevelCell price={trade.stopLoss} entry={trade.entryPrice} side={trade.side} quantity={trade.quantity} margin={trade.margin} tone="font-medium text-red-400" />
      </div>
      <div>
        <span className="text-muted-foreground">Target</span>
        <LevelCell price={trade.takeProfit} entry={trade.entryPrice} side={trade.side} quantity={trade.quantity} margin={trade.margin} tone="font-medium text-emerald-400" />
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
  )
}

/** Mobile layout: one full-width card per closed trade; tap to expand the details. */
function ClosedTradeCard({ trade, expanded, onToggle }: { trade: ClosedTrade; expanded: boolean; onToggle: () => void }) {
  return (
    <li className="rounded-lg border border-border bg-background/40">
      <button type="button" onClick={onToggle} className="w-full space-y-2.5 p-3 text-left" aria-expanded={expanded}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="font-semibold text-foreground">{trade.symbol}</span>
            <Badge className={sideBadge(trade.side)}>{trade.side}</Badge>
            <ExitBadge trade={trade} />
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-sm font-semibold tabular-nums ${signClass(trade.profitLoss)}`}>{pnlText(trade.profitLoss)}</div>
            <div className={`text-[11px] tabular-nums ${signClass(trade.percentage)}`}>
              {formatPct(trade.percentage)} of your money
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div><span className="text-muted-foreground">Entry </span><span className="tabular-nums">{formatPrice(trade.entryPrice)}</span></div>
          <div><span className="text-muted-foreground">Exit </span><span className="tabular-nums">{formatPrice(trade.exitPrice)}</span> <span className="text-[11px] text-muted-foreground">({formatPct(trade.priceMovePct)})</span></div>
          <div className="min-w-0"><span className="text-muted-foreground">Opened </span><span className="tabular-nums">{formatTimestamp(trade.entryTime)}</span></div>
          <div className="min-w-0"><span className="text-muted-foreground">Closed </span><span className="tabular-nums">{formatTimestamp(trade.exitTime)}</span></div>
          <div><span className="text-muted-foreground">Duration </span>{formatDuration(trade.durationMs)}</div>
          <div><span className="text-muted-foreground">Leverage </span>{trade.leverage ? `${trade.leverage}x` : "—"}</div>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {expanded ? "Hide details" : "Show details"}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border bg-muted/30 p-3">
          <TradeDetailGrid trade={trade} className="grid-cols-2" />
          {trade.executionId != null && <StopLossHistory executionId={trade.executionId} className="mt-4 border-t border-border pt-3" />}
        </div>
      )}
    </li>
  )
}
