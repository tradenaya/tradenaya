"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
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

export interface EditBotDialogProps {
  bot: BotView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function EditBotDialog({ bot, open, onOpenChange, onSaved }: EditBotDialogProps) {
  const [cfg, setCfg] = useState<BotConfig>(parseBotConfig(bot));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setCfg(parseBotConfig(bot)), 0);
      return () => clearTimeout(t);
    }
  }, [open, bot]);

  function update(field: keyof BotConfig, value: unknown) {
    setCfg((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        symbol: bot.symbol,
        timeframe: cfg.timeframe,
        leverage: cfg.leverage,
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
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden border-border bg-card">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Edit {bot.symbol}
          </DialogTitle>
          <DialogDescription>Adjust capital, risk and protection settings. Changes apply on the next cycle.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto grid gap-3.5 py-2">
          <div className="grid gap-1.5">
            <Label>Timeframe</Label>
            <Input value={cfg.timeframe ?? ""} onChange={(e) => update("timeframe", e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div className="grid gap-1.5">
              <Label>Leverage</Label>
              <Input type="number" min={1} value={cfg.leverage ?? ""} onChange={(e) => update("leverage", Number(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Capital (USDT)</Label>
              <Input type="number" min={0} value={cfg.capital ?? ""} onChange={(e) => update("capital", Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
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

          <div className="grid grid-cols-2 gap-3.5">
            <div className="grid gap-1.5">
              <Label>Max risk / trade (%)</Label>
              <Input type="number" min={0} step={0.1} value={cfg.maxRiskPerTrade ?? ""} onChange={(e) => update("maxRiskPerTrade", Number(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Daily loss limit (%)</Label>
              <Input type="number" min={0} step={0.1} value={cfg.dailyLossLimit ?? ""} onChange={(e) => update("dailyLossLimit", Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div className="grid gap-1.5">
              <Label>Order expiry (min)</Label>
              <Input type="number" min={1} value={cfg.orderExpiryMinutes ?? ""} onChange={(e) => update("orderExpiryMinutes", Number(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Min confidence</Label>
              <Input type="number" min={0} max={100} value={cfg.minConfidence ?? ""} onChange={(e) => update("minConfidence", Number(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
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

          <div className="flex items-end justify-between rounded-lg border border-border bg-background/40 px-3 py-2.5">
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
              <div className="grid w-32 gap-1.5">
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
