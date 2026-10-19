"use client";

import { ArrowRight, CheckCircle2, CircleAlert, CircleDashed, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { ListSkeleton } from "@/components/ui/skeletons";
import { fetchData } from "@/lib/api-client";
import { formatWithUnit } from "@/lib/currency/store";
import { useAsyncData } from "@/components/analytics/use-data";
import { formatDate } from "@/components/analytics/format";
import { cn } from "@/lib/utils";
import type { StopHistory, StopHistoryOrderCheck } from "@/automation/position/stop-history";

/**
 * Stop-loss history in plain words: where the stop-loss was, where it is now,
 * and what you get if it is hit (profit or loss). Built for non-technical
 * users — one short line per step.
 */
export function StopLossHistory({ positionId, executionId, className }: { positionId?: number | null; executionId?: number | null; className?: string }) {
  const query = positionId ? `positionId=${positionId}` : `executionId=${executionId}`;
  const { data, error, errorInfo, loading, refresh } = useAsyncData<StopHistory>(
    () => fetchData<StopHistory>(`/api/analytics/stop-history?${query}`),
    [query],
  );

  if (loading) return <ListSkeleton rows={3} className={className} />;
  if (error && !data) return <ErrorState error={errorInfo ?? error} title="Couldn't load the stop-loss history" onRetry={refresh} compact />;
  if (!data) return null;

  const h = data;
  const dir = h.side === "BUY" ? 1 : -1;
  /** Money you get (+) or lose (−) if the trade closes at `price`. */
  const result = (price: number | null) =>
    price == null || h.entryPrice == null || h.quantity == null ? null : (price - h.entryPrice) * h.quantity * dir;
  const exchange = h.mode === "PAPER" ? "Paper exchange" : "CoinSwitch";
  const failures = h.failures.length;

  return (
    <div className={cn("space-y-3 text-sm", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stop-loss history</p>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => refresh()}>
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>

      {/* Now */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Box label="Entry price" value={formatWithUnit(h.entryPrice)} />
        <Box label={h.open ? "Current price" : "Exit price"} value={formatWithUnit(h.open ? h.currentPrice : h.exitPrice)} />
        <Box label={h.open ? "Stop-loss now" : "Last stop-loss"} value={formatWithUnit(h.current.price)} sub={<IfHit amount={result(h.current.price)} />} check={h.current.check} exchange={exchange} />
        <Box label={h.takeProfit.trails && h.targetMoves.length > 0 ? "Take-profit now" : "Take-profit"} value={formatWithUnit(h.takeProfit.price)} sub={<IfHit amount={result(h.takeProfit.price)} />} check={h.takeProfit.check} exchange={exchange} />
      </div>

      {/* Timeline */}
      <ol className="relative space-y-2.5 border-l border-border pl-4">
        <Step at={h.original.at} dot="bg-sky-400" title="Trade opened">
          Stop-loss set at <b className="text-foreground">{formatWithUnit(h.original.price)}</b> · <IfHit amount={result(h.original.price)} />
        </Step>

        {h.moves.map((m, i) => (
          <Step key={i} at={m.at} dot="bg-emerald-400" title="Stop-loss moved">
            <span className="inline-flex flex-wrap items-center gap-1">
              <span className="tabular-nums">{formatWithUnit(m.from)}</span>
              <ArrowRight size={12} className="text-muted-foreground" />
              <b className="tabular-nums text-foreground">{formatWithUnit(m.to)}</b>
            </span>
            {" · "}
            <IfHit amount={result(m.to)} />
          </Step>
        ))}

        {h.targetMoves.map((m, i) => (
          <Step key={`t${i}`} at={m.at} dot="bg-emerald-300" title="Take-profit moved up">
            <span className="inline-flex flex-wrap items-center gap-1">
              <span className="tabular-nums">{formatWithUnit(m.from)}</span>
              <ArrowRight size={12} className="text-muted-foreground" />
              <b className="tabular-nums text-foreground">{formatWithUnit(m.to)}</b>
            </span>
            {" · "}
            <IfHit amount={result(m.to)} />
          </Step>
        ))}

        {failures > 0 && (
          <Step at={h.failures[failures - 1].at} dot="bg-amber-400" title={failures === 1 ? "Stop-loss could not be moved" : `Stop-loss could not be moved (${failures} times)`}>
            <span className="text-amber-300/90">{simpleReason(h.failures[failures - 1].reason, exchange)}</span>
          </Step>
        )}

        {!h.open && (
          <Step at={h.closedAt} dot="bg-zinc-400" title="Trade closed">
            At <b className="text-foreground">{formatWithUnit(h.exitPrice)}</b> · <Result amount={result(h.exitPrice)} />
          </Step>
        )}
      </ol>

      {h.open && h.moves.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {h.trailRule.startsWith("When the price reaches")
            ? "When the price reaches the take-profit, the trade stays open: the stop-loss moves up to lock profit and the take-profit moves further out."
            : h.trailRule.startsWith("The stop stays")
            ? "The stop-loss moves only after the trade is in good profit. Then it moves to your entry price, so this trade can no longer lose."
            : h.trailRule}
        </p>
      )}
    </div>
  );
}

/** "If hit: Profit 12.40 INR" / "If hit: Loss 26.36 INR". */
function IfHit({ amount }: { amount: number | null }) {
  if (amount == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      <span className="text-muted-foreground">If hit: </span>
      <Result amount={amount} />
    </span>
  );
}

function Result({ amount }: { amount: number | null }) {
  if (amount == null) return <span className="text-muted-foreground">—</span>;
  const profit = amount >= 0;
  return (
    <span className={cn("font-medium tabular-nums", profit ? "text-emerald-400" : "text-red-400")}>
      {profit ? "Profit" : "Loss"} {formatWithUnit(Math.abs(amount), 2)}
    </span>
  );
}

function Box({ label, value, sub, check, exchange }: { label: string; value: string; sub?: React.ReactNode; check?: StopHistoryOrderCheck | null; exchange?: string }) {
  return (
    <div className="space-y-0.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="text-xs">{sub}</div>}
      {check && <Confirmed check={check} exchange={exchange ?? "Exchange"} />}
    </div>
  );
}

/** Small proof line: the order really exists on the exchange right now (details on hover). */
function Confirmed({ check, exchange }: { check: StopHistoryOrderCheck; exchange: string }) {
  const Icon = check.active ? CheckCircle2 : check.active === false ? CircleAlert : CircleDashed;
  const text = check.active ? `Active on ${exchange}` : check.active === false ? `Not found on ${exchange}` : `Couldn't check ${exchange}`;
  return (
    <div
      className={cn("flex items-center gap-1 text-[11px]", check.active ? "text-emerald-400" : check.active === false ? "text-red-400" : "text-amber-400")}
      title={`Order ${check.orderId ?? "—"} · status ${check.status ?? "unknown"} · checked ${formatDate(check.checkedAt, { second: "2-digit" })}`}
    >
      <Icon size={11} /> {text}
    </div>
  );
}

function Step({ at, dot, title, children }: { at: string | null; dot: string; title: string; children: React.ReactNode }) {
  return (
    <li className="relative text-xs">
      <span className={cn("absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-card", dot)} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{at ? formatDate(at) : "—"}</span>
      </div>
      <div className="mt-0.5 text-muted-foreground">{children}</div>
    </li>
  );
}

/** Exchange errors in plain words. */
function simpleReason(reason: string, exchange: string): string {
  if (/stop[\s_-]*market order already exists/i.test(reason)) return `${exchange} allows only one stop-loss per trade, so the old one has to be replaced first. Fixed — it will be retried automatically.`;
  if (/could not be confirmed/i.test(reason)) return `${exchange} did not confirm the new stop-loss, so the old one was kept. It will be retried.`;
  if (/restored/i.test(reason)) return "The new stop-loss could not be placed, so the old one was put back. It will be retried.";
  if (/NO STOP-LOSS/i.test(reason)) return "The stop-loss could not be placed. The bot is re-placing it now.";
  if (/liquidation/i.test(reason)) return "This level is too close to the liquidation price, so the stop-loss was kept where it is.";
  return `${exchange} refused the change, so the old stop-loss was kept. It will be retried.`;
}
