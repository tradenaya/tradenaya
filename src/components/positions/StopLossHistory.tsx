"use client";

import { ArrowRight, CheckCircle2, CircleAlert, CircleDashed, Lock, RefreshCw, ShieldCheck, Target, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { ListSkeleton } from "@/components/ui/skeletons";
import { fetchData } from "@/lib/api-client";
import { formatPct, formatSignedWithUnit, formatWithUnit } from "@/lib/currency/store";
import { useAsyncData } from "@/components/analytics/use-data";
import { formatDate } from "@/components/analytics/format";
import { cn } from "@/lib/utils";
import type { StopHistory, StopHistoryOrderCheck } from "@/automation/position/stop-history";

/**
 * Proof of how a position's stop-loss (and fixed target) were managed: every
 * level with its % from entry, the money it means and that money as a % of
 * your own money, every stop move with the exchange orders involved, failed
 * attempts with the exchange's reason, and a live check of the current orders.
 */
export function StopLossHistory({ positionId, executionId, className }: { positionId?: number | null; executionId?: number | null; className?: string }) {
  const query = positionId ? `positionId=${positionId}` : `executionId=${executionId}`;
  const { data, error, errorInfo, loading, refresh: load } = useAsyncData<StopHistory>(
    () => fetchData<StopHistory>(`/api/analytics/stop-history?${query}`),
    [query],
  );

  if (loading) return <ListSkeleton rows={3} className={className} />;
  if (error && !data) return <ErrorState error={errorInfo ?? error} title="Couldn't load the stop-loss history" onRetry={load} compact />;
  if (!data) return null;

  const h = data;
  const dir = h.side === "BUY" ? 1 : -1;
  const entry = h.entryPrice;
  const now = h.open ? h.currentPrice : h.exitPrice;
  const outcome = (level: number | null) => (level == null || entry == null || h.quantity == null ? null : (level - entry) * h.quantity * dir);
  const ofMoney = (amount: number | null) => (amount != null && h.margin ? `${formatPct((amount / h.margin) * 100)} of your money` : null);
  const fromEntry = (level: number | null) => (level != null && entry ? `${formatPct(((level - entry) / entry) * 100)} from entry` : null);
  const away = (level: number | null, price: number | null) =>
    level != null && price ? `${formatPct(((level - price) / price) * 100)} from price` : null;
  const exchangeName = h.mode === "PAPER" ? "Paper exchange" : "CoinSwitch";

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stop-loss &amp; target · history and proof</p>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => load()}>
          <RefreshCw size={12} /> {h.open ? "Re-check with exchange" : "Refresh"}
        </Button>
      </div>

      {/* Where things stand now */}
      <div className="grid gap-2 sm:grid-cols-2">
        <LevelCard
          icon={<Lock size={13} />}
          title={h.open ? "Stop-loss now" : "Last stop-loss"}
          tone={(outcome(h.current.price) ?? -1) >= 0 ? "good" : "bad"}
          price={h.current.price}
          lines={[
            fromEntry(h.current.price),
            h.open ? away(h.current.price, now) : null,
            outcome(h.current.price) != null
              ? `${(outcome(h.current.price) as number) >= 0 ? "Locks in" : "Limits loss to"} ${formatSignedWithUnit(outcome(h.current.price))}${ofMoney(outcome(h.current.price)) ? ` (${ofMoney(outcome(h.current.price))})` : ""}`
              : null,
          ]}
          check={h.current.check}
          orderId={h.current.orderId}
          exchangeName={exchangeName}
        />
        <LevelCard
          icon={<Target size={13} />}
          title="Target (fixed, doesn't trail)"
          tone="good"
          price={h.takeProfit.price}
          lines={[
            fromEntry(h.takeProfit.price),
            h.open ? away(h.takeProfit.price, now) : null,
            outcome(h.takeProfit.price) != null
              ? `If hit: ${formatSignedWithUnit(outcome(h.takeProfit.price))}${ofMoney(outcome(h.takeProfit.price)) ? ` (${ofMoney(outcome(h.takeProfit.price))})` : ""}`
              : null,
          ]}
          check={h.takeProfit.check}
          orderId={h.takeProfit.orderId}
          exchangeName={exchangeName}
        />
      </div>

      {/* Timeline */}
      <ol className="relative space-y-2 border-l border-border pl-4">
        <TimelineItem icon={<ShieldCheck size={13} className="text-sky-400" />} at={h.original.at} title="Trade opened · stop set">
          <LevelLine label="Stop" price={h.original.price} extra={[fromEntry(h.original.price)]} amount={outcome(h.original.price)} ofMoney={ofMoney(outcome(h.original.price))} />
          <LevelLine label="Entry" price={entry} extra={[`${h.quantity ?? "—"} ${h.symbol.replace(/USDT$/, "")} · ${h.leverage ?? "—"}x · your money ${formatWithUnit(h.margin, 2)}`]} />
          <OrderProof label="Stop order" orderId={h.original.orderId} />
        </TimelineItem>

        {h.armed && (
          <TimelineItem icon={<Lock size={13} className="text-amber-400" />} at={h.armed.at} title="Trailing switched on">
            <div className="tabular-nums text-muted-foreground">
              Trade reached {h.armed.bestR != null ? `+${h.armed.bestR.toFixed(2)}R` : "its trigger"}
              {h.armed.best != null && <> at {formatWithUnit(h.armed.best)} ({fromEntry(h.armed.best)})</>} — the stop now moves to entry and follows the price.
            </div>
          </TimelineItem>
        )}

        {h.moves.map((m, i) => {
          const before = outcome(m.from);
          const after = outcome(m.to);
          return (
            <TimelineItem key={`m${i}`} icon={<ArrowRight size={13} className="text-emerald-400" />} at={m.at} title={`Stop moved${m.rule ? ` · ${m.rule}` : ""}`}>
              <div className="flex flex-wrap items-center gap-1.5 tabular-nums text-foreground">
                <span>{formatWithUnit(m.from)}</span>
                <ArrowRight size={12} className="text-muted-foreground" />
                <span className="font-semibold">{formatWithUnit(m.to)}</span>
                <span className="text-muted-foreground">({fromEntry(m.to)})</span>
              </div>
              {m.price != null && (
                <div className="text-muted-foreground tabular-nums">
                  Price then {formatWithUnit(m.price)} · stop {formatPct(((m.to - m.price) / m.price) * 100)} away
                </div>
              )}
              <div className="tabular-nums">
                <span className="text-muted-foreground">If the stop hits: </span>
                <span className={amountTone(before)}>{formatSignedWithUnit(before)}</span>
                {ofMoney(before) && <span className="text-muted-foreground"> ({ofMoney(before)})</span>}
                <ArrowRight size={11} className="mx-1 inline text-muted-foreground" />
                <span className={cn("font-semibold", amountTone(after))}>{formatSignedWithUnit(after)}</span>
                {ofMoney(after) && <span className="text-muted-foreground"> ({ofMoney(after)})</span>}
              </div>
              <OrderProof label="New stop order" orderId={m.newOrderId} status={m.newOrderStatus} />
              <OrderProof label="Old stop order" orderId={m.oldOrderId} status={m.oldOrderCancelled == null ? null : m.oldOrderCancelled ? "CANCELLED" : "CANCEL NOT CONFIRMED"} />
            </TimelineItem>
          );
        })}

        {h.failures.map((f, i) => (
          <TimelineItem key={`f${i}`} icon={<CircleAlert size={13} className="text-amber-400" />} at={f.at} title="Couldn't move the stop">
            {f.wanted != null && <div className="tabular-nums text-muted-foreground">Wanted {formatWithUnit(f.wanted)} ({fromEntry(f.wanted)})</div>}
            <div className="break-words text-amber-300/90">{f.reason}</div>
          </TimelineItem>
        ))}

        {!h.open && (
          <TimelineItem icon={<XCircle size={13} className="text-zinc-400" />} at={h.closedAt} title={`Closed${h.exitReason ? ` · ${h.exitReason.replace(/_/g, " ").toLowerCase()}` : ""}`}>
            <LevelLine label="Exit" price={h.exitPrice} extra={[fromEntry(h.exitPrice)]} amount={outcome(h.exitPrice)} ofMoney={ofMoney(outcome(h.exitPrice))} />
          </TimelineItem>
        )}
      </ol>

      {h.moves.length === 0 && h.open && (
        <p className="text-[11px] text-muted-foreground">
          The stop hasn&apos;t moved yet. {h.trailRule} It only ever moves in your favour, never back.
        </p>
      )}
    </div>
  );
}

