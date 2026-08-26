"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp } from "@/components/analytics/format";
import { positionSideLabel, sideBadgeClass } from "@/components/trading/terms";

export interface ExchangePosition {
  position_id: string;
  symbol: string;
  position_side: "LONG" | "SHORT";
  leverage: string;
  position_size: string;
  avg_entry_price: string;
  mark_price: string;
  unrealised_pnl: string;
  liquidation_price: string;
  position_margin: string;
  created_at?: string | number | null;
  updated_at?: string | number | null;
}

export interface AutomationPositionDetail {
  symbol: string;
  side: "BUY" | "SELL";
  state: string;
  botName: string;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingEnabled: boolean;
  trailingActivated: boolean;
  trailingDistancePct: number | null;
  highestPrice: number | null;
  lowestPrice: number | null;
  protectionStatus: "PROTECTED" | "UNPROTECTED" | "TRAILING" | "PENDING";
  openTime: string;
}

const stateLabel: Record<string, string> = {
  WAITING_ENTRY: "Waiting entry",
  ENTRY_PENDING: "Entry pending",
  ENTRY_EXECUTED: "Entered",
  PROTECTED: "Protected",
  TRAILING: "Trailing",
  UNPROTECTED: "Unprotected",
  CLOSING: "Closing",
  CLOSED: "Closed",
  ERROR: "Error",
};

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: number | string | null | undefined, digits = 4): string {
  const n = num(value);
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function signed(value: number | null, digits = 4): string {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

interface Props {
  position: ExchangePosition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PositionDetailSheet({ position, open, onOpenChange }: Props) {
  const [detail, setDetail] = useState<AutomationPositionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      if (!cancelled) {
        setLoading(true);
        setError("");
        setDetail(null);
      }
      try {
        const res = await fetch("/api/analytics/positions", { cache: "no-store" });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || "Failed to load position details");
        const list = Array.isArray(json.data) ? json.data : [];
        const wantedSide = position.position_side === "LONG" ? "BUY" : "SELL";
        const match = list.find(
          (p: AutomationPositionDetail) =>
            p.symbol === position.symbol && p.side === wantedSide,
        );
        if (!cancelled) {
          setDetail(match ?? null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load position details");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open, position.symbol, position.position_side]);

  const side = position.position_side;
  const isLong = side === "LONG";
  const entry = num(position.avg_entry_price);
  const current = num(position.mark_price);
  const liq = num(position.liquidation_price);
  const pnl = num(position.unrealised_pnl);
  const margin = num(position.position_margin);
  const sl = detail?.stopLoss ?? null;
  const tp = detail?.takeProfit ?? null;

  const pnlPct =
    margin != null && margin !== 0 && pnl != null
      ? (pnl / margin) * 100
      : null;

  const distancePct = (price: number | null): number | null => {
    if (price == null || current == null || current === 0) return null;
    return ((price - current) / current) * 100;
  };

  const slDistance = distancePct(sl);
  const tpDistance = distancePct(tp);
  const liqDistance = distancePct(liq);

  const rows = (header: string, cells: { label: string; value: string; tone?: string }[]) => (
    <div className="rounded-lg border border-border">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {header}
      </div>
      <div className="divide-y divide-border">
        {cells.map((cell) => (
          <div key={cell.label} className="flex items-center justify-between px-3 py-2">
            <span className="text-sm text-muted-foreground">{cell.label}</span>
            <span className={`text-sm font-medium tabular-nums ${cell.tone ?? "text-foreground"}`}>
              {cell.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const riskWarn = (price: number | null, pct: number | null) => {
    if (price == null) return;
    const threshold = Math.abs(pct ?? Infinity);
    return threshold < 1
      ? "text-red-400"
      : threshold < 3
        ? "text-amber-400"
        : undefined;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="text-xl font-bold">{position.symbol}</span>
            <Badge className={sideBadgeClass(position.position_side)}>
              {positionSideLabel(position.position_side)} {position.leverage}x
            </Badge>
          </SheetTitle>
          <SheetDescription>
            {detail
              ? `${detail.botName} · ${stateLabel[detail.state] ?? detail.state}`
              : "Active futures position"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-6">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          ) : error ? (
            <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
          ) : (
            <>
              <div
                className={`rounded-lg border p-4 ${
                  pnl != null && pnl < 0 ? "border-red-500/30" : "border-emerald-500/30"
                }`}
              >
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Unrealized PnL
                </div>
                <div
                  className={`mt-1 text-3xl font-bold tabular-nums ${
                    pnl != null && pnl < 0 ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {signed(pnl)} USDT
                </div>
                {pnlPct != null && (
                  <div
                    className={`mt-1 text-sm font-medium tabular-nums ${
                      pnlPct < 0 ? "text-red-400" : "text-emerald-400"
                    }`}
                  >
                    {signed(pnlPct, 2)}%
                  </div>
                )}
              </div>

              {rows("Prices", [
                {
                  label: "Current (mark)",
                  value: money(current),
                  tone: current != null && entry != null && current !== entry ? "text-amber-400" : undefined,
                },
                {
                  label: "Entry price",
                  value: money(entry),
                },
                {
                  label: "Liquidation",
                  value: money(liq),
                  tone: riskWarn(liq, liqDistance),
                },
              ])}

              {rows("Protection", [
                {
                  label: "Stop loss",
                  value: sl != null ? `${money(sl)}${slDistance != null ? ` · ${slDistance.toFixed(2)}%` : ""}` : "—",
                  tone: slDistance != null && ((isLong && slDistance < 0) || (!isLong && slDistance > 0)) ? "text-red-400" : undefined,
                },
                {
                  label: "Take profit",
                  value: tp != null ? `${money(tp)}${tpDistance != null ? ` · ${tpDistance.toFixed(2)}%` : ""}` : "—",
                  tone: tpDistance != null && ((isLong && tpDistance > 0) || (!isLong && tpDistance < 0)) ? "text-emerald-400" : undefined,
                },
                ...(detail?.trailingEnabled
                  ? [
                      {
                        label: "Trailing stop",
                        value: `${detail.trailingActivated ? "Active" : "Armed"} · ${detail.trailingDistancePct ?? "—"}%`,
                        tone: detail.trailingActivated ? "text-amber-400" : undefined,
                      },
                    ]
                  : []),
              ])}

              {rows("Position", [
                { label: "Size", value: money(position.position_size) },
                { label: "Margin", value: money(margin) },
                {
                  label: "Est. Liq. distance",
                  value: liqDistance != null ? `${liqDistance.toFixed(2)}%` : "—",
                  tone: riskWarn(liq, liqDistance),
                },
                ...(detail?.highestPrice != null
                  ? [{ label: "Highest price", value: money(detail.highestPrice) }]
                  : []),
                ...(detail?.lowestPrice != null
                  ? [{ label: "Lowest price", value: money(detail.lowestPrice) }]
                  : []),
                {
                  label: "Status",
                  value: detail ? stateLabel[detail.state] ?? detail.state : "—",
                },
                ...(detail?.openTime || position.created_at
                  ? [{ label: "Opened", value: formatTimestamp(detail?.openTime ?? position.created_at) }]
                  : []),
              ])}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
