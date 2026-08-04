"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Position {
  position_id: string;
  symbol: string;
  position_side: "LONG" | "SHORT";
  leverage: string;
  position_size: string;
  avg_entry_price: string;
  mark_price: string;
  unrealised_pnl: string;
  liquidation_price: string;
  position_margin: string;
  margin_type?: string;
  position_value?: string;
  maint_margin?: string;
}

interface OpenOrder {
  order_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  status: string;
  order_type: string;
  quantity: string;
  exec_quantity: string;
  price: string;
}

export default function AllPositionsPage() {
  const router = useRouter();

  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  async function loadAll() {
    try {
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

      if (posJson.success) setPositions(normalizedPositions);
      if (ordJson.success) setOrders(normalizedOrders);
    } catch (err) {
      console.log("LOAD ALL ERROR", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 8000);
    return () => clearInterval(interval);
  }, []);

  async function cancelOrder(orderId: string) {
    setCancelingId(orderId);
    try {
      await fetch("/api/coinswitch/futures/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      await loadAll();
    } finally {
      setCancelingId(null);
    }
  }

  async function closePosition(position: Position) {
    try {
      const size = Number(position.position_size);
      if (!size || Number.isNaN(size)) return;

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
      await loadAll();
    } catch (err: any) {
      console.log("CLOSE POSITION ERROR", err);
    }
  }

  if (loading) {
    return <div className="p-6 text-[var(--muted-foreground)]">Loading positions & orders…</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-6">
      <h1 className="text-3xl font-bold mb-6">All Positions & Orders</h1>

      <section className="mb-8">
        <h2 className="text-xl font-bold mb-3">Open Positions ({positions.length})</h2>

        {positions.length === 0 ? (
          <p className="text-[var(--muted-foreground)] text-sm">No open positions.</p>
        ) : (
          <div className="space-y-2">
            {positions.map((pos) => {
              const pnl = Number(pos.unrealised_pnl);
              const isProfit = pnl >= 0;

              return (
                <div
                  key={pos.position_id}
                  className="bg-[var(--card)] rounded-lg p-4 flex items-center justify-between hover:bg-[var(--muted)]"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-bold ${
                        pos.position_side === "LONG"
                          ? "bg-emerald-600/20 text-emerald-400"
                          : "bg-red-600/20 text-red-400"
                      }`}
                    >
                      {pos.position_side} {pos.leverage}x
                    </span>
                    <span className="font-semibold">{pos.symbol}</span>
                    <span className="text-[var(--muted-foreground)] text-sm">{pos.position_size} @ {pos.avg_entry_price}</span>
                  </div>

                  <div className="text-right flex items-center gap-2">
                    <div>
                      <div className={isProfit ? "text-emerald-400" : "text-red-400"}>
                        {isProfit ? "+" : ""}
                        {pnl.toFixed(4)} USDT
                      </div>
                      <div className="text-[var(--muted-foreground)] text-xs">Margin: {pos.position_margin} USDT</div>
                    </div>
                    <button
                      onClick={() => closePosition(pos)}
                      className="px-3 py-1.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 text-xs font-semibold"
                    >
                      Close
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">Open Orders ({orders.length})</h2>

        {orders.length === 0 ? (
          <p className="text-[var(--muted-foreground)] text-sm">No open orders.</p>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => (
              <div
                key={order.order_id}
                className="bg-[var(--card)] rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-bold ${
                        order.side === "BUY"
                          ? "bg-emerald-600/20 text-emerald-400"
                          : "bg-red-600/20 text-red-400"
                      }`}
                    >
                      {order.side}
                    </span>
                    <span className="font-semibold">{order.symbol}</span>
                    <span className="text-[var(--muted-foreground)] text-xs">{order.order_type}</span>
                    <span className="text-[var(--muted-foreground)] text-xs">{order.status}</span>
                  </div>
                  <div className="text-[var(--muted-foreground)] text-sm">{order.quantity} @ {order.price} USDT</div>
                </div>

                <button
                  onClick={() => cancelOrder(order.order_id)}
                  disabled={cancelingId === order.order_id}
                  className="px-3 py-1.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 text-xs font-semibold disabled:opacity-50"
                >
                  {cancelingId === order.order_id ? "Canceling…" : "Cancel"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}