function amountTone(v: number | null) {
  return v == null ? "" : v >= 0 ? "text-emerald-400" : "text-red-400";
}

function LevelCard({
  icon,
  title,
  tone,
  price,
  lines,
  check,
  orderId,
  exchangeName,
}: {
  icon: React.ReactNode;
  title: string;
  tone: "good" | "bad";
  price: number | null;
  lines: (string | null)[];
  check: StopHistoryOrderCheck | null;
  orderId: string | null;
  exchangeName: string;
}) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className={cn("text-base font-semibold tabular-nums", tone === "good" ? "text-emerald-400" : "text-red-400")}>{formatWithUnit(price)}</div>
      {lines.filter(Boolean).map((l) => (
        <div key={l} className="tabular-nums text-muted-foreground">
          {l}
        </div>
      ))}
      {check ? (
        <ExchangeCheck check={check} exchangeName={exchangeName} />
      ) : (
        <OrderProof label="Order" orderId={orderId} />
      )}
    </div>
  );
}

function ExchangeCheck({ check, exchangeName }: { check: StopHistoryOrderCheck; exchangeName: string }) {
  const Icon = check.active ? CheckCircle2 : check.active === false ? XCircle : CircleDashed;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", check.active ? "text-emerald-400" : check.active === false ? "text-red-400" : "text-amber-400")}>
      <Icon size={12} />
      <span>
        {exchangeName}: {check.status ?? (check.error ? "couldn't check" : "unknown")}
        {check.active ? " (active)" : ""}
      </span>
      <span className="text-muted-foreground">· checked {formatDate(check.checkedAt, { year: undefined, second: "2-digit" })}</span>
      <OrderId id={check.orderId} />
      {check.error && <span className="w-full text-[10px] text-muted-foreground">{check.error}</span>}
    </div>
  );
}

