"use client";

import { useEffect, useState } from "react";

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

  if (loading) {
    return (
      <div className="bg-[var(--card)] rounded-xl p-5 mt-5 text-[var(--muted-foreground)] text-sm">
        Loading positions…
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="bg-[var(--card)] rounded-xl p-5 mt-5 text-[var(--muted-foreground)] text-sm">
        No open position on {symbol}.
      </div>
    );
  }

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
      await fetchPositions();
    } catch (err: any) {
      console.log("CLOSE POSITION ERROR", err);
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
      await fetchPositions();
    } catch (err: any) {
      console.log("PLACE PROTECTIVE ORDER ERROR", err);
    } finally {
      setPlacingProtectiveId(null);
    }
  }

  return (
    <div className="bg-[var(--card)] rounded-xl p-5 mt-5">
      <h2 className="text-xl font-bold mb-4">Open Position</h2>

      {positions.map((pos) => {
        const pnl = Number(pos.unrealised_pnl);
        const isProfit = pnl >= 0;
        const markPrice = Number(pos.mark_price);
        const liqPrice = Number(pos.liquidation_price);
        const liqDistance =
          markPrice > 0 ? (Math.abs(markPrice - liqPrice) / markPrice) * 100 : 0;
        const liqWarning = liqDistance < 10; // within 10% of liquidation

        const stopLoss = orders.find(
          (order) => order.order_context === "stop_loss" || order.order_type === "STOP_MARKET"
        );
        const takeProfit = orders.find(
          (order) => order.order_context === "take_profit" || order.order_type === "TAKE_PROFIT_MARKET"
        );

        const entryPrice = Number(pos.avg_entry_price);
        const currentMarkPrice = Number(pos.mark_price);
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
          <div key={pos.position_id} className="bg-zinc-800 rounded-lg p-4 text-sm">
            <div className="flex justify-between items-center mb-3">
              <span
                className={`px-2 py-0.5 rounded text-xs font-bold ${
                  pos.position_side === "LONG"
                    ? "bg-emerald-600/20 text-emerald-400"
                    : "bg-red-600/20 text-red-400"
                }`}
              >
                {pos.position_side} {pos.leverage}x
              </span>
              <span className="text-zinc-500 text-xs">{pos.margin_type}</span>
            </div>

            <Row label="Size" value={`${pos.position_size} ${symbol.replace("USDT", "")}`} />
            <Row label="Entry Price" value={pos.avg_entry_price} />
            <Row label="Mark Price" value={pos.mark_price} />
            <Row
              label="Unrealised PnL"
              value={`${isProfit ? "+" : ""}${pnl.toFixed(4)} USDT`}
              valueClass={isProfit ? "text-emerald-400" : "text-red-400"}
            />
            <Row label="Position Margin" value={`${pos.position_margin} USDT`} />
            <Row label="Position Value" value={`${pos.position_value} USDT`} />
            <Row
              label="Liquidation Price"
              value={pos.liquidation_price}
              valueClass={liqWarning ? "text-red-400 font-bold" : undefined}
            />

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-md bg-zinc-700/60 p-2">
                <div className="text-[10px] uppercase tracking-wide text-zinc-400">SL</div>
                <div className="font-semibold text-zinc-200">
                  {stopLoss ? stopLoss.trigger_price ?? stopLoss.price ?? "—" : "Not set"}
                </div>
                <input
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
                  className="mt-2 w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
                />
                <div className="mt-2 text-[10px] text-zinc-400">
                  {slPreview === null ? "Enter a price to preview PnL" : `${slPreview >= 0 ? "+" : ""}${slPreview.toFixed(2)} USDT`}
                </div>
                <button
                  onClick={() => placeProtectiveOrder(pos, "sl")}
                  disabled={placingProtectiveId === pos.position_id}
                  className="mt-2 w-full rounded bg-amber-600/20 px-2 py-1 text-xs font-semibold text-amber-400 hover:bg-amber-600/30 disabled:opacity-60"
                >
                  {placingProtectiveId === pos.position_id ? "Placing…" : "Set SL"}
                </button>
              </div>
              <div className="rounded-md bg-zinc-700/60 p-2">
                <div className="text-[10px] uppercase tracking-wide text-zinc-400">TP</div>
                <div className="font-semibold text-zinc-200">
                  {takeProfit ? takeProfit.trigger_price ?? takeProfit.price ?? "—" : "Not set"}
                </div>
                <input
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
                  className="mt-2 w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
                />
                <div className="mt-2 text-[10px] text-zinc-400">
                  {tpPreview === null ? "Enter a price to preview PnL" : `${tpPreview >= 0 ? "+" : ""}${tpPreview.toFixed(2)} USDT`}
                </div>
                <button
                  onClick={() => placeProtectiveOrder(pos, "tp")}
                  disabled={placingProtectiveId === pos.position_id}
                  className="mt-2 w-full rounded bg-emerald-600/20 px-2 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-60"
                >
                  {placingProtectiveId === pos.position_id ? "Placing…" : "Set TP"}
                </button>
              </div>
            </div>

            <button
              onClick={() => closePosition(pos)}
              disabled={closingId === pos.position_id}
              className="mt-3 w-full rounded-md bg-red-600/20 px-3 py-2 text-sm font-semibold text-red-400 hover:bg-red-600/30 disabled:opacity-60"
            >
              {closingId === pos.position_id ? "Closing…" : "Close now"}
            </button>

            {liqWarning && (
              <p className="text-red-400 text-xs mt-2">
                ⚠️ Mark price is within {liqDistance.toFixed(1)}% of liquidation — consider adding margin or reducing size.
              </p>
            )}
          </div>
        );
      })}
    </div>
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
    <div className="flex justify-between py-1">
      <span className="text-zinc-500">{label}</span>
      <span className={valueClass ?? "text-[var(--foreground)]"}>{value}</span>
    </div>
  );
}