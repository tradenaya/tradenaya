"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CandlestickChart, ChevronRight, Eye, Layers, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import WalletSummary from "@/components/WalletSummary";
import { AutomationSwitch } from "@/components/automation/AutomationSwitch";
import { PositionDetailSheet, type ExchangePosition } from "@/components/positions/PositionDetailSheet";
import { formatTimestamp } from "@/components/analytics/format";
import { parseBotConfig, statusMeta, type BotView, fmtMoney, displaySymbol, sideLabel, botName } from "@/components/automation/bot-config";
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider";
import { convertUsdt, currencyLabel, getCurrencyState } from "@/lib/currency/store";

type Position = ExchangePosition;

interface OpenOrder {
  order_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  status: string;
  order_type: string;
  quantity: string;
  price: string;
  trigger_price?: string | number | null;
  created_at?: string | number | null;
}

interface AccountSummary {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  todayPnl: number;
  activeBots: number;
  totalBots: number;
  openPositions: number;
}

interface SummaryRowProps {
  label: string;
  value: string;
}

function SummaryRow({ label, value }: SummaryRowProps) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

function money(value: string | number | null | undefined, decimals = 4): string {
  if (value == null) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const state = getCurrencyState();
  const conv = convertUsdt(num);
  const isInr = state.currency === "INR" && conv != null;
  return (conv ?? num).toLocaleString(isInr ? "en-IN" : "en-US", { maximumFractionDigits: decimals });
}

