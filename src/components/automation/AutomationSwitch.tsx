"use client";

import { useEffect, useState } from "react";
import { Loader2, Power, Settings2, TrendingUp, Wallet } from "lucide-react";
import { toast } from "sonner";
import { CoinSearchSelect } from "@/components/automation/CoinSearchSelect";
import { formatPrice } from "@/components/analytics/format";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BotRecord {
  id: number;
  symbol: string;
  timeframe: string;
  strategy: string;
  leverage: number;
  capital: number;
  status: string;
  desiredStatus: string;
  lastError: string | null;
}

interface InstrumentInfo {
  min_leverage: string;
  max_leverage: string;
  min_base_quantity: string;
  base_quantity_step_size: string;
  status?: string;
}

interface CoinAnalysis {
  symbol: string;
  timeframe: string;
  price: number;
  signal: "BUY" | "SELL" | "WAIT";
  side: "LONG" | "SHORT" | null;
  confidence: number;
  score: number;
  trend: "UP" | "DOWN" | "SIDEWAYS";
  factors: {
    regime: number;
    trend: number;
    structure: number;
    momentum: number;
    participation: number;
    volatility: number;
    entryLocation: number;
    riskReward: number;
  };
  vetoes: string[];
  reasons: string[];
  reasonsText: string;
  atrPct: number | null;
  rsi: number | null;
  adx: number | null;
  volumeRatio: number | null;
  quoteVolume24h?: number;
  change24h?: number;
  fundingRate?: number;
}

const DEFAULT_SETTINGS = {
  symbol: "BTCUSDT",
  timeframe: "1h",
  leverage: "5",
  capital: "100",
};

