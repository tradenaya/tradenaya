"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { fetchJson } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import TradingChart from "@/components/TradingChart";
import TickerBar from "@/components/TickerBar";
import PlaceOrderPanel from "@/components/PlaceOrderPanel";
import { futuresTickerSocket, TickerData } from "@/lib/coinswitch/futuresTickerSocket";
import { positionSideLabel, sideBadgeClass } from "@/components/trading/terms";
import { cn } from "@/lib/utils";
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider";
import { convertUsdt, currencyLabel, getCurrencyState, formatDisplayPrice } from "@/lib/currency/store";

interface Position {
  position_id: string;
  symbol: string;
  position_side: "LONG" | "SHORT";
  leverage: string;
  position_size: string;
  avg_entry_price: string;
  mark_price: string;
  liquidation_price: string;
  unrealised_pnl: string;
  position_margin: string;
}

interface OpenOrder {
  order_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  status: string;
  order_type: string;
  quantity: string;
  exec_quantity: string;
  price?: string;
  trigger_price?: string;
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
  return formatDisplayPrice(value);
}

function balance(value: string | number | null | undefined): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const conv = convertUsdt(num);
  const state = getCurrencyState();
  return `${(conv ?? num).toLocaleString(state.currency === "INR" && conv != null ? "en-IN" : "en-US", { maximumFractionDigits: 2 })} ${currencyLabel()}`;
}

export default function TradePage() {
  const params = useParams();
  const router = useRouter();
  const symbol = (params.symbol as string).toUpperCase();

  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    // React-hooks rule: reset live ticker when the symbol changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTicker(null);
    futuresTickerSocket.connect(symbol, (data) => setTicker(data));
    return () => futuresTickerSocket.disconnect();
  }, [symbol]);

  return (
    <div className="min-h-screen px-3 sm:px-6 py-5">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (window.history.length > 1) {
              router.back();
            } else {
              router.push("/dashboard/market");
            }
          }}
        >
          <ChevronLeft size={16} /> Back
        </Button>
        <h1 className="text-xl sm:text-2xl brand-heading">{symbol} Futures</h1>
      </div>

      {/* Chart takes the main screen first — compact position & order cards sit beside it */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="bg-card">
            <CardContent className="flex h-[340px] sm:h-[440px] lg:h-[540px] items-center justify-center p-0">
              <TradingChart symbol={symbol} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <CompactPositionCard symbol={symbol} />
          <CompactOrdersCard symbol={symbol} />
        </div>
      </div>

      {/* Market stats — below the chart so it never pushes the price area down */}
      <div className="mt-5">
        <TickerBar ticker={ticker} />
      </div>

      {/* Manual entry — hidden until the user toggles it on */}
      <div className="mt-6">
        <Button
          variant="outline"
          className="flex w-full items-center justify-between border-border bg-card px-4 py-6 text-base font-semibold"
          onClick={() => setManualOpen((open) => !open)}
        >
          <span>Manual Entry</span>
          <ChevronDown className={cn("transition-transform", manualOpen && "rotate-180")} size={18} />
        </Button>

        <div className={cn("overflow-hidden transition-all", manualOpen ? "mt-4 max-h-[3000px]" : "max-h-0")}>
          <PlaceOrderPanel symbol={symbol} markPrice={ticker ? Number(ticker.c) : null} />
        </div>
      </div>
    </div>
  );
}

function useSymbolData(symbol: string) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [positionsError, setPositionsError] = useState<unknown>(null);
  const [ordersError, setOrdersError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [posRes, ordRes] = await Promise.allSettled([
        fetchJson<{ data?: Position[] }>(`/api/coinswitch/futures/positions?symbol=${symbol}`),
        fetchJson<{ data?: unknown }>(`/api/coinswitch/futures/open-orders?symbol=${symbol}`),
      ]);
      if (cancelled) return;
      if (posRes.status === "fulfilled") {
        setPositions(posRes.value.data ?? []);
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
    };
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol]);

  return { positions, orders, loading, positionsError, ordersError };
}

function CompactCardSkeleton() {
  return (
    <Card className="bg-card">
      <CardContent className="space-y-2 p-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </CardContent>
    </Card>
  );
}

function CompactPositionCard({ symbol }: { symbol: string }) {
  const { positions, loading, positionsError } = useSymbolData(symbol);
  const pos = positions[0];
  useDisplayCurrency();

  if (loading) return <CompactCardSkeleton />;
  if (positionsError != null && positions.length === 0) {
    return <ErrorState error={positionsError} title={`Couldn't load your ${symbol.replace(/USDT$/, "")} position`} compact />;
  }

  return (
    <Card className="bg-card">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-muted-foreground">Open Position</span>
          <Badge className="bg-zinc-500/15 text-zinc-400">{positions.length}</Badge>
        </div>
        {!pos ? (
          <p className="text-sm text-muted-foreground">No open position on {symbol.replace(/USDT$/, "")}.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <Badge className={sideBadgeClass(pos.position_side)}>
                {positionSideLabel(pos.position_side)} {pos.leverage}x
              </Badge>
              <span
                className={cn(
                  "font-medium tabular-nums",
                  Number(pos.unrealised_pnl) >= 0 ? "text-emerald-400" : "text-red-400",
                )}
              >
                {Number(pos.unrealised_pnl) >= 0 ? "+" : ""}{balance(pos.unrealised_pnl)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Size</span>
              <span className="text-foreground">{qty(pos.position_size)} {symbol.replace(/USDT$/, "")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Entry</span>
              <span className="text-foreground">{money(pos.avg_entry_price)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mark</span>
              <span className="text-foreground">{money(pos.mark_price)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Margin</span>
              <span className="text-foreground">{balance(pos.position_margin)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Liq. price</span>
              <span className="text-red-400">{money(pos.liquidation_price)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompactOrdersCard({ symbol }: { symbol: string }) {
  const { orders, loading, ordersError } = useSymbolData(symbol);

  if (loading) return <CompactCardSkeleton />;
  if (ordersError != null && orders.length === 0) {
    return <ErrorState error={ordersError} title={`Couldn't load your ${symbol.replace(/USDT$/, "")} open orders`} compact />;
  }

  return (
    <Card className="bg-card">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-muted-foreground">Open Orders</span>
          <Badge className="bg-zinc-500/15 text-zinc-400">{orders.length}</Badge>
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open orders on {symbol.replace(/USDT$/, "")}.</p>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => (
              <div key={order.order_id} className="rounded-lg bg-muted/40 p-2.5 text-sm">
                <div className="mb-1 flex items-center gap-2">
                  <Badge className={sideBadgeClass(order.side)}>{positionSideLabel(order.side === "BUY" ? "LONG" : "SHORT")}</Badge>
                  <span className="text-xs text-muted-foreground">{order.order_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Qty</span>
                  <span className="text-foreground">{qty(order.quantity)} {symbol.replace(/USDT$/, "")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span className="text-foreground">{money(order.trigger_price ?? order.price)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
