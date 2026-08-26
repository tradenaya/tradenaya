"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { orderTypeLabel, sideBadgeClass, sideLabel } from "@/components/trading/terms";

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
        setOrders(json.data ?? json.data?.orders ?? []);
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
      toast.success("Order cancelled");
      await fetchOpenOrders();
    } catch (err: any) {
      toast.error(err.message);
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
        {loading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
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
                    {order.quantity} {symbol.replace("USDT", "")} @ {order.price} USDT
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