const runningStates = ["RUNNING", "STARTING", "RECOVERING", "ANALYZING", "TRADE_PLANNED", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED", "STOPPING"];

export function AutomationSwitch() {
  const [bots, setBots] = useState<BotRecord[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmTurnOff, setConfirmTurnOff] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [submitting, setSubmitting] = useState(false);
  const [schedulerActive, setSchedulerActive] = useState<boolean | null>(null);

  const [wallet, setWallet] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [instrument, setInstrument] = useState<InstrumentInfo | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [capitalMode, setCapitalMode] = useState<"fixed" | "percent">("fixed");
  const [walletPercent, setWalletPercent] = useState("10");

  const [analyzingCoins, setAnalyzingCoins] = useState(false);
  const [coinAnalysis, setCoinAnalysis] = useState<CoinAnalysis[] | null>(null);
  const [analysisError, setAnalysisError] = useState("");

  async function analyzeCoins() {
    setAnalyzingCoins(true);
    setAnalysisError("");
    setCoinAnalysis(null);
    try {
      const res = await fetch(
        `/api/bots/analyze-coins?timeframe=${encodeURIComponent(settings.timeframe)}&limit=25`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to analyze coins");
      setCoinAnalysis(Array.isArray(json.data) ? json.data : []);
    } catch (err: unknown) {
      setAnalysisError(err instanceof Error ? err.message : "Failed to analyze coins");
    } finally {
      setAnalyzingCoins(false);
    }
  }

  async function loadBots() {
    try {
      const res = await fetch("/api/bots", { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || "Failed to load automation");
      setBots(Array.isArray(json.data) ? json.data : []);
      setSchedulerActive(json.schedulerActive ?? null);
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load automation");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/bots", { cache: "no-store" });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || "Failed to load automation");
        if (!cancelled) {
          setBots(Array.isArray(json.data) ? json.data : []);
          setSchedulerActive(json.schedulerActive ?? null);
          setError("");
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load automation");
        }
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;

    fetch("/api/coinswitch/futures/wallet-balance", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          const usdt = json.data?.base_asset_balances?.find(
            (b: { base_asset: string }) => String(b.base_asset).toUpperCase() === "USDT",
          );
          const bal = Number(usdt?.balances?.total_available_balance);
          setWallet(Number.isFinite(bal) ? bal : null);
        }
      })
      .catch(() => {
        if (!cancelled) setWallet(null);
      })
      .finally(() => {
        if (!cancelled) setWalletLoading(false);
      });

    const sym = settings.symbol.trim().toUpperCase();
    fetch("/api/coinswitch/futures/instrument-info", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          const info = json.data?.[sym] ?? null;
          setInstrument(info ?? null);
          if (info) {
            setSettings((s) => ({
              ...s,
              leverage: clampLeverage(s.leverage, info),
            }));
          }
        }
      })
      .catch(() => {
        if (!cancelled) setInstrument(null);
      });

    fetch("/api/coinswitch/futures/ticker", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.message || "Failed to load price");
        const data = json.data ?? {};
        const row = data[sym] ?? data[sym.toLowerCase()];
        const p = Number(row?.last_price);
        setPrice(Number.isFinite(p) && p > 0 ? p : null);
      })
      .catch(() => {
        if (!cancelled) setPrice(null);
      });

    return () => {
      cancelled = true;
    };
  }, [settingsOpen, settings.symbol]);

  const botList = bots ?? [];
  const anyRunning = botList.some((b) => runningStates.includes(b.desiredStatus ?? b.status));
  const serverOffline = schedulerActive === false;

  async function startAll(ids: number[]) {
    for (const id of ids) {
      const res = await fetch(`/api/bots/${id}/start`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || `Failed to start bot ${id}`);
    }
  }

  async function stopAll(ids: number[]) {
    for (const id of ids) {
      const res = await fetch(`/api/bots/${id}/stop`, { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || `Failed to stop bot ${id}`);
    }
  }

  function effectiveCapital(): number | null {
    if (capitalMode === "percent") {
      if (wallet == null) return null;
      const pct = Number(walletPercent);
      if (!Number.isFinite(pct)) return null;
      return wallet * (pct / 100);
    }
    const amount = Number(settings.capital);
    return Number.isFinite(amount) ? amount : null;
  }

  function validate(): string | null {
    const symbol = settings.symbol.trim().toUpperCase();
    if (!symbol) return "Trading symbol is required.";

    if (instrument) {
      const minL = Number(instrument.min_leverage);
      const maxL = Number(instrument.max_leverage);
      const lev = Number(settings.leverage);
      if (Number.isFinite(minL) && Number.isFinite(maxL) && (lev < minL || lev > maxL)) {
        return `Leverage must be between ${minL}x and ${maxL}x for ${symbol}.`;
      }
    }

    if (capitalMode === "percent") {
      const pct = Number(walletPercent);
      if (!Number.isFinite(pct) || pct <= 0) return "Wallet percent must be greater than zero.";
      if (pct > 100) return "Wallet percent cannot exceed 100%.";
    } else {
      const capital = Number(settings.capital);
      if (!Number.isFinite(capital) || capital <= 0) return "Capital per trade must be greater than zero.";
    }

    if (wallet != null) {
      const alloc = effectiveCapital();
      if (alloc != null && alloc > wallet) {
        return `Insufficient wallet balance. You need ${alloc.toFixed(2)} USDT but only ${wallet.toFixed(2)} USDT is available.`;
      }
    }

    if (minOrderIssue) {
      return `Cannot start automation — ${minOrderIssue}`;
    }

    if (notActiveIssue) {
      return `Cannot start automation — ${notActiveIssue}`;
    }

    return null;
  }

  async function createBot() {
    const symbol = settings.symbol.trim().toUpperCase();
    const allocated = effectiveCapital() ?? (Number(settings.capital) || 0);
    const body = {
      symbol,
      timeframe: settings.timeframe,
      leverage: Number(settings.leverage),
      capitalMode,
      capital: allocated,
      walletPercent: capitalMode === "percent" ? Number(walletPercent) : undefined,
      maxRiskPerTrade: 1,
      dailyLossLimit: 5,
    };
    const res = await fetch("/api/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || "Failed to start automated trading");
  }

  async function turnOn() {
    setBusy(true);
    setError("");
    try {
      if (botList.length === 0) {
        await createBot();
        toast.success("Automated trading started");
      } else {
        const stopped = botList
          .filter((b) => !runningStates.includes(b.desiredStatus ?? b.status))
          .map((b) => b.id);
        if (stopped.length > 0) {
          await startAll(stopped);
          toast.success("Automated trading resumed");
        }
      }
      await loadBots();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to start automated trading";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError("");
    try {
      const running = botList
        .filter((b) => runningStates.includes(b.desiredStatus ?? b.status))
        .map((b) => b.id);
      if (running.length > 0) {
        await stopAll(running);
        toast.success("Automated trading stopped");
      }
      await loadBots();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to stop automated trading";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function submitSettings() {
    setSubmitting(true);
    setError("");
    try {
      const validation = validate();
      if (validation) {
        setError(validation);
        return;
      }
      await createBot();
      toast.success("Automated trading started");
      setSettingsOpen(false);
      await loadBots();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to start automated trading";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  const runningCount = botList.filter((b) => runningStates.includes(b.desiredStatus ?? b.status)).length;
  const levRange = leverageRange(instrument);

  const minOrderIssue = (() => {
    if (!instrument || price == null || !(price > 0)) return null;
    const minQty = Number(instrument.min_base_quantity);
    const step = Number(instrument.base_quantity_step_size);
    const lev = Number(settings.leverage);
    const alloc = effectiveCapital();
    if (!Number.isFinite(minQty) || minQty <= 0 || alloc == null || !Number.isFinite(lev) || lev <= 0) return null;
    const maxPosition = (alloc * lev) / price;
    const floored = Number.isFinite(step) && step > 0 ? Math.floor(maxPosition / step) * step : maxPosition;
    if (floored >= minQty) return null;
    const minNotional = minQty * price;
    const required = minNotional / lev;
    const symbol = settings.symbol.trim().toUpperCase();
    return `Minimum order is ${minQty} ${symbol} (~${minNotional.toFixed(4)} USDT). Your ${alloc.toFixed(4)} USDT at ${lev}x only buys ${Math.max(floored, 0).toFixed(4)} ${symbol}. Raise capital to at least ${required.toFixed(4)} USDT or increase leverage.`;
  })();

  const notActiveIssue = (() => {
    const status = String(instrument?.status ?? "").toUpperCase();
    if (!status || status === "TRADING") return null;
    return `${settings.symbol.trim().toUpperCase()} futures market is not open for trading (status: ${status}). Pick a different market.`;
  })();

  if (bots === null) {
    return (
      <Card className="bg-card">
        <CardContent className="py-6">
          <Skeleton className="h-10 w-2/3 rounded-lg" />
          <Skeleton className="mt-3 h-4 w-1/3 rounded-md" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`bg-card border ${anyRunning ? "border-emerald-500/30" : ""}`}>
      <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl transition ${
              anyRunning ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"
            }`}
          >
            <Power size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-foreground">Automated Trading</h2>
              {serverOffline && anyRunning ? (
                <Badge className="bg-amber-500/15 text-amber-400">Server offline</Badge>
              ) : anyRunning ? (
                <Badge className="bg-emerald-500/15 text-emerald-400">Running</Badge>
              ) : (
                <Badge className="bg-zinc-500/15 text-zinc-400">Stopped</Badge>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {serverOffline && anyRunning
                ? "The trading engine is not running on the server. Start the server and keep it open — automation only runs while the server is online."
                : anyRunning
                  ? `${runningCount} bot${runningCount === 1 ? "" : "s"} active — TradeNaya trades for you.`
                  : "TradeNaya trades for you. Turn it on and it runs your strategy automatically."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {botList.length > 0 && !anyRunning && (
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} title="Edit strategy settings">
              <Settings2 size={14} /> Settings
            </Button>
          )}
          <Button
            size="lg"
            disabled={busy}
            onClick={anyRunning ? () => setConfirmTurnOff(true) : botList.length === 0 ? () => setSettingsOpen(true) : turnOn}
            className={`min-w-32 font-semibold ${
              anyRunning
                ? "bg-red-600/90 hover:bg-red-600 text-white"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}
          >
            {busy && <Loader2 className="animate-spin" />}
            {anyRunning ? "Turn Off" : "Turn On"}
          </Button>
        </div>
      </CardContent>

      {error && (
        <div className="border-t border-border px-6 py-3 text-sm text-red-400">{error}</div>
      )}

      {botList.length > 0 && (
        <div className="border-t border-border px-6 py-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Active strategies</p>
          <div className="flex flex-wrap gap-2">
            {botList.map((bot) => {
              const live = runningStates.includes(bot.desiredStatus ?? bot.status);
              return (
                <div
                  key={bot.id}
                  className={`rounded-lg border px-3 py-2 text-sm ${live ? "border-emerald-500/25 bg-emerald-500/5" : "border-border bg-muted/40"}`}
                >
                  <div className="font-medium text-foreground">{bot.symbol}</div>
                  <div className="text-xs text-muted-foreground">
                    {bot.timeframe} · {bot.leverage}x · {bot.capital} USDT
                  </div>
                  {bot.lastError && <div className="mt-1 text-xs text-red-400">{bot.lastError}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={settingsOpen} onOpenChange={(open) => {
        setSettingsOpen(open);
        if (open) {
          setWallet(null);
          setWalletLoading(true);
        }
      }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Automated trading setup</DialogTitle>
            <DialogDescription>
              TradeNaya trades {settings.symbol} using your strategy with fixed SL and TP protection. You can adjust this later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted/40 p-3 md:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet size={16} />
                  Available futures balance
                </div>
                {walletLoading ? (
                  <Skeleton className="h-5 w-24" />
                ) : wallet != null ? (
                  <span className="font-semibold text-foreground">
                    {wallet.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT
                  </span>
                ) : (
                  <span className="text-sm text-red-400">Unavailable</span>
                )}
              </div>
              {wallet != null && capitalMode === "percent" && effectiveCapital() != null && (
                <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Allocated for trading</span>
                  <span className="font-medium text-foreground">
                    {effectiveCapital()!.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="auto-symbol">Symbol</Label>
              <CoinSearchSelect
                value={settings.symbol}
                onChange={(symbol) => setSettings((s) => ({ ...s, symbol }))}
              />
              <InstrumentStatusBadge
                symbol={settings.symbol}
                instrument={instrument}
                price={price}
              />
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Coin analyzer</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={analyzingCoins}
                  onClick={analyzeCoins}
                  title="Scan the most liquid coins with the full TradiAura factor stack and rank them"
                >
                  {analyzingCoins ? <Loader2 className="animate-spin" /> : <TrendingUp size={14} />}
                  {analyzingCoins ? "Scanning…" : "Find best coins"}
                </Button>
              </div>

              {analysisError && (
                <p className="mt-1.5 text-xs text-red-400">{analysisError}</p>
              )}

              {coinAnalysis && (
                <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {coinAnalysis.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No tradable setups found on the {settings.timeframe} timeframe right now.
                    </p>
                  ) : (
                    coinAnalysis.slice(0, 6).map((coin, index) => {
                      const active = coin.symbol.toUpperCase() === settings.symbol.trim().toUpperCase();
                      return (
                        <div
                          key={coin.symbol}
                          className={`rounded-lg border p-2.5 ${active ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-muted/40"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="text-xs text-muted-foreground">#{index + 1}</span>
                              <span className="truncate font-medium text-foreground">{coin.symbol}</span>
                              <SignalBadge signal={coin.signal} confidence={coin.confidence} />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-foreground">{coin.score}</span>
                              <span className="text-xs text-muted-foreground">/ 100</span>
                              <Button
                                type="button"
                                variant={active ? "ghost" : "outline"}
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => setSettings((s) => ({ ...s, symbol: coin.symbol.toUpperCase() }))}
                              >
                                {active ? "Selected" : "Use"}
                              </Button>
                            </div>
                          </div>

                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                              style={{ width: `${Math.min(100, Math.max(0, coin.score))}%` }}
                            />
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>Price {formatPrice(coin.price)}</span>
                            {coin.change24h != null && (
                              <span className={coin.change24h >= 0 ? "text-emerald-400" : "text-red-400"}>
                                {coin.change24h >= 0 ? "+" : ""}
                                {coin.change24h.toFixed(2)}% 24h
                              </span>
                            )}
                            <FactorChip label="Trend" value={coin.factors.trend} />
                            <FactorChip label="Volume" value={coin.factors.participation} />
                            <FactorChip label="Momentum" value={coin.factors.momentum} />
                            <FactorChip label="Entry" value={coin.factors.entryLocation} />
                            {coin.atrPct != null && <span>ATR {coin.atrPct.toFixed(1)}%</span>}
                          </div>

                          {coin.reasonsText && (
                            <p className="mt-1 truncate text-xs text-muted-foreground" title={coin.reasons.join("\n")}>
                              {coin.reasonsText}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Timeframe</Label>
              <Select value={settings.timeframe} onValueChange={(v) => setSettings((s) => ({ ...s, timeframe: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["5m", "15m", "30m", "1h", "4h", "1d"].map((tf) => (
                    <SelectItem key={tf} value={tf}>
                      {tf}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="auto-leverage">Leverage</Label>
                <span className="font-semibold text-foreground">{settings.leverage}x</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={levRange.min}
                  max={levRange.max}
                  step={1}
                  value={leverageValue(settings.leverage, instrument)}
                  onChange={(e) => setSettings((s) => ({ ...s, leverage: e.target.value }))}
                  className="flex-1 accent-emerald-500"
                />
                <span className="w-12 text-right font-semibold text-foreground">{settings.leverage}x</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {instrument
                  ? `${instrument.min_leverage}x – ${instrument.max_leverage}x available for ${settings.symbol.trim().toUpperCase()}`
                  : "1x – 100x available"}
              </p>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label>Capital mode</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCapitalMode("fixed")}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    capitalMode === "fixed"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Fixed amount
                </button>
                <button
                  type="button"
                  onClick={() => setCapitalMode("percent")}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    capitalMode === "percent"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  % of wallet
                </button>
              </div>
            </div>

            {capitalMode === "fixed" ? (
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="auto-capital">Capital per trade (USDT)</Label>
                <Input
                  id="auto-capital"
                  type="number"
                  min={0}
                  step="any"
                  value={settings.capital}
                  onChange={(e) => setSettings((s) => ({ ...s, capital: e.target.value }))}
                  placeholder="0.00"
                />
                {wallet != null && Number(settings.capital) > wallet && (
                  <p className="text-xs text-red-400">
                    Exceeds your available balance of {wallet.toFixed(2)} USDT.
                  </p>
                )}
                {notActiveIssue && <p className="text-xs text-red-400">{notActiveIssue}</p>}
                {minOrderIssue && <p className="text-xs text-red-400">{minOrderIssue}</p>}
              </div>
            ) : (
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="auto-wallet-percent">Percent of wallet</Label>
                <Input
                  id="auto-wallet-percent"
                  type="number"
                  min={1}
                  max={100}
                  step="any"
                  value={walletPercent}
                  onChange={(e) => setWalletPercent(e.target.value)}
                  placeholder="10"
                />
                {wallet != null && effectiveCapital() != null && (
                  <p className="text-xs text-muted-foreground">
                    ≈ {effectiveCapital()!.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT
                  </p>
                )}
                {notActiveIssue && <p className="text-xs text-red-400">{notActiveIssue}</p>}
                {minOrderIssue && <p className="text-xs text-red-400">{minOrderIssue}</p>}
              </div>
            )}

            {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400 md:col-span-2">{error}</div>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={submitting} onClick={submitSettings}>
              {submitting ? "Starting…" : "Start automated trading"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={confirmTurnOff}
        onOpenChange={setConfirmTurnOff}
        title="Stop automated trading"
        description="This will stop all running bots and cancel their open orders. You will need to resume manually."
        confirmLabel="Stop automation"
        destructive
        loading={busy}
        onConfirm={turnOff}
      />
    </Card>
  );
}

function leverageRange(instrument: InstrumentInfo | null): { min: number; max: number } {
  const rawMin = Number(instrument?.min_leverage);
  const rawMax = Number(instrument?.max_leverage);
  const min = Number.isFinite(rawMin) && rawMin >= 1 ? Math.floor(rawMin) : 1;
  const max = Number.isFinite(rawMax) && rawMax >= min ? Math.floor(rawMax) : 100;
  return { min, max };
}

function leverageValue(current: string, instrument: InstrumentInfo | null): number {
  const { min, max } = leverageRange(instrument);
  const value = Number(current);
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function clampLeverage(current: string, instrument: InstrumentInfo): string {
  const max = Number(instrument.max_leverage);
  const value = Number(current);
  if (Number.isFinite(value) && Number.isFinite(max) && value > max) return String(max);
  return current;
}

function SignalBadge({ signal, confidence }: { signal: CoinAnalysis["signal"]; confidence: number }) {
  if (signal === "BUY") {
    return (
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
        BUY {Math.round(confidence * 100)}%
      </span>
    );
  }
  if (signal === "SELL") {
    return (
      <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
        SELL {Math.round(confidence * 100)}%
      </span>
    );
  }
  return (
    <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">WAIT</span>
  );
}

function FactorChip({ label, value }: { label: string; value: number }) {
  const percent = Math.round((Number.isFinite(value) ? value : 0) * 100);
  const color = percent > 0 ? "text-emerald-400" : percent < 0 ? "text-red-400" : "text-muted-foreground";
  return (
    <span className={`${color}`}>
      {label} {percent > 0 ? "+" : ""}
      {percent}
    </span>
  );
}

function InstrumentStatusBadge({
  symbol,
  instrument,
  price,
}: {
  symbol: string;
  instrument: InstrumentInfo | null;
  price: number | null;
}) {
  const status = String(instrument?.status ?? "").toUpperCase();
  const active = status === "TRADING";

  if (!instrument) {
    return (
      <p className="text-xs text-muted-foreground">
        No instrument data for {symbol.trim().toUpperCase() || "this symbol"}. It may not be tradable via the API.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {active ? (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-400">
          Market open — status TRADING
        </span>
      ) : (
        <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-medium text-red-400">
          Market closed (status: {status})
        </span>
      )}
      {instrument.min_leverage != null && instrument.max_leverage != null && (
        <span className="text-muted-foreground">
          {instrument.min_leverage}x–{instrument.max_leverage}x leverage
        </span>
      )}
      {instrument.min_base_quantity != null && price != null && price > 0 && (
        <span className="text-muted-foreground">
          Min order {Number(instrument.min_base_quantity).toLocaleString()} {symbol.trim().toUpperCase()} (~{(Number(instrument.min_base_quantity) * price).toFixed(4)} USDT)
        </span>
      )}
    </div>
  );
}
