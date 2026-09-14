"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, TrendingUp, Wallet } from "lucide-react";
import { toast } from "sonner";
import { CoinSearchSelect } from "@/components/automation/CoinSearchSelect";
import { formatPrice } from "@/components/analytics/format";
import { computeTradePreview, type TradePreview } from "@/components/automation/trade-preview";
import { TradePreviewPanel } from "@/components/automation/TradePreviewPanel";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  name: "",
  symbol: "BTCUSDT",
  timeframe: "1h",
  leverage: "5",
  autoSelect: false,
  leverageMode: "auto" as "auto" | "manual",
  leveragePercent: "50",
  capital: "100",
  maxRiskPerTrade: "1",
  dailyLossLimit: "5",
  orderExpiryMinutes: "",
  minConfidence: "",
  driftAtr: "2.5",
  regimeTolerancePct: "0.3",
  maxCandles: "24",
  hardCapCandles: "48",
  enableTrailingStop: false,
  trailingDistancePercent: "",
};

interface AutoSelectionPreview {
  symbol: string;
  side: string;
  score: number;
  price: number | null;
  confidence: number;
  atrPct: number | null;
  trend: string;
  leverage: number;
  maxLeverage: number | null;
  minLeverage: number | null;
  minQty: number | null;
  step: number | null;
}

