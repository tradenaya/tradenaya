"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { CoinSearchSelect } from "@/components/automation/CoinSearchSelect";
import { formatPrice } from "@/components/analytics/format";
import { computeTradePreview, type TradePreview } from "@/components/automation/trade-preview";
import { TradePreviewPanel } from "@/components/automation/TradePreviewPanel";
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider";
import { convertUsdt, currencyLabel, getCurrencyState } from "@/lib/currency/store";

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
import { parseBotConfig, type BotConfig, type BotView } from "./bot-config";
import {
  type CoinAnalysis,
  type InstrumentInfo,
  FieldError,
  InstrumentStatusBadge,
  SignalBadge,
  FactorChip,
  leverageRange,
} from "./CreateBotDialog";

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

export interface EditBotDialogProps {
  bot: BotView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

function fmtWallet(value: number): string {
  const conv = convertUsdt(value);
  const state = getCurrencyState();
  return `${(conv ?? value).toLocaleString(state.currency === "INR" && conv != null ? "en-IN" : "en-US", { maximumFractionDigits: 2 })} ${currencyLabel()}`;
}

export function EditBotDialog({ bot, open, onOpenChange, onSaved }: EditBotDialogProps) {
  useDisplayCurrency();
  const [cfg, setCfg] = useState<BotConfig>(() => parseBotConfig(bot));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [wallet, setWallet] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [instrument, setInstrument] = useState<InstrumentInfo | null>(null);
  const [price, setPrice] = useState<number | null>(null);

  const [analyzingCoins, setAnalyzingCoins] = useState(false);
  const [coinAnalysis, setCoinAnalysis] = useState<CoinAnalysis[] | null>(null);
  const [analysisError, setAnalysisError] = useState("");

  const [autoPreview, setAutoPreview] = useState<AutoSelectionPreview | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoError, setAutoError] = useState("");

