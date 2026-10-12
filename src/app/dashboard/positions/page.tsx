"use client";

import { useEffect, useState } from "react";
import { Layers, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { TableSkeleton } from "@/components/ui/skeletons";
import { fetchJson } from "@/lib/api-client";
import { uniquePositions } from "@/components/positions/unique-positions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  PositionDetailSheet,
  type ExchangePosition,
} from "@/components/positions/PositionDetailSheet";
import { formatTimestamp } from "@/components/analytics/format";
import { orderTypeLabel, positionSideLabel, sideBadgeClass, sideLabel } from "@/components/trading/terms";
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider";
import { formatWithUnit, formatPct, formatSignedWithUnit } from "@/lib/currency/store";

type Position = ExchangePosition;

interface OpenOrder {
  order_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  status: string;
  order_type: string;
  quantity: string;
  exec_quantity: string;
  price: string;
  trigger_price?: string | number | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
}

/** Quantity in coin units — never currency-converted. */
function qty(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** USDT price/amount in the chosen display currency. */
function money(value: string | number | null | undefined): string {
  return formatWithUnit(value);
}

/** Amount (2 decimals) with its unit. */
function balance(value: string | number | null | undefined): string {
  return formatWithUnit(value, 2);
}

/** Estimated PnL (in quote/USDT) if a protective TP/SL order triggers, using the matching live position's entry. */
function estimatePnl(order: OpenOrder, positions: Position[]): number | null {
  const trigger = Number(order.trigger_price);
  if (!Number.isFinite(trigger)) return null;
  const pos = positions.find((p) => p.symbol === order.symbol && Number(p.position_size) > 0);
  if (!pos) return null;
  const entry = Number(pos.avg_entry_price);
  const qty = Number(order.quantity);
  if (!Number.isFinite(entry) || !Number.isFinite(qty)) return null;
  const direction = pos.position_side === "LONG" ? 1 : -1;
  return (trigger - entry) * qty * direction;
}

/** Money made (+) or lost (−) if this position closed at `price` (before fees). */
function outcomeAt(pos: Position, price: number | null): number | null {
  const entry = Number(pos.avg_entry_price);
  const size = Number(pos.position_size);
  if (price == null || !Number.isFinite(entry) || !Number.isFinite(size)) return null;
  return (price - entry) * size * (pos.position_side === "LONG" ? 1 : -1);
}

/** "+0.96% of your money": P&L relative to the position's margin (what the exchange shows). */
function pctOfMoney(amount: number | null, pos: Position | undefined): string | null {
  const margin = Number(pos?.position_margin);
  return amount != null && Number.isFinite(margin) && margin > 0 ? `${formatPct((amount / margin) * 100)} of your money` : null;
}

/** "price +47.80% away" from the current mark price. */
function priceAway(pos: Position | undefined, level: number | null): string | null {
  const mark = Number(pos?.mark_price);
  return level != null && Number.isFinite(mark) && mark > 0 ? `price ${formatPct(((level - mark) / mark) * 100)} away` : null;
}

/** TP/SL trigger prices for a position, derived from its protective open orders. */
function positionTargets(
  pos: Position,
  orders: OpenOrder[],
): { tp: number | null; sl: number | null } {
  let tp: number | null = null;
  let sl: number | null = null;
  const isLong = pos.position_side === "LONG";
  const entry = Number(pos.avg_entry_price);
  for (const order of orders) {
    if (order.symbol !== pos.symbol) continue;
    const trigger = Number(order.trigger_price);
    if (!Number.isFinite(trigger)) continue;
    const type = String(order.order_type ?? "").toUpperCase();
    if (type.includes("TAKE_PROFIT") || (isLong && trigger > entry) || (!isLong && trigger < entry)) {
      tp = trigger;
    } else {
      sl = trigger;
    }
  }
  return { tp, sl };
}

export default function AllPositionsPage() {
  useDisplayCurrency();
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);

  const [positionsError, setPositionsError] = useState<unknown>(null);
  const [ordersError, setOrdersError] = useState<unknown>(null);

  /** Load positions and orders independently so one failing endpoint never hides the other. */
  async function fetchAll(isCancelled: () => boolean = () => false) {
    const [posRes, ordRes] = await Promise.allSettled([
      fetchJson<{ data?: unknown; raw?: { data?: unknown } }>("/api/coinswitch/futures/all-positions"),
      fetchJson<{ data?: unknown }>("/api/coinswitch/futures/all-open-orders"),
    ]);
    if (isCancelled()) return;

    if (posRes.status === "fulfilled") {
      const json = posRes.value;
      setPositions(uniquePositions(Array.isArray(json.data) ? (json.data as Position[]) : Array.isArray(json.raw?.data) ? (json.raw.data as Position[]) : []));
      setPositionsError(null);
    } else {
      setPositionsError(posRes.reason);
    }

    if (ordRes.status === "fulfilled") {
      const data = ordRes.value.data as { orders?: OpenOrder[] } | OpenOrder[] | undefined;
      setOrders(Array.isArray(data) ? data : Array.isArray(data?.orders) ? data.orders : []);
      setOrdersError(null);
    } else {
      setOrdersError(ordRes.reason);
    }
    setLoading(false);
  }

  async function loadAll() {
    await fetchAll();
  }

  useEffect(() => {
    let cancelled = false;
    const load = () => void fetchAll(() => cancelled);
    load();
    const interval = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function cancelOrder(orderId: string) {
    setCancelingId(orderId);
    try {
      await fetchJson("/api/coinswitch/futures/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      toast.success("Order cancelled");
      await loadAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel order");
    } finally {
      setCancelingId(null);
    }
  }

  async function closePosition(position: Position) {
    const size = Number(position.position_size);
    if (!size || Number.isNaN(size)) return;

    setClosingId(position.position_id);
    try {
      const payload = {
        symbol: position.symbol.toLowerCase(),
        side: position.position_side === "LONG" ? "SELL" : "BUY",
        order_type: "MARKET",
        quantity: size,
        reduce_only: true,
        order_context: "close_position",
      };

      await fetchJson("/api/coinswitch/futures/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast.success("Position closing…");
      await loadAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to close position");
    } finally {
       setClosingId(null);
    }
  }

  return (
<div className="space-y-4 px-3 sm:px-6 py-5">
      <div>
        <h1 className="text-xl sm:text-2xl brand-heading">Positions & Orders</h1>
        <p className="text-sm text-muted-foreground">Live futures positions and open orders, refreshed every 8s.</p>
      </div>

      <Card className="bg-card">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Open Positions
          </CardTitle>
          <CardDescription>{positions.length} active position{positions.length === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {positionsError != null && positions.length > 0 && (
            <ErrorState error={positionsError} title="Couldn't refresh positions — showing the last loaded data" compact className="mb-3" onRetry={loadAll} />
          )}
          {positionsError != null && positions.length === 0 ? (
            <ErrorState error={positionsError} title="Couldn't load open positions" onRetry={loadAll} />
          ) : loading ? (
            <TableSkeleton rows={4} columns={9} />
          ) : positions.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No open positions.</p>
          ) : (
            <div className="overflow-x-auto">
<Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Mark</TableHead>
                    <TableHead className="text-right hidden xl:table-cell">Trade size</TableHead>
                    <TableHead className="text-right hidden md:table-cell" title="Your own money locked in this trade (margin)">Your money</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Liq. Price</TableHead>
                    <TableHead className="text-right">Profit / Loss now</TableHead>
                    <TableHead className="text-right" title="What you make if the target hits, and lose if the stop-loss hits (before fees)">If target / stop hits</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Opened</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((pos) => {
                    const pnl = Number(pos.unrealised_pnl);
                    const profit = pnl >= 0;
                    const { tp, sl } = positionTargets(pos, orders);
                    const atTp = outcomeAt(pos, tp);
                    const atSl = outcomeAt(pos, sl);
                    return (
                      <TableRow
                        key={pos.position_id}
                        className="cursor-pointer"
                        onClick={() => setSelected(pos)}
                      >
                        <TableCell>
                          <div className="font-medium text-foreground">{pos.symbol}</div>
                           <Badge className={sideBadgeClass(pos.position_side)}>
                             {positionSideLabel(pos.position_side)} {pos.leverage}x
                           </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{qty(pos.position_size)} {pos.symbol.toUpperCase().replace(/USDT$/, "")}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(pos.avg_entry_price)}</TableCell>
                        <TableCell className="text-right tabular-nums hidden lg:table-cell">{money(pos.mark_price)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground hidden xl:table-cell">
                          {(() => {
                            const notional = Number(pos.position_size) * Number(pos.avg_entry_price);
                            return Number.isFinite(notional) ? balance(notional) : "—";
                          })()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground hidden md:table-cell">{money(pos.position_margin)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground hidden lg:table-cell">{money(pos.liquidation_price)}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${profit ? "text-emerald-400" : "text-red-400"}`}>
                          {formatSignedWithUnit(pnl)}
                          <div className="text-[11px] font-normal text-muted-foreground">{pctOfMoney(pnl, pos)}</div>
                        </TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap tabular-nums">
                          <div className="text-emerald-400">Target {formatSignedWithUnit(atTp)}</div>
                          <div className="text-[11px] text-muted-foreground">{pctOfMoney(atTp, pos)} · {priceAway(pos, tp)}</div>
                          <div className="mt-1 text-red-400">Stop {formatSignedWithUnit(atSl)}</div>
                          <div className="text-[11px] text-muted-foreground">{pctOfMoney(atSl, pos)} · {priceAway(pos, sl)}</div>
                        </TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground hidden md:table-cell">
                          {formatTimestamp(pos.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                            disabled={closingId === pos.position_id}
                            onClick={(e) => {
                              e.stopPropagation();
                              closePosition(pos);
                            }}
                          >
                            {closingId === pos.position_id && <Loader2 className="animate-spin" />}
                            Close
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Open Orders
          </CardTitle>
          <CardDescription>{orders.length} open order{orders.length === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {ordersError != null && orders.length > 0 && (
            <ErrorState error={ordersError} title="Couldn't refresh orders — showing the last loaded data" compact className="mb-3" onRetry={loadAll} />
          )}
          {ordersError != null && orders.length === 0 ? (
            <ErrorState error={ordersError} title="Couldn't load open orders" onRetry={loadAll} />
          ) : loading ? (
            <TableSkeleton rows={4} columns={10} />
          ) : orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No open orders.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Amount</TableHead>
                    <TableHead className="text-right hidden xl:table-cell">Trigger (TP/SL)</TableHead>
                    <TableHead className="text-right" title="Money made (+) or lost (−) if this order triggers, before fees">If it triggers</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Placed</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.order_id}>
                      <TableCell className="font-medium text-foreground">{order.symbol}</TableCell>
                      <TableCell>
                         <Badge className={sideBadgeClass(order.side)}>{sideLabel(order.side)}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{orderTypeLabel(order.order_type)}</TableCell>
                      <TableCell className="text-muted-foreground">{order.status}</TableCell>
                      <TableCell className="text-right tabular-nums">{qty(order.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(order.price)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                        {(() => {
                          const amount = Number(order.quantity) * Number(order.price);
                          return Number.isFinite(amount) && amount > 0 ? balance(amount) : "—";
                        })()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums hidden xl:table-cell">
                        {order.trigger_price != null ? money(order.trigger_price) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {(() => {
                          const pnl = estimatePnl(order, positions);
                          if (pnl == null) return <span className="text-muted-foreground">—</span>;
                          const pos = positions.find((p) => p.symbol === order.symbol && Number(p.position_size) > 0);
                          const trigger = Number(order.trigger_price);
                          return (
                            <div className="tabular-nums">
                              <span className={`font-medium ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {pnl >= 0 ? `You make ${formatSignedWithUnit(pnl)}` : `You lose ${formatWithUnit(Math.abs(pnl), 2)}`}
                              </span>
                              <div className="text-[11px] text-muted-foreground">
                                {pctOfMoney(pnl, pos)}
                                {Number.isFinite(trigger) && pos ? ` · ${priceAway(pos, trigger)}` : ""}
                              </div>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground hidden md:table-cell">
                        {formatTimestamp(order.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                          disabled={cancelingId === order.order_id}
                          onClick={() => cancelOrder(order.order_id)}
                        >
                          {cancelingId === order.order_id && <Loader2 className="animate-spin" />}
                          Cancel
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          </CardContent>
        </Card>

        {selected && (
          <PositionDetailSheet
            position={selected}
            open
            onOpenChange={(open) => {
              if (!open) setSelected(null);
            }}
          />
        )}
      </div>
    );
}
