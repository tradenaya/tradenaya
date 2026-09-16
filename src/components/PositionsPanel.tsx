"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface Position {
  position_id: string;
  symbol: string;
  position_side: "LONG" | "SHORT";
  leverage: string;
  position_size: string;
  position_value: string;
  position_margin: string;
  maint_margin: string;
  avg_entry_price: string;
  mark_price: string;
  liquidation_price: string;
  unrealised_pnl: string;
  margin_type: string;
  status: string;
}

interface OpenOrder {
  order_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  status: string;
  order_type: string;
  order_context?: string;
  quantity: string;
  exec_quantity: string;
  price?: string;
  trigger_price?: string;
  reduce_only?: boolean;
}

export default function PositionsPanel({ symbol }: { symbol: string }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [protectiveInputs, setProtectiveInputs] = useState<Record<string, { sl: string; tp: string }>>({});
  const [placingProtectiveId, setPlacingProtectiveId] = useState<string | null>(null);

  const fetchPositions = async () => {
    try {
      const [posRes, orderRes] = await Promise.all([
        fetch(`/api/coinswitch/futures/positions?symbol=${symbol}`, { cache: "no-store" }),
        fetch(`/api/coinswitch/futures/open-orders?symbol=${symbol}`, { cache: "no-store" }),
      ]);

      const posJson = await posRes.json();
      const orderJson = await orderRes.json();

      if (posJson.success) {
        setPositions(posJson.data ?? []);
      }
      if (orderJson.success) {
        setOrders(orderJson.data ?? []);
      }
    } catch {
      // stay silent on transient poll failures — next tick will retry
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const runFetch = async () => {
      try {
        await fetchPositions();
      } catch {
        // no-op
      }
      if (!cancelled) {
        setLoading(false);
      }
    };

    runFetch();
    const interval = setInterval(runFetch, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol]);

  async function closePosition(position: Position) {
    try {
      setClosingId(position.position_id);
      const size = Number(position.position_size);
      if (!size || Number.isNaN(size)) return;

      const payload = {
        symbol: position.symbol.toLowerCase(),
        side: position.position_side === "LONG" ? "SELL" : "BUY",
        order_type: "MARKET",
        quantity: size,
        reduce_only: true,
        order_context: "close_position",
      };

      const res = await fetch("/api/coinswitch/futures/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Close failed");
      toast.success("Position closing");
      await fetchPositions();
    } catch (err: any) {
      toast.error(err.message || "Close failed");
    } finally {
      setClosingId(null);
    }
  }

  async function placeProtectiveOrder(position: Position, kind: "sl" | "tp") {
    try {
      setPlacingProtectiveId(position.position_id);
      const size = Number(position.position_size);
      if (!size || Number.isNaN(size)) return;

      const value = protectiveInputs[position.position_id]?.[kind] ?? "";
      const triggerPrice = Number(value || position.mark_price);
      if (!triggerPrice || Number.isNaN(triggerPrice)) return;

      const existing = orders.find((order) => {
        if (kind === "sl") return order.order_context === "stop_loss" || order.order_type === "STOP_MARKET";
        return order.order_context === "take_profit" || order.order_type === "TAKE_PROFIT_MARKET";
      });

      const payload = {
        symbol: position.symbol.toLowerCase(),
        side: position.position_side === "LONG" ? "SELL" : "BUY",
        order_type: kind === "sl" ? "STOP_MARKET" : "TAKE_PROFIT_MARKET",
        quantity: size,
        trigger_price: triggerPrice,
        reduce_only: true,
        order_context: kind === "sl" ? "stop_loss" : "take_profit",
        replace_existing: Boolean(existing?.order_id),
        existing_order_id: existing?.order_id ?? undefined,
      };

      const res = await fetch("/api/coinswitch/futures/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Protective order failed");
      toast.success(kind === "sl" ? "Stop-loss set" : "Take-profit set");
      await fetchPositions();
    } catch (err: any) {
      toast.error(err.message || "Failed to place protective order");
    } finally {
      setPlacingProtectiveId(null);
    }
  }

  if (loading) {
    return <Skeleton className="mt-5 h-40 w-full rounded-lg" />;
  }

  if (positions.length === 0) {
    return (
      <Card className="mt-5 bg-card">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No open position on {symbol}.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-5 bg-card">
      <CardHeader className="border-b">
        <CardTitle>Open Position</CardTitle>
        <CardDescription>{positions.length} active on {symbol}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {positions.map((pos, index) => {
          const pnl = Number(pos.unrealised_pnl);
          const isProfit = pnl >= 0;
          const markPrice = Number(pos.mark_price);
          const liqPrice = Number(pos.liquidation_price);
          const liqDistance =
            markPrice > 0 ? (Math.abs(markPrice - liqPrice) / markPrice) * 100 : 0;
          const liqWarning = liqDistance < 10;

          const stopLoss = orders.find(
            (order) => order.order_context === "stop_loss" || order.order_type === "STOP_MARKET"
          );
          const takeProfit = orders.find(
            (order) => order.order_context === "take_profit" || order.order_type === "TAKE_PROFIT_MARKET"
          );

          const entryPrice = Number(pos.avg_entry_price);
          const size = Number(pos.position_size);
          const slInputValue = Number(protectiveInputs[pos.position_id]?.sl ?? "");
          const tpInputValue = Number(protectiveInputs[pos.position_id]?.tp ?? "");
          const slPreview = Number.isFinite(slInputValue) && slInputValue > 0
            ? (pos.position_side === "LONG" ? (slInputValue - entryPrice) * size : (entryPrice - slInputValue) * size)
            : null;
          const tpPreview = Number.isFinite(tpInputValue) && tpInputValue > 0
            ? (pos.position_side === "LONG" ? (tpInputValue - entryPrice) * size : (entryPrice - tpInputValue) * size)
            : null;

          return (
            <div key={pos.position_id ?? `${pos.symbol}-${index}`} className="rounded-lg bg-muted/50 p-4 text-sm">
              <div className="mb-3 flex items-center justify-between">
                <Badge
                  className={
                    pos.position_side === "LONG"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-red-500/15 text-red-400"
                  }
                >
                  {pos.position_side} {pos.leverage}x
                </Badge>
                <span className="text-xs text-muted-foreground">{pos.margin_type}</span>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
                <Row label="Size" value={`${pos.position_size} ${symbol.replace("USDT", "")}`} />
                <Row label="Entry Price" value={pos.avg_entry_price} />
                <Row label="Mark Price" value={pos.mark_price} />
                <Row
                  label="Unrealised PnL"
                  value={`${isProfit ? "+" : ""}${pnl.toFixed(4)} USDT`}
                  valueClass={isProfit ? "text-emerald-400" : "text-red-400"}
                />
                <Row label="Position Margin" value={`${pos.position_margin} USDT`} />
                <Row
                  label="Liquidation Price"
                  value={pos.liquidation_price}
                  valueClass={liqWarning ? "font-bold text-red-400" : undefined}
                />
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-md bg-muted p-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">SL</div>
                  <div className="font-semibold text-foreground">
                    {stopLoss ? stopLoss.trigger_price ?? stopLoss.price ?? "—" : "Not set"}
                  </div>
                  <Input
                    type="number"
                    value={protectiveInputs[pos.position_id]?.sl ?? ""}
                    onChange={(e) =>
                      setProtectiveInputs((prev) => ({
                        ...prev,
                        [pos.position_id]: {
                          sl: e.target.value,
                          tp: prev[pos.position_id]?.tp ?? "",
                        },
                      }))
                    }
                    placeholder={pos.mark_price}
                    className="mt-2 h-8 text-xs"
                  />
                  <div className="mt-1.5 text-[10px] text-muted-foreground">
                    {slPreview === null ? "Enter a price to preview PnL" : `${slPreview >= 0 ? "+" : ""}${slPreview.toFixed(2)} USDT`}
                  </div>
                  <Button
                    size="sm"
                    className="mt-1.5 w-full bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 hover:text-amber-400"
                    disabled={placingProtectiveId === pos.position_id}
                    onClick={() => placeProtectiveOrder(pos, "sl")}
                  >
                    {placingProtectiveId === pos.position_id && <Loader2 className="animate-spin" />}
                    Set SL
                  </Button>
                </div>
                <div className="rounded-md bg-muted p-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">TP</div>
                  <div className="font-semibold text-foreground">
                    {takeProfit ? takeProfit.trigger_price ?? takeProfit.price ?? "—" : "Not set"}
                  </div>
                  <Input
                    type="number"
                    value={protectiveInputs[pos.position_id]?.tp ?? ""}
                    onChange={(e) =>
                      setProtectiveInputs((prev) => ({
                        ...prev,
                        [pos.position_id]: {
                          sl: prev[pos.position_id]?.sl ?? "",
                          tp: e.target.value,
                        },
                      }))
                    }
                    placeholder={pos.mark_price}
                    className="mt-2 h-8 text-xs"
                  />
                  <div className="mt-1.5 text-[10px] text-muted-foreground">
                    {tpPreview === null ? "Enter a price to preview PnL" : `${tpPreview >= 0 ? "+" : ""}${tpPreview.toFixed(2)} USDT`}
                  </div>
                  <Button
                    size="sm"
                    className="mt-1.5 w-full bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 hover:text-emerald-400"
                    disabled={placingProtectiveId === pos.position_id}
                    onClick={() => placeProtectiveOrder(pos, "tp")}
                  >
                    {placingProtectiveId === pos.position_id && <Loader2 className="animate-spin" />}
                    Set TP
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                className="mt-3 w-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                disabled={closingId === pos.position_id}
                onClick={() => closePosition(pos)}
              >
                {closingId === pos.position_id && <Loader2 className="animate-spin" />}
                Close now
              </Button>

              {liqWarning && (
                <p className="mt-2 text-xs text-red-400">
                  Mark price is within {liqDistance.toFixed(1)}% of liquidation — consider adding
                  margin or reducing size.
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClass ?? "text-foreground"}>{value}</span>
    </div>
  );
}