  const running = (bot.desiredStatus || bot.status) === "RUNNING";

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        setCfg(parseBotConfig(bot));
        setError("");
      }, 0);
      return () => clearTimeout(t);
    }
  }, [open, bot]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setWallet(null);
      setWalletLoading(true);
    });
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

    return () => {
      cancelled = true;
    };
  }, [open]);

  const symbolForFetch = cfg.symbol.trim().toUpperCase();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    if (cfg.autoSelect) {
      queueMicrotask(() => {
        if (cancelled) return;
        setInstrument(null);
      });
    } else {
      fetch("/api/coinswitch/futures/instrument-info", { cache: "no-store" })
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return;
          if (json.success) {
            const info = json.data?.[symbolForFetch] ?? null;
            setInstrument(info ?? null);
            if (info) {
              const max = Number(info.max_leverage);
              setCfg((c) => (Number.isFinite(max) && c.leverage > max ? { ...c, leverage: max } : c));
            }
          }
        })
        .catch(() => {
          if (!cancelled) setInstrument(null);
        });
    }

    fetch("/api/coinswitch/futures/ticker", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.message || "Failed to load price");
        const data = json.data ?? {};
        const row = data[symbolForFetch] ?? data[symbolForFetch.toLowerCase()];
        const p = Number(row?.last_price);
        setPrice(Number.isFinite(p) && p > 0 ? p : null);
      })
      .catch(() => {
        if (!cancelled) setPrice(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open, symbolForFetch, cfg.autoSelect]);

  // ---- Auto-select best coin ----
  const autoPreviewUrl = useMemo(() => {
    if (!cfg.autoSelect) return "";
    const params = new URLSearchParams({
      timeframe: cfg.timeframe ?? "1h",
      leverageMode: cfg.leverageMode,
      leveragePercent: String(cfg.leveragePercent ?? 50),
      capital: String(cfg.capital || 0),
      maxRiskPerTrade: String(cfg.maxRiskPerTrade ?? 1),
      config: JSON.stringify({
        timeframe: cfg.timeframe ?? "1h",
        leverage: cfg.leverage || 5,
        leverageMode: cfg.leverageMode,
        leveragePercent: cfg.leverageMode === "manual" ? cfg.leveragePercent : undefined,
        capital: cfg.capital || 0,
        capitalMode: cfg.capitalMode,
        walletPercent: cfg.capitalMode === "percent" ? cfg.walletPercent : null,
        maxRiskPerTrade: cfg.maxRiskPerTrade ?? 1,
        dailyLossLimit: cfg.dailyLossLimit ?? 5,
        enableTrailingStop: cfg.enableTrailingStop ?? false,
        trailingDistancePercent: cfg.enableTrailingStop ? cfg.trailingDistancePercent : null,
        driftAtr: cfg.driftAtr ?? 2.5,
        regimeTolerancePct: cfg.regimeTolerancePct ?? 0.3,
        maxCandles: cfg.maxCandles ?? 24,
        hardCapCandles: cfg.hardCapCandles ?? 48,
        orderExpiryMinutes: cfg.orderExpiryMinutes,
        minConfidence: cfg.minConfidence,
      }),
    });
    return `/api/bots/auto-selection?${params.toString()}`;
  }, [
    cfg.autoSelect,
    cfg.timeframe,
    cfg.leverageMode,
    cfg.leveragePercent,
    cfg.capital,
    cfg.maxRiskPerTrade,
    cfg.capitalMode,
    cfg.walletPercent,
    cfg.dailyLossLimit,
    cfg.enableTrailingStop,
    cfg.trailingDistancePercent,
    cfg.driftAtr,
    cfg.regimeTolerancePct,
    cfg.maxCandles,
    cfg.hardCapCandles,
    cfg.orderExpiryMinutes,
    cfg.minConfidence,
    cfg.leverage,
  ]);

  useEffect(() => {
    if (!cfg.autoSelect || !open) return;
    let cancelled = false;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (cancelled) return;
      setAutoLoading(true);
      setAutoError("");
    });
    fetch(autoPreviewUrl, { cache: "no-store", signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) setAutoPreview(json.data?.best ?? null);
        else setAutoError(json.message || "Failed to preview auto-selection");
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (!cancelled) setAutoError("Failed to preview auto-selection");
      })
      .finally(() => {
        if (!cancelled) setAutoLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [autoPreviewUrl, cfg.autoSelect, open]);

  function update(field: keyof BotConfig, value: unknown) {
    setCfg((prev) => ({ ...prev, [field]: value }));
  }

  const isPercent = cfg.capitalMode === "percent";

  const effectiveCapital = useMemo<number | null>(() => {
    if (isPercent) {
      if (wallet == null) return null;
      const pct = Number(cfg.walletPercent);
      if (!Number.isFinite(pct)) return null;
      return wallet * (pct / 100);
    }
    const amount = Number(cfg.capital);
    return Number.isFinite(amount) ? amount : null;
  }, [isPercent, wallet, cfg.walletPercent, cfg.capital]);

  const tradePreview = useMemo<TradePreview>(() => {
    return computeTradePreview({
      walletBalance: wallet,
      capitalMode: isPercent ? "percent" : "fixed",
      capital: Number(cfg.capital) || 0,
      walletPercent: isPercent ? Number(cfg.walletPercent) : null,
      leverage: Number(cfg.leverage) || 1,
      maxRiskPerTradePct: Number(cfg.maxRiskPerTrade) || 0,
      currentPrice: price,
    });
  }, [wallet, isPercent, cfg.capital, cfg.walletPercent, cfg.leverage, cfg.maxRiskPerTrade, price]);

  /* ---- Field-level validation ---- */
  const fieldErrors = useMemo<Record<string, string | null>>(() => {
    const errs: Record<string, string | null> = {};
    const num = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

    const symbol = cfg.symbol.trim().toUpperCase();
    if (!cfg.autoSelect && !symbol) errs.symbol = "Symbol is required.";

    if (isPercent) {
      const pct = num(cfg.walletPercent);
      if (pct == null || pct < 1) errs.walletPercent = "Must be at least 1%.";
      else if (pct > 100) errs.walletPercent = "Cannot exceed 100%.";
    } else {
      const cap = num(cfg.capital);
      if (cap == null || cap <= 0) errs.capital = "Capital must be greater than 0.";
      else if (wallet != null && cap - wallet > 1e-9) errs.capital = `Exceeds available balance of ${wallet.toFixed(4)} USDT.`;
    }

    if (wallet != null && wallet > 0) {
      const allocatedAmt = effectiveCapital;
      if (allocatedAmt != null && allocatedAmt > 0) {
        const headroom = 0.02;
        const feeBuffer = 0.01;
        const safeMax = wallet * (1 - headroom) - feeBuffer;
        if (allocatedAmt > safeMax + 1e-9) {
          const safePct = Math.max(0, (safeMax / wallet) * 100);
          const msg = `Leaves no headroom — the margin would consume nearly all of the ${wallet.toFixed(2)} USDT free balance and the exchange rejects with "Insufficient balance". Use ~${safePct.toFixed(0)}% or less of the available balance (or lower leverage).`;
          if (isPercent) errs.walletPercent = msg;
          else errs.capital = msg;
        }
      }
    }

    const lev = num(cfg.leverage);
    if (!cfg.autoSelect) {
      if (lev == null || !(lev > 0)) errs.leverage = "Leverage must be a positive number.";
      else if (instrument) {
        const minL = Number(instrument.min_leverage);
        const maxL = Number(instrument.max_leverage);
        if (Number.isFinite(minL) && Number.isFinite(maxL) && (lev < minL || lev > maxL)) {
          errs.leverage = `Leverage must be ${minL}x\u2013${maxL}x for ${symbol}.`;
        }
      }
    } else if (cfg.leverageMode === "manual") {
      const pct = num(cfg.leveragePercent);
      if (pct == null || pct <= 0 || pct > 100) errs.leverage = "Manual leverage % must be between 1% and 100%.";
    }

    const risk = num(cfg.maxRiskPerTrade);
    if (risk == null || risk < 0) errs.maxRisk = "Enter max risk per trade (%).";
    else if (risk === 0) errs.maxRisk = "Max risk must be greater than 0% for a protected trade.";

    const daily = num(cfg.dailyLossLimit);
    if (daily == null || daily < 0) errs.dailyLoss = "Enter a daily loss limit \u2265 0 (%).";

    if (cfg.orderExpiryMinutes != null && cfg.orderExpiryMinutes < 1) errs.orderExpiry = "Order expiry must be \u2265 1 minute.";

    if (cfg.minConfidence != null && (cfg.minConfidence < 0 || cfg.minConfidence > 100)) {
      errs.minConfidence = "Confidence must be 0\u2013100.";
    }

    const drift = num(cfg.driftAtr);
    if (drift == null || drift <= 0) errs.drift = "Drift tolerance must be a positive number of ATRs.";

    const regime = num(cfg.regimeTolerancePct);
    if (regime == null || regime < 0) errs.regime = "Regime tolerance must be \u2265 0 (%).";

    const maxCandles = num(cfg.maxCandles);
    const hardCap = num(cfg.hardCapCandles);
    if (maxCandles == null || maxCandles < 1) errs.maxCandles = "Must be at least 1.";
    if (hardCap == null || hardCap < 1) errs.hardCap = "Must be at least 1.";
    if (maxCandles != null && hardCap != null && maxCandles > hardCap) errs.maxCandles = "Soft cap must not exceed the circuit-breaker cap.";

    if (cfg.enableTrailingStop) {
      const ts = num(cfg.trailingDistancePercent);
      if (ts == null || ts <= 0) errs.trailing = "Trailing distance must be > 0% when enabled.";
    }

    return errs;
  }, [cfg, isPercent, wallet, instrument, effectiveCapital]);

  async function analyzeCoins() {
    setAnalyzingCoins(true);
    setAnalysisError("");
    setCoinAnalysis(null);
    try {
      const res = await fetch(
        `/api/bots/analyze-coins?timeframe=${encodeURIComponent(cfg.timeframe ?? "1h")}&limit=25`,
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

  const minOrderIssue = (() => {
    if (cfg.autoSelect) {
      const alloc = effectiveCapital;
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
    const lev = Number(cfg.leverage);
    const alloc = effectiveCapital;
    if (!Number.isFinite(minQty) || minQty <= 0 || alloc == null || !Number.isFinite(lev) || lev <= 0) return null;
    const maxPosition = (alloc * lev) / price;
    const floored = Number.isFinite(step) && step > 0 ? Math.floor(maxPosition / step) * step : maxPosition;
    if (floored >= minQty) return null;
    const minNotional = minQty * price;
    const required = minNotional / lev;
    const symbol = cfg.symbol.trim().toUpperCase();
    return `Minimum order is ${minQty} ${symbol} (~${minNotional.toFixed(4)} USDT). Your ${alloc.toFixed(4)} USDT at ${lev}x only buys ${Math.max(floored, 0).toFixed(4)} ${symbol}. Raise capital to at least ${required.toFixed(4)} USDT or increase leverage.`;
  })();

  const notActiveIssue = (() => {
    const status = String(instrument?.status ?? "").toUpperCase();
    if (!status || status === "TRADING") return null;
    return `${cfg.symbol.trim().toUpperCase()} futures market is not open for trading (status: ${status}). Pick a different market.`;
  })();

  const levRange = leverageRange(instrument);

  function validate(): string | null {
    for (const key of Object.keys(fieldErrors)) {
      if (fieldErrors[key]) return fieldErrors[key]!;
    }

    const symbol = cfg.symbol.trim().toUpperCase();
    if (!cfg.autoSelect && !symbol) return "Trading symbol is required.";

    if (cfg.autoSelect && cfg.leverageMode === "manual") {
      const pct = Number(cfg.leveragePercent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        return "Manual leverage % must be between 1% and 100% of the selected coin's maximum.";
      }
    }

    if (!cfg.autoSelect && instrument) {
      const minL = Number(instrument.min_leverage);
      const maxL = Number(instrument.max_leverage);
      const lev = Number(cfg.leverage);
      if (Number.isFinite(minL) && Number.isFinite(maxL) && (lev < minL || lev > maxL)) {
        return `Leverage must be between ${minL}x and ${maxL}x for ${symbol}.`;
      }
    }

    if (isPercent) {
      const pct = Number(cfg.walletPercent);
      if (!Number.isFinite(pct) || pct <= 0) return "Wallet percent must be greater than zero.";
      if (pct > 100) return "Wallet percent cannot exceed 100%.";
    } else {
      const cap = Number(cfg.capital);
      if (!Number.isFinite(cap) || cap <= 0) return "Capital per trade must be greater than zero.";
    }

    if (wallet != null) {
      const alloc = effectiveCapital;
      const EXCESS_TOLERANCE = 1e-9;
      if (alloc != null && alloc - wallet > EXCESS_TOLERANCE) {
        return `Insufficient wallet balance. You need ${alloc.toFixed(2)} USDT but only ${wallet.toFixed(2)} USDT is available (including ${(wallet - alloc).toFixed(2)} USDT short).`;
      }
    }

    if (minOrderIssue && !cfg.autoSelect) {
      return `Cannot update automation — ${minOrderIssue}`;
    }

    if (notActiveIssue && !cfg.autoSelect) {
      return `Cannot update automation — ${notActiveIssue}`;
    }

    if (tradePreview.status === "error" && tradePreview.allocatedCapital > 0 && tradePreview.maxRiskPct > 0 && !tradePreview.riskCompatible) {
      return `Configuration exceeds maximum risk. The estimated SL loss (~${tradePreview.estimatedLoss.toFixed(2)} USDT) exceeds your max risk limit of ${tradePreview.maxRiskUsdt.toFixed(2)} USDT. Reduce your capital allocation, increase max risk %, or let the bot's dynamic SL adapt at runtime.`;
    }

    return null;
  }

  async function save() {
    setError("");
    if (running) {
      const message = "Pause or stop the bot before changing its configuration.";
      setError(message);
      toast.error(message);
      return;
    }
    const validation = validate();
    if (validation) {
      setError(validation);
      toast.error(validation);
      return;
    }

    setSaving(true);
    try {
      const allocated = effectiveCapital ?? (Number(cfg.capital) || 0);
      const body: Record<string, unknown> = {
        symbol: cfg.autoSelect ? cfg.symbol : cfg.symbol.trim().toUpperCase(),
        name: cfg.name?.trim() || undefined,
        timeframe: cfg.timeframe,
        leverage: Number(cfg.leverage),
        autoSelect: cfg.autoSelect,
        leverageMode: cfg.leverageMode,
        leveragePercent: cfg.leverageMode === "manual" ? Number(cfg.leveragePercent) : undefined,
        capitalMode: isPercent ? "percent" : "fixed",
        capital: allocated,
        walletPercent: isPercent ? Number(cfg.walletPercent) : undefined,
        maxRiskPerTrade: Number(cfg.maxRiskPerTrade) || 1,
        dailyLossLimit: Number(cfg.dailyLossLimit),
        enableTrailingStop: cfg.enableTrailingStop,
        trailingDistancePercent: cfg.enableTrailingStop && cfg.trailingDistancePercent != null ? Number(cfg.trailingDistancePercent) : undefined,
        driftAtr: Number(cfg.driftAtr) || 2.5,
        regimeTolerancePct: Number(cfg.regimeTolerancePct) || 0.3,
        maxCandles: Number(cfg.maxCandles) || 24,
        hardCapCandles: Number(cfg.hardCapCandles) || 48,
      };
      if (cfg.orderExpiryMinutes != null) body.orderExpiryMinutes = Number(cfg.orderExpiryMinutes);
      if (cfg.minConfidence != null) body.minConfidence = Number(cfg.minConfidence);

      const res = await fetch(`/api/bots/${bot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed to update bot");
      toast.success(`${body.symbol} updated`);
      onSaved?.();
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update bot";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const displayedSymbol = (cfg.autoSelect ? "" : cfg.symbol.trim().toUpperCase()) || bot.symbol;

  return (
    <Dialog open={open} onOpenChange={(open) => !saving && onOpenChange(open)}>
      <DialogContent className="w-[95vw] max-h-[90dvh] flex flex-col overflow-hidden border-border bg-card sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Edit {cfg.name?.trim() || displayedSymbol}
          </DialogTitle>
          <DialogDescription>
            {running
              ? "This bot is currently running. Pause or stop it before saving any changes — updates apply from the next cycle."
              : "Every setting used when you created this bot can be edited here. Changes apply from the next cycle."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto grid gap-4 md:grid-cols-2 py-2">
          {running && (
            <div className="rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-400 md:col-span-2">
              This bot is live. Pause or stop it first, then come back to edit its settings.
            </div>
          )}

          <div className="md:col-span-2">
            <Label>Bot name (optional)</Label>
            <Input
              value={cfg.name ?? ""}
              maxLength={100}
              onChange={(e) => update("name", e.target.value)}
              placeholder={`e.g. ${bot.symbol} bot`}
              className="mt-1.5"
            />
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3 md:col-span-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                Available futures balance
              </div>
              {walletLoading ? (
                <Skeleton className="h-5 w-24" />
              ) : wallet != null ? (
                <span className="font-semibold text-foreground">
                  {fmtWallet(wallet)}
                </span>
              ) : (
                <span className="text-sm text-red-400">Unavailable</span>
              )}
            </div>
            {wallet != null && isPercent && effectiveCapital != null && (
              <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>Allocated for trading</span>
                <span className="font-medium text-foreground">
                  {fmtWallet(effectiveCapital!)}
                </span>
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <input
                  id="edit-auto-select"
                  type="checkbox"
                  checked={cfg.autoSelect}
                  onChange={(e) => update("autoSelect", e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-emerald-500"
                />
                <Label htmlFor="edit-auto-select" className="mb-0">Auto-select best coin</Label>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {cfg.autoSelect
                ? "The bot will automatically select the strongest current trading opportunity (LONG or SHORT) and rotate as the market changes."
                : "The bot trades the fixed symbol you select below."}
            </p>
          </div>

          {cfg.autoSelect && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3 md:col-span-2">
              <div className="space-y-1.5">
                <Label>Leverage mode</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => update("leverageMode", "auto")}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      cfg.leverageMode === "auto"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => update("leverageMode", "manual")}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      cfg.leverageMode === "manual"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Manual %
                  </button>
                </div>
              </div>

              {cfg.leverageMode === "manual" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Leverage preference</Label>
                    <span className="font-semibold text-foreground">{cfg.leveragePercent}%</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={cfg.leveragePercent ?? 50}
                    onChange={(e) => update("leveragePercent", Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {cfg.leveragePercent}% of the selected coin&apos;s maximum leverage.
                    {autoPreview?.maxLeverage
                      ? ` If the coin supports ${autoPreview.maxLeverage}x → bot uses ≈ ${Math.round(
                          (autoPreview.maxLeverage * (cfg.leveragePercent ?? 50)) / 100,
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
                    <span className="text-muted-foreground">Score</span>
                    <span className="font-medium text-foreground">{autoPreview.score}/100</span>
                    <span className="text-muted-foreground">Selected leverage</span>
                    <span className="font-medium text-foreground">{autoPreview.leverage}x</span>
                    <span className="text-muted-foreground">Max leverage</span>
                    <span className="font-medium text-foreground">
                      {autoPreview.maxLeverage != null ? `${autoPreview.maxLeverage}x` : "—"}
                    </span>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    No suitable trading opportunity currently meets the bot&apos;s requirements. It will wait
                    and re-check on the next cycle.
                  </p>
                )}
              </div>
            </div>
          )}

          {!cfg.autoSelect && (
            <div className="space-y-1.5 md:col-span-2">
              <Label>Symbol</Label>
              <CoinSearchSelect
                value={cfg.symbol}
                onChange={(symbol) => update("symbol", symbol.toUpperCase())}
              />
              <InstrumentStatusBadge
                symbol={cfg.symbol}
                instrument={instrument}
                price={price}
              />
              {fieldErrors.symbol && <FieldError>{fieldErrors.symbol}</FieldError>}
            </div>
          )}

          {!cfg.autoSelect && (
            <div className="md:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Coin analyzer</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={analyzingCoins}
                  onClick={analyzeCoins}
                  title="Scan the most liquid coins with the full factor stack and rank them"
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
                      No tradable setups found on the {cfg.timeframe || "1h"} timeframe right now.
                    </p>
                  ) : (
                    coinAnalysis.slice(0, 6).map((coin, index) => {
                      const active = coin.symbol.toUpperCase() === cfg.symbol.trim().toUpperCase();
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
                                onClick={() => update("symbol", coin.symbol.toUpperCase())}
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
            <Select value={cfg.timeframe ?? "1h"} onValueChange={(v) => update("timeframe", v)}>
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

          {!cfg.autoSelect && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Leverage</Label>
                <span className="font-semibold text-foreground">{cfg.leverage}x</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={levRange.min}
                  max={levRange.max}
                  step={1}
                  value={Math.min(levRange.max, Math.max(levRange.min, Math.floor(Number(cfg.leverage) || levRange.min)))}
                  onChange={(e) => update("leverage", Number(e.target.value))}
                  className="flex-1 accent-emerald-500"
                />
                <span className="w-12 text-right font-semibold text-foreground">{cfg.leverage}x</span>
              </div>
              {fieldErrors.leverage && <FieldError>{fieldErrors.leverage}</FieldError>}
              <p className="text-xs text-muted-foreground">
                {instrument
                  ? `${instrument.min_leverage}x – ${instrument.max_leverage}x available for ${cfg.symbol.trim().toUpperCase()}`
                  : "1x – 100x available"}
              </p>
            </div>
          )}

          <div className="space-y-1.5 md:col-span-2">
            <Label>Capital mode</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => update("capitalMode", "fixed")}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  !isPercent
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                }`}
              >
                Fixed amount
              </button>
              <button
                type="button"
                onClick={() => update("capitalMode", "percent")}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  isPercent
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                }`}
              >
                % of wallet
              </button>
            </div>
          </div>

          {isPercent ? (
            <div className="space-y-1.5 md:col-span-2">
              <Label>Percent of wallet</Label>
              <Input
                type="number"
                min={1}
                max={100}
                step="any"
                value={cfg.walletPercent ?? ""}
                onChange={(e) => update("walletPercent", Number(e.target.value))}
                placeholder="10"
              />
              {fieldErrors.walletPercent && <FieldError>{fieldErrors.walletPercent}</FieldError>}
              {wallet != null && effectiveCapital != null && (
                <p className="text-xs text-muted-foreground">
                  ≈ {fmtWallet(effectiveCapital!)}
                </p>
              )}
              {notActiveIssue && <p className="text-xs text-red-400">{notActiveIssue}</p>}
              {minOrderIssue && <p className="text-xs text-red-400">{minOrderIssue}</p>}
            </div>
          ) : (
            <div className="space-y-1.5 md:col-span-2">
              <Label>Capital per trade ({currencyLabel()})</Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={cfg.capital ?? ""}
                onChange={(e) => update("capital", Number(e.target.value))}
                placeholder="0.00"
              />
              {fieldErrors.capital && <FieldError>{fieldErrors.capital}</FieldError>}
              {wallet != null && Number(cfg.capital) > wallet && (
                <p className="text-xs text-red-400">
                  Exceeds your available balance of {fmtWallet(wallet)}.
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
            <Label>Max risk / trade (%)</Label>
            <p className="text-[11px] text-muted-foreground -mt-0.5">
              Maximum percentage of your margin you are willing to lose if SL is hit. This is separate from your capital allocation.
            </p>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={cfg.maxRiskPerTrade ?? ""}
              onChange={(e) => update("maxRiskPerTrade", Number(e.target.value))}
              placeholder="1"
            />
            {fieldErrors.maxRisk && <FieldError>{fieldErrors.maxRisk}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label>Daily loss limit (%)</Label>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={cfg.dailyLossLimit ?? ""}
              onChange={(e) => update("dailyLossLimit", Number(e.target.value))}
              placeholder="5"
            />
            {fieldErrors.dailyLoss && <FieldError>{fieldErrors.dailyLoss}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label>Order expiry (min)</Label>
            <Input
              type="number"
              min={1}
              value={cfg.orderExpiryMinutes ?? ""}
              onChange={(e) =>
                update("orderExpiryMinutes", e.target.value === "" ? null : Number(e.target.value))
              }
              placeholder="Optional"
            />
            {fieldErrors.orderExpiry && <FieldError>{fieldErrors.orderExpiry}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label>Min confidence</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={cfg.minConfidence ?? ""}
              onChange={(e) =>
                update("minConfidence", e.target.value === "" ? null : Number(e.target.value))
              }
              placeholder="Optional"
            />
            {fieldErrors.minConfidence && <FieldError>{fieldErrors.minConfidence}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label>Drift tolerance (×ATR)</Label>
            <Input
              type="number"
              min={0.5}
              step={0.1}
              value={cfg.driftAtr ?? 2.5}
              onChange={(e) => update("driftAtr", Number(e.target.value))}
              placeholder="2.5"
            />
            {fieldErrors.drift && <FieldError>{fieldErrors.drift}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label>Regime tolerance (%)</Label>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={cfg.regimeTolerancePct ?? 0.3}
              onChange={(e) => update("regimeTolerancePct", Number(e.target.value))}
              placeholder="0.3"
            />
            {fieldErrors.regime && <FieldError>{fieldErrors.regime}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label>Max candles resting (soft)</Label>
            <Input
              type="number"
              min={1}
              value={cfg.maxCandles ?? 24}
              onChange={(e) => update("maxCandles", Number(e.target.value))}
              placeholder="24"
            />
            {fieldErrors.maxCandles && <FieldError>{fieldErrors.maxCandles}</FieldError>}
          </div>

          <div className="space-y-1.5">
            <Label>Circuit-breaker candles</Label>
            <Input
              type="number"
              min={1}
              value={cfg.hardCapCandles ?? 48}
              onChange={(e) => update("hardCapCandles", Number(e.target.value))}
              placeholder="48"
            />
            {fieldErrors.hardCap && <FieldError>{fieldErrors.hardCap}</FieldError>}
          </div>

          <div className="md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <input
                  id="edit-trailing"
                  type="checkbox"
                  checked={cfg.enableTrailingStop ?? false}
                  onChange={(e) => update("enableTrailingStop", e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-emerald-500"
                />
                <Label htmlFor="edit-trailing" className="mb-0">Enable trailing stop</Label>
              </div>
              {cfg.enableTrailingStop && (
                <div className="grid w-full sm:w-40 gap-1.5">
                  <Label>Trailing distance (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={cfg.trailingDistancePercent ?? ""}
                    onChange={(e) =>
                      update("trailingDistancePercent", e.target.value === "" ? null : Number(e.target.value))
                    }
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
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}