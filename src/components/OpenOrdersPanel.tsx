"use client";

import { useEffect, useState } from "react";

interface OpenOrder {
  order_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  status: string;
  order_type: string;
  quantity: string;
  exec_quantity: string;
  price: string;
  created_at: number;
}

export default function OpenOrdersPanel({ symbol }: { symbol: string }) {
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchOpenOrders() {
    try {
      const res = await fetch(`/api/coinswitch/futures/open-orders?symbol=${symbol}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.success) {
        setOrders(json.data.orders ?? []);
        setError(null);
      } else {
        setError(json.message ?? "failed to load open orders");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    fetchOpenOrders();
    const interval = setInterval(fetchOpenOrders, 5000);
    return () => clearInterval(interval);
  }, [symbol]);

  async function cancelOrder(orderId: string) {
    setCancelingId(orderId);
    try {
      const res = await fetch("/api/coinswitch/futures/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message ?? "cancel failed");
      }
      // Per docs: status becomes CANCELLATION_RAISED first, resolves to
      // CANCELLED shortly after. Refresh the list to reflect that.
      await fetchOpenOrders();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCancelingId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-zinc-900 rounded-xl p-5 mt-5 text-zinc-500 text-sm">
        Loading open orders…
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 rounded-xl p-5 mt-5">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Open Orders</h2>
        <button
          onClick={fetchOpenOrders}
          className="text-xs text-zinc-500 hover:text-white"
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {orders.length === 0 ? (
        <p className="text-zinc-500 text-sm">No open orders on {symbol}.</p>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <div
              key={order.order_id}
              className="bg-zinc-800 rounded-lg p-3 text-sm flex items-center justify-between"
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
                  <span className="text-zinc-400 text-xs">{order.order_type}</span>
                  <span className="text-zinc-600 text-xs">{order.status}</span>
                </div>
                <div className="text-zinc-300">
                  {order.quantity} {symbol.replace("USDT", "")} @ {order.price} USDT
                </div>
                {Number(order.exec_quantity) > 0 && (
                  <div className="text-zinc-500 text-xs mt-1">
                    Filled: {order.exec_quantity} / {order.quantity}
                  </div>
                )}
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
    </div>
  );
}