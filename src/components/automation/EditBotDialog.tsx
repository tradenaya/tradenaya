"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { parseBotConfig, type BotConfig, type BotView } from "./bot-config";
import { computeTradePreview, type TradePreview } from "./trade-preview";
import { TradePreviewPanel } from "./TradePreviewPanel";

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
}

export interface EditBotDialogProps {
  bot: BotView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function EditBotDialog({ bot, open, onOpenChange, onSaved }: EditBotDialogProps) {
  const [cfg, setCfg] = useState<BotConfig>(parseBotConfig(bot));
  const [saving, setSaving] = useState(false);
  const [wallet, setWallet] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setCfg(parseBotConfig(bot)), 0);

      setWalletLoading(true);
      fetch("/api/coinswitch/futures/wallet-balance", { cache: "no-store" })
        .then((r) => r.json())
        .then((json) => {
          if (json.success) {
            const usdt = json.data?.base_asset_balances?.find(
              (b: { base_asset: string }) => String(b.base_asset).toUpperCase() === "USDT",
            );
            const bal = Number(usdt?.balances?.total_available_balance);
            setWallet(Number.isFinite(bal) ? bal : null);
          }
        })
        .catch(() => setWallet(null))
        .finally(() => setWalletLoading(false));

      fetch("/api/coinswitch/futures/ticker", { cache: "no-store" })
        .then((r) => r.json())
        .then((json) => {
          if (json.success) {
            const sym = bot.symbol.trim().toUpperCase();
            const data = json.data ?? {};
            const row = data[sym] ?? data[sym.toLowerCase()];
            const p = Number(row?.last_price);
            setPrice(Number.isFinite(p) && p > 0 ? p : null);
          }
        })
        .catch(() => setPrice(null));

