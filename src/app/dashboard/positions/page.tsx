"use client";

import { useEffect, useState } from "react";
import { Layers, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

function money(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("en-US", { maximumFractionDigits: 4 });
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

/** Distance in % from current mark price to a target price. */
function distancePct(current: number | null, target: number | null): number | null {
  if (current == null || target == null || !Number.isFinite(current) || !Number.isFinite(target) || current === 0)
    return null;
  return ((target - current) / current) * 100;
}

export default function AllPositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);

  async function fetchAll() {
    const [posRes, ordRes] = await Promise.all([
      fetch("/api/coinswitch/futures/all-positions", { cache: "no-store" }),
      fetch("/api/coinswitch/futures/all-open-orders", { cache: "no-store" }),
    ]);

    const posJson = await posRes.json();
    const ordJson = await ordRes.json();

    const normalizedPositions = Array.isArray(posJson.data)
      ? posJson.data
      : Array.isArray(posJson?.raw?.data)
        ? posJson.raw.data
        : [];

    const normalizedOrders = Array.isArray(ordJson.data)
      ? ordJson.data
      : Array.isArray(ordJson?.data?.orders)
        ? ordJson.data.orders
        : [];

    return { posJson, ordJson, normalizedPositions, normalizedOrders };
  }

  async function loadAll() {
    try {
      const { posJson, ordJson, normalizedPositions, normalizedOrders } = await fetchAll();
      if (posJson.success) setPositions(normalizedPositions);
      if (ordJson.success) setOrders(normalizedOrders);
    } catch (err) {
      console.log("LOAD ALL ERROR", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { posJson, ordJson, normalizedPositions, normalizedOrders } = await fetchAll();
        if (!cancelled) {
          if (posJson.success) setPositions(normalizedPositions);
          if (ordJson.success) setOrders(normalizedOrders);
        }
      } catch (err) {
        console.log("LOAD ALL ERROR", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
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
      const res = await fetch("/api/coinswitch/futures/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "cancel failed");
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
        order_type: "LIMIT",
        quantity: size,
        price: Number(position.mark_price),
        reduce_only: true,
        order_context: "close_position",
      };

      const res = await fetch("/api/coinswitch/futures/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "close failed");
      toast.success("Position closing…");
      await loadAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to close position");
    } finally {
       setClosingId(null);
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold">Positions & Orders</h1>
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
          {loading ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : positions.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No open positions.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right">Mark</TableHead>
                    <TableHead className="text-right">Amount (Leveraged)</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                    <TableHead className="text-right">Liq. Price</TableHead>
                    <TableHead className="text-right">Unrealized PnL</TableHead>
                    <TableHead className="text-right">To TP / SL</TableHead>
                    <TableHead className="text-right">Opened</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((pos) => {
                    const pnl = Number(pos.unrealised_pnl);
                    const profit = pnl >= 0;
                    const margin = Number(pos.position_margin);
                    const pnlPct = Number.isFinite(margin) && margin > 0 ? (pnl / margin) * 100 : null;
                    const mark = Number(pos.mark_price);
                    const { tp, sl } = positionTargets(pos, orders);
                    const tpDist = distancePct(mark, tp);
                    const slDist = distancePct(mark, sl);
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
                        <TableCell className="text-right tabular-nums">{money(pos.position_size)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(pos.avg_entry_price)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(pos.mark_price)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {(() => {
                            const notional = Number(pos.position_size) * Number(pos.avg_entry_price);
                            const margin = Number(pos.position_margin);
                            if (!Number.isFinite(notional)) return "—";
                            const marginText = Number.isFinite(margin) && margin > 0 ? `${money(margin)} USDT` : "—";
                            return `${marginText} (${money(notional)} USDT)`;
                          })()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{money(pos.position_margin)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{money(pos.liquidation_price)}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${profit ? "text-emerald-400" : "text-red-400"}`}>
                          {profit ? "+" : ""}
                          {pnl.toFixed(4)}
                          {pnlPct != null && <span className="ml-1 text-xs opacity-80">({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</span>}
                        </TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap">
                          <span className="text-emerald-400">
                            TP {tpDist != null ? `${tpDist >= 0 ? "+" : ""}${tpDist.toFixed(2)}%` : "—"}
                          </span>
                          <span className="text-muted-foreground"> · </span>
                          <span className="text-red-400">
                            SL {slDist != null ? `${slDist >= 0 ? "+" : ""}${slDist.toFixed(2)}%` : "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
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
          {loading ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No open orders.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Trigger (TP/SL)</TableHead>
                    <TableHead className="text-right">Est. PnL</TableHead>
                    <TableHead className="text-right">Placed</TableHead>
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
                      <TableCell className="text-right tabular-nums">{money(order.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(order.price)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {(() => {
                          const amount = Number(order.quantity) * Number(order.price);
                          return Number.isFinite(amount) && amount > 0 ? `${money(amount)} USDT` : "—";
                        })()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {order.trigger_price != null ? money(order.trigger_price) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {(() => {
                          const pnl = estimatePnl(order, positions);
                          if (pnl == null) return <span className="text-muted-foreground">—</span>;
                          const pos = positions.find(
                            (p) => p.symbol === order.symbol && Number(p.position_size) > 0,
                          );
                          const margin = Number(pos?.position_margin);
                          const pct = Number.isFinite(margin) && margin > 0 ? (pnl / margin) * 100 : null;
                          return (
                            <span className={`font-medium tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {pnl >= 0 ? "+" : ""}
                              {pnl.toFixed(4)} USDT
                              {pct != null && <span className="ml-1 text-xs opacity-80">({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)</span>}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">
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