function TimelineItem({ icon, at, title, children }: { icon: React.ReactNode; at: string | null; title: string; children: React.ReactNode }) {
  return (
    <li className="relative space-y-0.5 text-xs">
      <span className="absolute -left-[23px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card">{icon}</span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{at ? formatDate(at, { second: "2-digit" }) : "—"}</span>
      </div>
      {children}
    </li>
  );
}

function LevelLine({ label, price, extra = [], amount, ofMoney }: { label: string; price: number | null; extra?: (string | null)[]; amount?: number | null; ofMoney?: string | null }) {
  return (
    <div className="tabular-nums">
      <span className="text-muted-foreground">{label} </span>
      <span className="text-foreground">{formatWithUnit(price)}</span>
      {extra.filter(Boolean).map((e) => (
        <span key={e} className="text-muted-foreground"> · {e}</span>
      ))}
      {amount !== undefined && amount != null && (
        <>
          <span className="text-muted-foreground"> · if hit </span>
          <span className={amountTone(amount)}>{formatSignedWithUnit(amount)}</span>
          {ofMoney && <span className="text-muted-foreground"> ({ofMoney})</span>}
        </>
      )}
    </div>
  );
}

function OrderProof({ label, orderId, status }: { label: string; orderId: string | null; status?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      <span>{label}:</span>
      {orderId ? <OrderId id={orderId} /> : <span>not recorded</span>}
      {status && (
        <span className={cn("rounded px-1 py-px text-[10px] font-semibold", status === "CANCELLED" || status === "OPEN" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400")}>
          {status}
        </span>
      )}
    </div>
  );
}

/** Order id shown short; full id on hover and selectable, so it can be searched in the exchange app / Order History. */
function OrderId({ id }: { id: string | null }) {
  if (!id) return null;
  const short = id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
  return (
    <span className="cursor-text select-all rounded bg-muted px-1 font-mono text-[10px] text-foreground/80" title={id}>
      {short}
    </span>
  );
}