export default function DashboardPage() {
  const displayCurrency = useDisplayCurrency();
  const router = useRouter();
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [bots, setBots] = useState<BotView[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Position | null>(null);
  const [connection, setConnection] = useState<"connected" | "disconnected">("connected");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [summaryRes, posRes, ordRes, botsRes] = await Promise.all([
          fetch("/api/analytics/summary", { cache: "no-store" }),
          fetch("/api/coinswitch/futures/all-positions", { cache: "no-store" }),
          fetch("/api/coinswitch/futures/all-open-orders", { cache: "no-store" }),
          fetch("/api/bots", { cache: "no-store" }),
        ]);

        const [summaryJson, posJson, ordJson, botsJson] = await Promise.all([
          summaryRes.json(),
          posRes.json(),
          ordRes.json(),
          botsRes.json(),
        ]);

        if (!cancelled) {
          if (summaryJson.success) {
            setSummary(summaryJson.data ?? null);
            setConnection("connected");
          } else {
            setConnection("disconnected");
          }
          if (posJson.success) {
            const list = Array.isArray(posJson.data) ? posJson.data : Array.isArray(posJson?.raw?.data) ? posJson.raw.data : [];
            setPositions(list);
          }
          if (ordJson.success) {
            const list = Array.isArray(ordJson.data) ? ordJson.data : Array.isArray(ordJson?.data?.orders) ? ordJson.data.orders : [];
            setOrders(list);
          }
          if (botsJson.success) setBots(Array.isArray(botsJson.data) ? botsJson.data : []);
        }
      } catch {
        if (!cancelled) setConnection("disconnected");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const sideBadge = (side: string) =>
    side === "LONG" || side === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400";

  const runningBots = useMemo(
    () => bots.filter((b) => (["RUNNING", "STARTING", "RECOVERING", "ANALYZING", "TRADE_PLANNED", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED", "STOPPING"].includes(b.desiredStatus || b.status))),
    [bots],
  );

  return (
    <div className="space-y-5 px-3 sm:px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your account at a glance — automation, positions and PnL.</p>
        </div>
        <Badge
          className={
            connection === "connected"
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-red-500/15 text-red-400"
          }
        >
          {connection === "connected" ? "Connected" : "Disconnected"}
        </Badge>
      </div>

      <AutomationSwitch />

      {/* PnL summary */}
      <Card className="border border-border bg-card">
        <CardHeader className="border-b">
          <CardTitle>PnL summary</CardTitle>
          <CardDescription>From automated trading ({currencyLabel()})</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {loading || !summary ? (
            <Skeleton className="h-28 w-full rounded-lg" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatBox label="Today" value={`${summary.todayPnl >= 0 ? "+" : ""}${money(summary.todayPnl, 2)}`} up={summary.todayPnl >= 0} />
              <StatBox label="Unrealized" value={`${summary.unrealizedPnl >= 0 ? "+" : ""}${money(summary.unrealizedPnl, 2)}`} up={summary.unrealizedPnl >= 0} />
              <StatBox label="Realized" value={`${summary.realizedPnl >= 0 ? "+" : ""}${money(summary.realizedPnl, 2)}`} up={summary.realizedPnl >= 0} />
              <StatBox
                label="Total"
                value={`${summary.totalPnl >= 0 ? "+" : ""}${money(summary.totalPnl, 2)}`}
                up={summary.totalPnl >= 0}
              />
              <div className="col-span-2 sm:col-span-4">
                <SummaryRow label="Open positions" value={String(summary.openPositions)} />
                <SummaryRow label="Active bots" value={`${summary.activeBots} / ${summary.totalBots}`} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active automation card */}
      <Card className="border border-border bg-card">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" /> Active automation
          </CardTitle>
          <CardDescription>
            {runningBots.length === 0 ? "No strategies running." : `${runningBots.length} strategy${runningBots.length === 1 ? "" : "s"} active.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div key="active">
          {loading ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : runningBots.length === 0 ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-lg border border-dashed border-border py-5 px-4 text-center">
              <div className="w-full">
                <p className="text-sm text-muted-foreground">Your automated strategies are off.</p>
                <p className="text-xs text-muted-foreground/70">Turn on Automated Trading above to run them.</p>
              </div>
              <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => router.push("/dashboard/bots")}>
                Open Automation <ChevronRight size={14} />
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {runningBots.slice(0, 4).map((bot) => {
                const cfg = parseBotConfig(bot);
                const st = statusMeta(bot.status);
                const sym = displaySymbol(bot, cfg);
                const dir = sideLabel(cfg.side);
                const name = botName(bot, cfg);
                return (
                  <div
                    key={bot.id}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-bold">
                        {sym.slice(0, 1) || bot.symbol.slice(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          {name && <span className="max-w-36 truncate text-xs font-medium text-muted-foreground" title={name}>{name}</span>}
                          <span className="font-semibold text-foreground">{sym.replace(/USDT$/, "") || "Auto"}</span>
                          {cfg.autoSelect && <span className="text-[10px] font-bold text-emerald-500/80">AUTO</span>}
                          {dir && <Badge className={sideBadge(dir === "Long" ? "LONG" : "SHORT")}>{dir}</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {cfg.timeframe} · {cfg.leverage}x · {fmtMoney(cfg.capital)} {currencyLabel()}
                        </div>
                      </div>
                    </div>
                    <Badge className={`${st.className} shrink-0`}>{st.label}</Badge>
                  </div>
                );
              })}
              <Button size="sm" variant="ghost" className="w-full text-amber-300 hover:text-amber-300" onClick={() => router.push("/dashboard/bots")}>
                Manage automations <ChevronRight size={14} />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border border-border bg-card lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4" /> Open Positions
            </CardTitle>
            <CardDescription>{positions.filter((p) => Number(p.position_size) > 0).length} active position{(positions.filter((p) => Number(p.position_size) > 0).length === 1 ? "" : "s")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {loading ? (
              <Skeleton className="h-40 w-full rounded-lg" />
            ) : positions.filter((p) => Number(p.position_size) > 0).length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No open positions.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {positions.filter((p) => Number(p.position_size) > 0).map((p) => {
                  const up = Number(p.unrealised_pnl ?? 0) >= 0;
                  const _entry = Number(p.avg_entry_price);
                  const _mark = Number(p.mark_price);
                  const _isLong = p.position_side === "LONG";
                  const _pct =
                    _entry > 0 && Number.isFinite(_mark)
                      ? ((_mark - _entry) / _entry) * (_isLong ? 1 : -1) * 100
                      : 0;
                  return (
                    <div
                      key={p.position_id}
                      className="cursor-pointer rounded-lg border border-border bg-background/40 p-3"
                      onClick={() => setSelected(p)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{p.symbol.replace(/USDT$/, "")}</span>
                        <Badge className={sideBadge(p.position_side)}>
                          {p.position_side === "LONG" ? "Long" : "Short"}
                        </Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1.5 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">Size</span><span className="font-medium tabular-nums">{money(p.position_size)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Entry</span><span className="font-medium tabular-nums">{money(p.avg_entry_price)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Mark</span><span className="font-medium tabular-nums">{money(p.mark_price)}</span></div>
                        <div className="flex justify-between col-span-2">
                          <span className="text-muted-foreground">PnL</span>
                          <span className={`font-medium tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
                            {up ? "+" : ""}{money(p.unrealised_pnl)} {currencyLabel()} ({up ? "+" : ""}{_pct.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 gap-1.5 text-xs"
                          onClick={() => router.push(`/trade/${p.symbol}`)}
                        >
                          <CandlestickChart size={13} /> View Chart
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 gap-1.5 text-xs"
                          onClick={() => setSelected(p)}
                        >
                          <Eye size={13} /> Details
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border border-border bg-card">
            <CardHeader className="border-b">
              <CardTitle>Wallet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <WalletSummary />
              <Button variant="outline" className="w-full" onClick={() => router.push("/dashboard/portfolio")}>
                View portfolio
              </Button>
            </CardContent>
          </Card>

          <Card className="border border-border bg-card">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Open Orders
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {loading ? (
                <Skeleton className="h-24 w-full rounded-lg" />
              ) : orders.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No open orders.</p>
              ) : (
                <div className="space-y-2">
                  {orders.slice(0, 6).map((order) => (
                    <div key={order.order_id} className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-background/40 p-3 text-sm">
                      <div className="col-span-2 flex items-center justify-between">
                        <span className="font-medium text-foreground">{order.symbol.replace(/USDT$/, "")}</span>
                        <Badge className={sideBadge(order.side)}>{order.side === "BUY" ? "Long" : "Short"}</Badge>
                      </div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-medium tabular-nums">{order.order_type}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Qty</span><span className="font-medium tabular-nums">{order.quantity}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span className="font-medium tabular-nums">{money(order.price)}</span></div>
                      {order.trigger_price != null && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Trigger</span><span className="font-medium tabular-nums">{money(order.trigger_price)}</span></div>
                      )}
                      <div className={`flex justify-between col-span-2 ${Number(order.quantity) * Number(order.price) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        <span>{currencyLabel()}</span>
                        <span>{money(Number(order.quantity) * Number(order.price))}</span>
                      </div>
                      <div className="col-span-2 text-xs text-muted-foreground">{formatTimestamp(order.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

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

function StatBox({ label, value, up }: { label: string; value: string; up: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
        {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        <span className="ml-1">{value}</span>
      </div>
    </div>
  );
}