interface CreateBotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function CreateBotDialog({ open, onOpenChange, onCreated }: CreateBotDialogProps) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [wallet, setWallet] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [instrument, setInstrument] = useState<InstrumentInfo | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [capitalMode, setCapitalMode] = useState<"fixed" | "percent">("fixed");
  const [walletPercent, setWalletPercent] = useState("10");

  const [analyzingCoins, setAnalyzingCoins] = useState(false);
  const [coinAnalysis, setCoinAnalysis] = useState<CoinAnalysis[] | null>(null);
  const [analysisError, setAnalysisError] = useState("");

  // ---- Auto-select best coin ----
  const [autoPreview, setAutoPreview] = useState<AutoSelectionPreview | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoError, setAutoError] = useState("");

  const autoPreviewUrl = useMemo(() => {
    if (!settings.autoSelect) return "";
    const params = new URLSearchParams({
      timeframe: settings.timeframe,
      leverageMode: settings.leverageMode,
      leveragePercent: settings.leveragePercent,
      capital: String(Number(settings.capital) || 0),
      maxRiskPerTrade: String(Number(settings.maxRiskPerTrade) || 1),
      config: JSON.stringify({
        timeframe: settings.timeframe,
        leverage: Number(settings.leverage) || 5,
        leverageMode: settings.leverageMode,
        leveragePercent: settings.leverageMode === "manual" ? Number(settings.leveragePercent) : undefined,
        capital: Number(settings.capital) || 0,
        capitalMode,
        walletPercent: capitalMode === "percent" ? Number(walletPercent) : null,
        maxRiskPerTrade: Number(settings.maxRiskPerTrade) || 1,
        dailyLossLimit: Number(settings.dailyLossLimit) || 5,
        enableTrailingStop: settings.enableTrailingStop,
        trailingDistancePercent: settings.enableTrailingStop && settings.trailingDistancePercent ? Number(settings.trailingDistancePercent) : null,
        driftAtr: Number(settings.driftAtr) || 2.5,
        regimeTolerancePct: Number(settings.regimeTolerancePct) || 0.3,
        maxCandles: Number(settings.maxCandles) || 24,
        hardCapCandles: Number(settings.hardCapCandles) || 48,
        orderExpiryMinutes: settings.orderExpiryMinutes ? Number(settings.orderExpiryMinutes) : null,
        minConfidence: settings.minConfidence ? Number(settings.minConfidence) : null,
      }),
    });
    return `/api/bots/auto-selection?${params.toString()}`;
  }, [settings.autoSelect, settings.timeframe, settings.leverageMode, settings.leveragePercent, settings.capital, settings.maxRiskPerTrade, settings.leverage, settings.dailyLossLimit, settings.enableTrailingStop, settings.trailingDistancePercent, settings.driftAtr, settings.regimeTolerancePct, settings.maxCandles, settings.hardCapCandles, settings.orderExpiryMinutes, settings.minConfidence, capitalMode, walletPercent]);

  useEffect(() => {
    if (!settings.autoSelect || !open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setAutoLoading(true);
      setAutoError("");
    });
    fetch(autoPreviewUrl, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) setAutoPreview(json.data?.best ?? null);
        else setAutoError(json.message || "Failed to preview auto-selection");
      })
      .catch(() => {
        if (!cancelled) setAutoError("Failed to preview auto-selection");
      })
      .finally(() => {
        if (!cancelled) setAutoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [autoPreviewUrl, settings.autoSelect, open]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, settings.symbol]);

  const tradePreview = useMemo<TradePreview>(() => {
    return computeTradePreview({
      walletBalance: wallet,
      capitalMode,
      capital: Number(settings.capital) || 0,
      walletPercent: capitalMode === "percent" ? Number(walletPercent) : null,
      leverage: Number(settings.leverage) || 1,
      maxRiskPerTradePct: Number(settings.maxRiskPerTrade) || 0,
      currentPrice: price,
    });
  }, [wallet, capitalMode, settings.capital, walletPercent, settings.leverage, settings.maxRiskPerTrade, price]);

  /* ---- Field-level validation (shown inline as the user types) ---- */
  const fieldErrors = useMemo<Record<string, string | null>>(() => {
    const errs: Record<string, string | null> = {};
    const num = (v: string | undefined | null): number | null => {
      if (v == null || String(v).trim() === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const symbol = settings.symbol.trim().toUpperCase();
    if (!symbol) errs.symbol = "Symbol is required.";

    if (capitalMode === "fixed") {
      const cap = num(settings.capital);
      if (cap == null) errs.capital = "Enter a capital amount (USDT).";
      else if (cap <= 0) errs.capital = "Capital must be greater than 0.";
      else if (wallet != null && cap - wallet > 1e-9) errs.capital = `Exceeds available balance of ${wallet.toFixed(4)} USDT.`;
    } else {
      const pct = num(walletPercent);
      if (pct == null) errs.walletPercent = "Enter a percentage.";
      else if (pct < 1) errs.walletPercent = "Must be at least 1%.";
      else if (pct > 100) errs.walletPercent = "Cannot exceed 100%.";
    }

    if (wallet != null && wallet > 0) {
      const allocatedAmt =
        capitalMode === "fixed"
          ? num(settings.capital)
          : wallet * ((num(walletPercent) ?? 0) / 100);
      if (allocatedAmt != null && allocatedAmt > 0) {
        const headroom = 0.02;
        const feeBuffer = 0.01;
        const safeMax = wallet * (1 - headroom) - feeBuffer;
        if (allocatedAmt > safeMax + 1e-9) {
          const safePct = Math.max(0, (safeMax / wallet) * 100);
          const msg = `Leaves no headroom — the margin would consume nearly all of the ${wallet.toFixed(2)} USDT free balance and the exchange rejects with "Insufficient balance". Use ~${safePct.toFixed(0)}% or less of the available balance (or lower leverage).`;
          if (capitalMode === "fixed") errs.capital = msg;
          else errs.walletPercent = msg;
        }
      }
    }

    const lev = num(settings.leverage);
    if (!settings.autoSelect) {
      if (lev == null || !(lev > 0)) errs.leverage = "Leverage must be a positive number.";
      else if (instrument) {
        const minL = Number(instrument.min_leverage);
        const maxL = Number(instrument.max_leverage);
        if (Number.isFinite(minL) && Number.isFinite(maxL) && (lev < minL || lev > maxL)) {
          errs.leverage = `Leverage must be ${minL}x–${maxL}x for ${symbol}.`;
        }
      }
    } else if (settings.leverageMode === "manual") {
      const pct = num(settings.leveragePercent);
      if (pct == null || pct <= 0 || pct > 100) errs.leverage = "Manual leverage % must be between 1% and 100%.";
    }

    const risk = num(settings.maxRiskPerTrade);
    if (risk == null) errs.maxRisk = "Enter max risk per trade (%).";
    else if (risk < 0) errs.maxRisk = "Max risk cannot be negative.";
    else if (risk === 0) errs.maxRisk = "Max risk must be greater than 0% for a protected trade.";

    const daily = num(settings.dailyLossLimit);
    if (daily == null || daily < 0) errs.dailyLoss = "Enter a daily loss limit ≥ 0 (%).";

    if (settings.orderExpiryMinutes !== undefined && settings.orderExpiryMinutes !== "" && parseFloat(settings.orderExpiryMinutes) > 0) {
      const exp = num(settings.orderExpiryMinutes);
      if (exp == null || exp < 1) errs.orderExpiry = "Order expiry must be ≥ 1 minute.";
    }

    if (settings.minConfidence !== undefined && settings.minConfidence !== "") {
      const conf = num(settings.minConfidence);
      if (conf == null || conf < 0 || conf > 100) errs.minConfidence = "Confidence must be 0–100.";
    }

    const drift = num(settings.driftAtr);
    if (drift == null || drift <= 0) errs.drift = "Drift tolerance must be a positive number of ATRs.";

    const regime = num(settings.regimeTolerancePct);
    if (regime == null || regime < 0) errs.regime = "Regime tolerance must be ≥ 0 (%).";

    const maxCandles = num(settings.maxCandles);
    const hardCap = num(settings.hardCapCandles);
    if (maxCandles == null || maxCandles < 1) errs.maxCandles = "Must be at least 1.";
    if (hardCap == null || hardCap < 1) errs.hardCap = "Must be at least 1.";
    if (maxCandles != null && hardCap != null && maxCandles > hardCap) errs.maxCandles = "Soft cap must not exceed the circuit-breaker cap.";

    if (settings.enableTrailingStop) {
      const ts = num(settings.trailingDistancePercent);
      if (ts == null || ts <= 0) errs.trailing = "Trailing distance must be > 0% when enabled.";
    }

    return errs;
  }, [settings, capitalMode, walletPercent, wallet, instrument]);

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

  const minOrderIssue = (() => {
    if (settings.autoSelect) {
      // Auto mode: evaluate against the CURRENTLY selected coin (symbol, price
      // and the effective leverage the bot would actually use), not the manual
      // fallback symbol/leverage fields.
      const alloc = effectiveCapital();
      if (!autoPreview || autoPreview.price == null || !(autoPreview.price > 0)) return null;
      const minQty = Number(autoPreview.minQty);
      const step = Number(autoPreview.step);
      const lev = Number(autoPreview.leverage);
      if (!Number.isFinite(minQty) || minQty <= 0 || alloc == null || !Number.isFinite(lev) || lev <= 0) return null;
      const price = autoPreview.price;
      const maxPosition = (alloc * lev) / price;
      const floored = Number.isFinite(step) && step > 0 ? Math.floor(maxPosition / step) * step : maxPosition;
      if (floored >= minQty) return null;
      const minNotional = minQty * price;
      const required = minNotional / lev;
      const symbol = autoPreview.symbol.trim().toUpperCase();
      return `Minimum order is ${minQty} ${symbol} (~${minNotional.toFixed(4)} USDT). Your ${alloc.toFixed(4)} USDT at ${lev}x only buys ${Math.max(floored, 0).toFixed(4)} ${symbol}. Raise capital to at least ${required.toFixed(4)} USDT or increase leverage.`;
    }

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

  const levRange = leverageRange(instrument);

  function validate(): string | null {
    for (const key of Object.keys(fieldErrors)) {
      if (key.startsWith("_")) continue;
      if (fieldErrors[key]) return fieldErrors[key]!;
    }

    const symbol = settings.symbol.trim().toUpperCase();
    if (!settings.autoSelect && !symbol) return "Trading symbol is required.";

    if (settings.autoSelect && settings.leverageMode === "manual") {
      const pct = Number(settings.leveragePercent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        return "Manual leverage % must be between 1% and 100% of the selected coin's maximum.";
      }
    }

    if (!settings.autoSelect && instrument) {
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
      const cap = Number(settings.capital);
      if (!Number.isFinite(cap) || cap <= 0) return "Capital per trade must be greater than zero.";
    }

    if (wallet != null) {
      const alloc = effectiveCapital();
      const EXCESS_TOLERANCE = 1e-9;
      if (alloc != null && alloc - wallet > EXCESS_TOLERANCE) {
        return `Insufficient wallet balance. You need ${alloc.toFixed(2)} USDT but only ${wallet.toFixed(2)} USDT is available (including ${(wallet - alloc).toFixed(2)} USDT short).`;
      }
    }

    if (minOrderIssue && !settings.autoSelect) {
      return `Cannot start automation — ${minOrderIssue}`;
    }

    if (notActiveIssue && !settings.autoSelect) {
      return `Cannot start automation — ${notActiveIssue}`;
    }

    if (tradePreview.status === "error" && tradePreview.allocatedCapital > 0 && tradePreview.maxRiskPct > 0 && !tradePreview.riskCompatible) {
      return `Configuration exceeds maximum risk. The estimated SL loss (~${tradePreview.estimatedLoss.toFixed(2)} USDT) exceeds your max risk limit of ${tradePreview.maxRiskUsdt.toFixed(2)} USDT. Reduce your capital allocation, increase max risk %, or let the bot's dynamic SL adapt at runtime.`;
    }

    return null;
  }

  async function createBot() {
    const symbol = settings.symbol.trim().toUpperCase();
    const allocated = effectiveCapital() ?? (Number(settings.capital) || 0);
    const body: Record<string, unknown> = {
      symbol,
      name: settings.name.trim() || undefined,
      timeframe: settings.timeframe,
      leverage: Number(settings.leverage),
      autoSelect: settings.autoSelect,
      leverageMode: settings.leverageMode,
      leveragePercent: settings.leverageMode === "manual" ? Number(settings.leveragePercent) : undefined,
      capitalMode,
      capital: allocated,
      walletPercent: capitalMode === "percent" ? Number(walletPercent) : undefined,
      maxRiskPerTrade: Number(settings.maxRiskPerTrade) || 1,
      dailyLossLimit: Number(settings.dailyLossLimit) || 5,
      enableTrailingStop: settings.enableTrailingStop,
      trailingDistancePercent: settings.enableTrailingStop && settings.trailingDistancePercent ? Number(settings.trailingDistancePercent) : undefined,
      driftAtr: Number(settings.driftAtr) || 2.5,
      regimeTolerancePct: Number(settings.regimeTolerancePct) || 0.3,
      maxCandles: Number(settings.maxCandles) || 24,
      hardCapCandles: Number(settings.hardCapCandles) || 48,
    };
    if (settings.orderExpiryMinutes) body.orderExpiryMinutes = Number(settings.orderExpiryMinutes);
    if (settings.minConfidence) body.minConfidence = Number(settings.minConfidence);
    const res = await fetch("/api/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || "Failed to start automated trading");
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
      onOpenChange(false);
      onCreated?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to start automated trading";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (open) {
          setWallet(null);
          setWalletLoading(true);
          setError("");
        }
      }}
    >
      <DialogContent className="w-[95vw] max-h-[90dvh] flex flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Automated trading setup</DialogTitle>
          <DialogDescription>
            {settings.autoSelect
              ? "Tradenaya continuously analyzes eligible coins and trades the strongest current opportunity (LONG or SHORT), rotating as the market changes."
              : `Tradenaya trades ${settings.symbol} using your strategy with fixed SL and TP protection. You can adjust this later.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto grid gap-4 md:grid-cols-2 py-2">
          <div className="md:col-span-2">
            <Label htmlFor="bot-name">Bot name (optional)</Label>
            <Input
              id="bot-name"
              value={settings.name}
              onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value }))}
              placeholder="e.g. BTC Scalper, Trend Follower"
              maxLength={100}
              className="mt-1.5"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              A label to identify this bot in the dashboard. You can change this later.
            </p>
          </div>

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

          <div className="md:col-span-2">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <input
                  id="auto-select-toggle"
                  type="checkbox"
                  checked={settings.autoSelect}
                  onChange={(e) => setSettings((s) => ({ ...s, autoSelect: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-emerald-500"
                />
                <Label htmlFor="auto-select-toggle" className="mb-0">Auto-select best coin</Label>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {settings.autoSelect
                ? "The bot will automatically select the strongest current trading opportunity (LONG or SHORT) and rotate as the market changes."
                : "The bot trades the fixed symbol you select below."}
            </p>
          </div>

          {settings.autoSelect && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3 md:col-span-2">
              <div className="space-y-1.5">
                <Label>Leverage mode</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSettings((s) => ({ ...s, leverageMode: "auto" }))}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      settings.leverageMode === "auto"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettings((s) => ({ ...s, leverageMode: "manual" }))}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      settings.leverageMode === "manual"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Manual %
                  </button>
                </div>
              </div>

              {settings.leverageMode === "manual" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Leverage preference</Label>
                    <span className="font-semibold text-foreground">{settings.leveragePercent}%</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={leveragePercentValue(settings.leveragePercent)}
                    onChange={(e) => setSettings((s) => ({ ...s, leveragePercent: e.target.value }))}
                    className="w-full accent-emerald-500"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {settings.leveragePercent}% of the selected coin&apos;s maximum leverage.
                    {autoPreview?.maxLeverage
                      ? ` If the coin supports ${autoPreview.maxLeverage}x → bot uses ≈ ${Math.round(
                          (autoPreview.maxLeverage * Number(settings.leveragePercent || 50)) / 100,
                        )}x.`
                      : " The leverage scales per coin automatically (e.g. 50% of a 100x coin → 50x, 50% of a 50x coin → 25x)."}
                  </p>
                  {fieldErrors.leverage && <FieldError>{fieldErrors.leverage}</FieldError>}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Leverage will be calculated automatically for each selected coin based on its maximum
                  leverage, market conditions and risk.
                </p>
              )}

              <div className="space-y-1.5 rounded-lg border border-border bg-background/40 p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Live preview</span>
                  {autoLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
                  ) : (
                    <span className="text-muted-foreground">•</span>
                  )}
                </div>
                {autoError ? (
                  <p className="text-red-400">{autoError}</p>
                ) : autoLoading && !autoPreview ? (
                  <p className="text-muted-foreground">Analyzing market opportunities…</p>
                ) : autoPreview ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <span className="text-muted-foreground">Best opportunity</span>
                    <span className="font-medium text-foreground">
                      {autoPreview.symbol} · {autoPreview.side}
                    </span>
                    <span className="text-muted-foreground">Market confidence</span>
                    <span className="font-medium text-foreground">
                      {autoPreview.confidence != null ? `${Math.round(autoPreview.confidence * 100)}%` : "—"}
                    </span>
                    <span className="text-muted-foreground">Score</span>
                    <span className="font-medium text-foreground">{autoPreview.score}/100</span>
                    <span className="text-muted-foreground">Maximum allowed leverage</span>
                    <span className="font-medium text-foreground">
                      {autoPreview.maxLeverage != null ? `${autoPreview.maxLeverage}x` : "—"}
                    </span>
                    <span className="text-muted-foreground">Selected leverage</span>
                    <span className="font-medium text-foreground">{autoPreview.leverage}x</span>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    No suitable trading opportunity currently meets the bot&apos;s requirements. It will wait
                    and re-check on the next analysis cycle.
                  </p>
                )}
              </div>
            </div>
          )}

          {!settings.autoSelect && (
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
            {fieldErrors.symbol && <FieldError>{fieldErrors.symbol}</FieldError>}
          </div>
          )}

          {!settings.autoSelect && (
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
          )}

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

          {!settings.autoSelect && (
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
            {fieldErrors.leverage && <FieldError>{fieldErrors.leverage}</FieldError>}
            <p className="text-xs text-muted-foreground">
              {instrument
                ? `${instrument.min_leverage}x – ${instrument.max_leverage}x available for ${settings.symbol.trim().toUpperCase()}`
                : "1x – 100x available"}
            </p>
          </div>
          )}

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
              {fieldErrors.capital && <FieldError>{fieldErrors.capital}</FieldError>}
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
              {fieldErrors.walletPercent && <FieldError>{fieldErrors.walletPercent}</FieldError>}
              {wallet != null && effectiveCapital() != null && (
                <p className="text-xs text-muted-foreground">
                  ≈ {effectiveCapital()!.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT
                </p>
              )}
              {notActiveIssue && <p className="text-xs text-red-400">{notActiveIssue}</p>}
              {minOrderIssue && <p className="text-xs text-red-400">{minOrderIssue}</p>}
            </div>
          )}

          <div className="md:col-span-2">
            <div className="border-t border-border pt-4 mt-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Advanced Settings</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-max-risk">Max risk / trade (%)</Label>
            <p className="text-[11px] text-muted-foreground -mt-0.5">
              Maximum percentage of your margin you are willing to lose if SL is hit. This is separate from your capital allocation.
            </p>
            <Input
              id="auto-max-risk"
              type="number"
              min={0}
              step={0.1}
              value={settings.maxRiskPerTrade}
              onChange={(e) => setSettings((s) => ({ ...s, maxRiskPerTrade: e.target.value }))}
              placeholder="1"
            />
            {fieldErrors.maxRisk && <FieldError>{fieldErrors.maxRisk}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-daily-loss">Daily loss limit (%)</Label>
            <Input
              id="auto-daily-loss"
              type="number"
              min={0}
              step={0.1}
              value={settings.dailyLossLimit}
              onChange={(e) => setSettings((s) => ({ ...s, dailyLossLimit: e.target.value }))}
              placeholder="5"
            />
            {fieldErrors.dailyLoss && <FieldError>{fieldErrors.dailyLoss}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-order-expiry">Order expiry (min)</Label>
            <Input
              id="auto-order-expiry"
              type="number"
              min={1}
              value={settings.orderExpiryMinutes ?? ""}
              onChange={(e) => setSettings((s) => ({ ...s, orderExpiryMinutes: e.target.value }))}
              placeholder="Optional"
            />
            {fieldErrors.orderExpiry && <FieldError>{fieldErrors.orderExpiry}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-min-confidence">Min confidence</Label>
            <Input
              id="auto-min-confidence"
              type="number"
              min={0}
              max={100}
              value={settings.minConfidence ?? ""}
              onChange={(e) => setSettings((s) => ({ ...s, minConfidence: e.target.value }))}
              placeholder="Optional"
            />
            {fieldErrors.minConfidence && <FieldError>{fieldErrors.minConfidence}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-drift">Drift tolerance (×ATR)</Label>
            <Input
              id="auto-drift"
              type="number"
              min={0.5}
              step={0.1}
              value={settings.driftAtr}
              onChange={(e) => setSettings((s) => ({ ...s, driftAtr: e.target.value }))}
              placeholder="2.5"
            />
            {fieldErrors.drift && <FieldError>{fieldErrors.drift}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-regime">Regime tolerance (%)</Label>
            <Input
              id="auto-regime"
              type="number"
              min={0}
              step={0.1}
              value={settings.regimeTolerancePct}
              onChange={(e) => setSettings((s) => ({ ...s, regimeTolerancePct: e.target.value }))}
              placeholder="0.3"
            />
            {fieldErrors.regime && <FieldError>{fieldErrors.regime}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-max-candles">Max candles resting (soft)</Label>
            <Input
              id="auto-max-candles"
              type="number"
              min={1}
              value={settings.maxCandles}
              onChange={(e) => setSettings((s) => ({ ...s, maxCandles: e.target.value }))}
              placeholder="24"
            />
            {fieldErrors.maxCandles && <FieldError>{fieldErrors.maxCandles}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="auto-circuit-candles">Circuit-breaker candles</Label>
            <Input
              id="auto-circuit-candles"
              type="number"
              min={1}
              value={settings.hardCapCandles}
              onChange={(e) => setSettings((s) => ({ ...s, hardCapCandles: e.target.value }))}
              placeholder="48"
            />
            {fieldErrors.hardCap && <FieldError>{fieldErrors.hardCap}</FieldError>}
          </div>

          <div className="md:col-span-2">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <input
                  id="auto-trailing"
                  type="checkbox"
                  checked={settings.enableTrailingStop}
                  onChange={(e) => setSettings((s) => ({ ...s, enableTrailingStop: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-emerald-500"
                />
                <Label htmlFor="auto-trailing" className="mb-0">Enable trailing stop</Label>
              </div>
              {settings.enableTrailingStop && (
                <div className="grid w-40 gap-1.5">
                  <Label>Trailing distance (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={settings.trailingDistancePercent ?? ""}
                    onChange={(e) => setSettings((s) => ({ ...s, trailingDistancePercent: e.target.value }))}
                    placeholder="Optional"
                  />
                  {fieldErrors.trailing && <FieldError>{fieldErrors.trailing}</FieldError>}
                </div>
              )}
            </div>
          </div>

          <p className="md:col-span-2 text-[11px] text-muted-foreground">
            Drift tolerance: how far price (in ATRs) can drift past your resting entry before being cancelled. Regime tolerance: ignore EMA flips smaller than this % so you are not cancelled on noise.
          </p>

          <div className="md:col-span-2">
            <div className="border-t border-border pt-4 mt-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Trade Preview</p>
              <TradePreviewPanel preview={tradePreview} />
            </div>
          </div>

          {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400 md:col-span-2">{error}</div>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={submitting} onClick={submitSettings}>
            {submitting ? "Starting…" : "Start automated trading"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-red-400">{children}</p>;
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

function leveragePercentValue(current: string): number {
  const value = Number(current);
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(1, Math.round(value)));
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
