"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CandlestickChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney, parseBotConfig, statusMeta, displaySymbol, sideLabel, botName, type BotView } from "./bot-config";
import { currencyLabel } from "@/lib/currency/store";
import { type OpenPositionAnalytics } from "@/automation/analytics/types";

export interface BotDetailsDialogProps {
  bot: BotView;
  position: OpenPositionAnalytics | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  );
}

export function BotDetailsDialog({ bot, position, open, onOpenChange }: BotDetailsDialogProps) {
  const router = useRouter();
  const cfg = parseBotConfig(bot);
  const st = statusMeta(bot.status);
  const sym = displaySymbol(bot, cfg);
  const dir = sideLabel(position?.side ?? cfg.side) ?? null;
  const name = botName(bot, cfg);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-7xl max-h-[90dvh] flex flex-col overflow-hidden border-border bg-card p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <DialogTitle className="flex items-center gap-2 text-lg">
              {name ? (
                <span className="flex flex-wrap items-center gap-2">
                  {name}
                  <span className="text-sm font-normal text-muted-foreground">
                    {sym ? `${sym.replace(/USDT$/, "")} automation` : "Auto-select automation"}
                  </span>
                </span>
              ) : sym ? (
                `${sym.replace(/USDT$/, "")} automation`
              ) : (
                "Auto-select automation"
              )}
              {cfg.autoSelect && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500/80">AUTO</span>}
              {dir && (
                <Badge className={cn("text-[10px]", dir === "Long" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                  {dir}
                </Badge>
              )}
            </DialogTitle>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
              onClick={() => {
                onOpenChange(false);
                router.push(`/trade/${sym || bot.symbol}`);
              }}
            >
              <CandlestickChart size={13} /> View Chart
            </Button>
          </div>
          <DialogDescription>
            {fmtMoney(cfg.capital)} {currencyLabel()} capital · {cfg.leverage}x leverage · {cfg.timeframe} · {cfg.strategy}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 grid gap-6 overflow-y-auto p-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
            <div className="flex items-center gap-2">
              <Badge className={cn("text-[10px]", st.className)}>{st.label}</Badge>
              <span className="text-xs text-muted-foreground">
                {bot.lastError && !["RUNNING", "ANALYZING", "TRADE_PLANNED", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED"].includes(bot.status)
                  ? bot.lastError
                  : "All systems operating as expected"}
              </span>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Configuration</p>
              <Field label="Symbol">{sym || "Auto-select"}</Field>
              <Field label="Name">{name || "—"}</Field>
              <Field label="Auto-select">{cfg.autoSelect ? "On" : "Off"}</Field>
              <Field label="Timeframe">{cfg.timeframe}</Field>
              <Field label="Leverage">{cfg.leverage}x</Field>
              <Field label="Capital">{fmtMoney(cfg.capital)} {currencyLabel()}</Field>
              <Field label="Strategy">{cfg.strategy}</Field>
              <Field label="Capital mode">{cfg.capitalMode === "percent" ? `${cfg.walletPercent}% of wallet` : "Fixed"}</Field>
              <Field label="Max risk / trade">{cfg.maxRiskPerTrade}%</Field>
              <Field label="Daily loss limit">{cfg.dailyLossLimit}%</Field>
              <Field label="Min. confidence">{cfg.minConfidence}%</Field>
              <Field label="Trailing stop">{cfg.enableTrailingStop ? `On (${cfg.trailingDistancePercent}%)` : "Off"}</Field>
              <Field label="Order expiry">{cfg.orderExpiryMinutes} min</Field>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Risk / protection</p>
              <Field label="Capital allocated">{fmtMoney(cfg.capital)} {currencyLabel()}</Field>
              <Field label="Per-trade ceiling">~{cfg.maxRiskPerTrade}% of capital</Field>
              <Field label="Stop loss">{cfg.enableTrailingStop ? `${cfg.trailingDistancePercent}% trailing` : "Static or disabled"}</Field>
              <Field label="Bot id">{bot.id}</Field>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open position</p>
            {position ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <Field label="Side">{position.side === "BUY" ? "Long" : "Short"}</Field>
                <Field label="Quantity">{position.quantity ?? "—"}</Field>
                <Field label="Entry price">{position.entryPrice != null ? fmtMoney(position.entryPrice) : "—"}</Field>
                <Field label="Current price">{position.currentPrice != null ? fmtMoney(position.currentPrice) : "—"}</Field>
                <Field label="Stop loss">{position.stopLoss != null ? fmtMoney(position.stopLoss) : "—"}</Field>
                <Field label="Take profit">{position.takeProfit != null ? fmtMoney(position.takeProfit) : "—"}</Field>
                <Field label="Unrealized PnL">{position.unrealizedPnl != null ? fmtMoney(position.unrealizedPnl) : "—"}</Field>
                <Field label="Leverage">{position.leverage != null ? `${position.leverage}x` : "—"}</Field>
                <Field label="Margin">{position.margin != null ? fmtMoney(position.margin) : "—"}</Field>
                <Field label="Protection">{position.protectionStatus}</Field>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No open position — the bot is watching for its next signal.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BotDetailsDialog;
