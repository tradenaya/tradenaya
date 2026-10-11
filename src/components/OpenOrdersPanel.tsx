"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { ListSkeleton } from "@/components/ui/skeletons";
import { errorMessage, fetchData, fetchJson } from "@/lib/api-client";
import { orderTypeLabel, sideBadgeClass, sideLabel } from "@/components/trading/terms";
import { formatUsdtAmount } from "@/lib/currency/store";

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
  const [error, setError] = useState<unknown>(null);

  async function fetchOpenOrders() {
    try {
      const data = await fetchData<OpenOrder[] | { orders?: OpenOrder[] }>(`/api/coinswitch/futures/open-orders?symbol=${symbol}`);
      setOrders(Array.isArray(data) ? data : data?.orders ?? []);
      setError(null);
    } catch (err: unknown) {
      setError(err);
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
      await fetchJson("/api/coinswitch/futures/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      toast.success("Order cancelled");
      await fetchOpenOrders();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to cancel order"));
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <Card className="mt-5 bg-card">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Open Orders</CardTitle>
            <CardDescription>{orders.length} open order{orders.length === 1 ? "" : "s"} on {symbol}</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchOpenOrders}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {error != null && orders.length > 0 && (
          <ErrorState error={error} title="Couldn't refresh orders — showing the last loaded data" compact className="mb-3" onRetry={() => void fetchOpenOrders()} />
        )}
        {loading ? (
          <ListSkeleton rows={3} />
        ) : error != null && orders.length === 0 ? (
          <ErrorState error={error} title={`Couldn't load open orders on ${symbol}`} onRetry={() => void fetchOpenOrders()} />
        ) : orders.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No open orders on {symbol}.</p>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => (
              <div
                key={order.order_id}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-3 text-sm"
              >
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <Badge className={sideBadgeClass(order.side)}>{sideLabel(order.side)}</Badge>
                    <span className="text-xs text-muted-foreground">{orderTypeLabel(order.order_type)}</span>
                    <span className="text-xs text-muted-foreground">{order.status}</span>
                  </div>
                  <div className="text-foreground">
                    {order.quantity} {symbol.replace("USDT", "")} @ {formatUsdtAmount(Number(order.price), 4)}
                  </div>
                  {Number(order.exec_quantity) > 0 && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Filled: {order.exec_quantity} / {order.quantity}
                    </div>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                  disabled={cancelingId === order.order_id}
                  onClick={() => cancelOrder(order.order_id)}
                >
                  {cancelingId === order.order_id ? <Loader2 className="animate-spin" /> : <X size={14} />}
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