      return () => clearTimeout(t);
    }
  }, [open, bot]);

  const tradePreview = useMemo<TradePreview>(() => {
    return computeTradePreview({
      walletBalance: wallet,
      capitalMode: cfg.capitalMode === "percent" ? "percent" : "fixed",
      capital: cfg.capital || 0,
      walletPercent: cfg.capitalMode === "percent" ? cfg.walletPercent : null,
      leverage: cfg.leverage || 1,
      maxRiskPerTradePct: cfg.maxRiskPerTrade ?? 0,
      currentPrice: price,
    });
  }, [wallet, cfg.capitalMode, cfg.capital, cfg.walletPercent, cfg.leverage, cfg.maxRiskPerTrade, price]);

  // ---- Auto-select best coin ----
  const [autoPreview, setAutoPreview] = useState<AutoSelectionPreview | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoError, setAutoError] = useState("");

  const autoPreviewUrl = useMemo(() => {
    if (!cfg.autoSelect) return "";
    const params = new URLSearchParams({
      timeframe: cfg.timeframe ?? "1h",
      leverageMode: cfg.leverageMode,
      leveragePercent: String(cfg.leveragePercent ?? 50),
      capital: String(cfg.capital || 0),
        maxRiskPerTrade: String(cfg.maxRiskPerTrade ?? 20),
      config: JSON.stringify({
        timeframe: cfg.timeframe ?? "1h",
        leverage: cfg.leverage || 5,
        leverageMode: cfg.leverageMode,
        leveragePercent: cfg.leveragePercent ?? 50,
        capital: cfg.capital || 0,
        capitalMode: cfg.capitalMode,
        walletPercent: cfg.capitalMode === "percent" ? cfg.walletPercent : null,
        maxRiskPerTrade: cfg.maxRiskPerTrade ?? 1,
        dailyLossLimit: cfg.dailyLossLimit ?? 30,
        enableTrailingStop: cfg.enableTrailingStop ?? false,
        trailingDistancePercent: cfg.trailingDistancePercent ?? null,
        minConfidence: cfg.minConfidence ?? null,
        driftAtr: cfg.driftAtr ?? 2.5,
        maxCandles: cfg.maxCandles ?? 24,
        hardCapCandles: cfg.hardCapCandles ?? 48,
        regimeTolerancePct: cfg.regimeTolerancePct ?? 0.3,
      }),
    });
    return `/api/bots/auto-selection?${params.toString()}`;
  }, [cfg.autoSelect, cfg.timeframe, cfg.leverageMode, cfg.leveragePercent, cfg.capital, cfg.maxRiskPerTrade, cfg.capitalMode, cfg.walletPercent, cfg.dailyLossLimit, cfg.enableTrailingStop, cfg.trailingDistancePercent, cfg.minConfidence, cfg.driftAtr, cfg.maxCandles, cfg.hardCapCandles, cfg.regimeTolerancePct, cfg.leverage]);

  useEffect(() => {
    if (!cfg.autoSelect || !open) return;
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
  }, [autoPreviewUrl, cfg.autoSelect, open]);

  function update(field: keyof BotConfig, value: unknown) {
    setCfg((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    if (tradePreview.status === "error" && tradePreview.allocatedCapital > 0 && tradePreview.maxRiskPct > 0 && !tradePreview.riskCompatible) {
      toast.error("Configuration exceeds maximum risk. Adjust your settings before saving.");
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        symbol: bot.symbol,
        name: cfg.name?.trim() || undefined,
        timeframe: cfg.timeframe,
        leverage: cfg.leverage,
        autoSelect: cfg.autoSelect,
        leverageMode: cfg.leverageMode,
        leveragePercent: cfg.leverageMode === "manual" ? cfg.leveragePercent : undefined,
        capital: cfg.capital,
        capitalMode: cfg.capitalMode === "percent" ? "percent" : "fixed",
        walletPercent: cfg.capitalMode === "percent" ? cfg.walletPercent : undefined,
        maxRiskPerTrade: cfg.maxRiskPerTrade,
        dailyLossLimit: cfg.dailyLossLimit,
        enableTrailingStop: cfg.enableTrailingStop,
        trailingDistancePercent: cfg.trailingDistancePercent,
        minRiskRewardRatio: undefined,
        orderExpiryMinutes: cfg.orderExpiryMinutes,
        minConfidence: cfg.minConfidence,
        driftAtr: cfg.driftAtr,
        maxCandles: cfg.maxCandles,
        hardCapCandles: cfg.hardCapCandles,
        regimeTolerancePct: cfg.regimeTolerancePct,
      };
      const res = await fetch(`/api/bots/${bot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Failed to update bot");
      toast.success(`${bot.symbol} updated`);
      onSaved?.();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update bot");
    } finally {
      setSaving(false);
    }
  }

  const isPercent = cfg.capitalMode === "percent";

  return (
    <Dialog open={open} onOpenChange={(open) => !saving && onOpenChange(open)}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[90dvh] flex flex-col overflow-hidden border-border bg-card">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Edit {cfg.name?.trim() || bot.symbol}
          </DialogTitle>
          <DialogDescription>Adjust capital, risk and protection settings. Changes apply on the next cycle.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto grid gap-3.5 py-2">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Available futures balance</span>
              {walletLoading ? (
                <span className="text-muted-foreground animate-pulse">Loading…</span>
              ) : wallet != null ? (
                <span className="font-semibold text-foreground">
                  {wallet.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT
                </span>
              ) : (
                <span className="text-xs text-red-400">Unavailable</span>
              )}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="edit-bot-name">Bot name (optional)</Label>
            <Input
              id="edit-bot-name"
              maxLength={100}
              value={cfg.name ?? ""}
              onChange={(e) => update("name", e.target.value)}
              placeholder={`e.g. ${bot.symbol} bot`}
            />
          </div>

          {/* Auto-select best coin */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  id="edit-auto-select"
                  type="checkbox"
                  checked={cfg.autoSelect}
                  onChange={(e) => update("autoSelect", e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-emerald-500"
                />
                <Label htmlFor="edit-auto-select" className="mb-0">
                  Auto-select best coin
                </Label>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {cfg.autoSelect
                ? "The bot will automatically select the strongest current trading opportunity and rotate coins each cycle when a better setup exists."
                : "The bot trades the fixed symbol configured below."}
            </p>

            {cfg.autoSelect && (
              <>
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
                        : " The leverage scales to each coin automatically."}
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Leverage will be calculated automatically for each selected coin based on its maximum
                    leverage, market conditions and risk.
                  </p>
                )}

                {/* Live preview */}
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
              </>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>Timeframe</Label>
            <Input value={cfg.timeframe ?? ""} onChange={(e) => update("timeframe", e.target.value)} />
          </div>

          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3.5`}>
            {!cfg.autoSelect && (
              <div className="grid gap-1.5">
                <Label>Leverage</Label>
                <Input type="number" min={1} value={cfg.leverage ?? ""} onChange={(e) => update("leverage", Number(e.target.value))} />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Capital (USDT)</Label>
              <Input type="number" min={0} value={cfg.capital ?? ""} onChange={(e) => update("capital", Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="grid gap-1.5">
              <Label>Capital mode</Label>
              <Select value={cfg.capitalMode} onValueChange={(v) => update("capitalMode", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="percent">% of wallet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isPercent && (
              <div className="grid gap-1.5">
                <Label>Wallet %</Label>
                <Input type="number" min={1} max={100} value={cfg.walletPercent ?? ""} onChange={(e) => update("walletPercent", Number(e.target.value))} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="grid gap-1.5">
              <Label>Max risk / trade (%)</Label>
              <p className="text-[11px] text-muted-foreground -mt-0.5">
                Max loss if SL is hit. Separate from capital allocation.
              </p>
              <Input type="number" min={0} step={0.1} value={cfg.maxRiskPerTrade ?? ""} onChange={(e) => update("maxRiskPerTrade", Number(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Daily loss limit (%)</Label>
              <Input type="number" min={0} step={0.1} value={cfg.dailyLossLimit ?? ""} onChange={(e) => update("dailyLossLimit", Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="grid gap-1.5">
              <Label>Order expiry (min)</Label>
              <Input type="number" min={1} value={cfg.orderExpiryMinutes ?? ""} onChange={(e) => update("orderExpiryMinutes", Number(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Min confidence</Label>
              <Input type="number" min={0} max={100} value={cfg.minConfidence ?? ""} onChange={(e) => update("minConfidence", Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="grid gap-1.5">
              <Label>Drift tolerance (×ATR)</Label>
              <Input type="number" min={0.5} step={0.1} value={cfg.driftAtr ?? 1} onChange={(e) => update("driftAtr", Number(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Regime tolerance (%)</Label>
              <Input type="number" min={0} step={0.1} value={cfg.regimeTolerancePct ?? 0.3} onChange={(e) => update("regimeTolerancePct", Number(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Max candles resting (soft)</Label>
              <Input type="number" min={1} value={cfg.maxCandles ?? 24} onChange={(e) => update("maxCandles", Number(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Circuit-breaker candles</Label>
              <Input type="number" min={1} value={cfg.hardCapCandles ?? 48} onChange={(e) => update("hardCapCandles", Number(e.target.value))} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Drift tolerance: how far price (in ATRs) can drift past your resting entry before being cancelled. Regime tolerance: ignore EMA flips smaller than this % so you are not cancelled on 0.13%-style noise.
          </p>

          <div className="border-t border-border pt-3 mt-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Trade Preview</p>
            <TradePreviewPanel preview={tradePreview} />
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <input
                id="trailing"
                type="checkbox"
                checked={cfg.enableTrailingStop ?? false}
                onChange={(e) => update("enableTrailingStop", e.target.checked)}
                className="h-4 w-4 rounded border-border accent-emerald-500"
              />
              <Label htmlFor="trailing" className="mb-0">
                Enable trailing stop
              </Label>
            </div>
            {cfg.enableTrailingStop && (
              <div className="grid w-full sm:w-32 gap-1.5">
                <Label>Trailing distance (%)</Label>
                <Input type="number" min={0} step={0.1} value={cfg.trailingDistancePercent ?? ""} onChange={(e) => update("trailingDistancePercent", Number(e.target.value))} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" size="sm" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
