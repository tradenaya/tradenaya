"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { fetchData } from "@/lib/api-client";
import { StopLossHistory } from "./StopLossHistory";
import { CandlestickChart } from "lucide-react";
import { formatTimestamp } from "@/components/analytics/format";
import { positionSideLabel, sideBadgeClass } from "@/components/trading/terms";
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider";
import { formatWithUnit, formatPct, formatSignedWithUnit } from "@/lib/currency/store";

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
  positionId: number;
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

/** USDT price/amount in the chosen display currency. */
function money(value: number | string | null | undefined, digits?: number): string {
  return formatWithUnit(num(value), digits);
}

/** Quantity in coin units — never currency-converted. */
function qty(value: number | string | null | undefined, digits = 4): string {
  const n = num(value);
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function balance(value: number | null): string {
  return formatWithUnit(value, 2);
}

interface Props {
  position: ExchangePosition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PositionDetailSheet({ position, open, onOpenChange }: Props) {
  const router = useRouter();
  useDisplayCurrency();
  const [detail, setDetail] = useState<AutomationPositionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      if (!cancelled) {
        setLoading(true);
        setError(null);
        setDetail(null);
      }
      try {
        const data = await fetchData<unknown>("/api/analytics/positions");
        const list = Array.isArray(data) ? data : [];
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
          setError(err);
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

  // Money made (+) or lost (−) if the position closed at a price (before fees).
  const size = num(position.position_size);
  const outcomeAt = (price: number | null): number | null =>
    price == null || entry == null || size == null ? null : (price - entry) * size * (isLong ? 1 : -1);
  const ofMoney = (v: number | null) => (v != null && margin != null && margin > 0 ? ` (${formatPct((v / margin) * 100)} of your money)` : "");
  const outcomeText = (v: number | null) => (v == null ? "" : ` · ${v >= 0 ? `you make ${formatSignedWithUnit(v)}` : `you lose ${balance(Math.abs(v))}`}${ofMoney(v)}`);
  const awayText = (d: number | null) => (d == null ? "" : ` · price ${formatPct(d)} away`);

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

        <Button
          variant="outline"
          className="mx-4 mb-3 flex items-center gap-1.5"
          onClick={() => {
            onOpenChange(false);
            router.push(`/trade/${position.symbol}`);
          }}
        >
          <CandlestickChart size={14} /> View Chart
        </Button>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-6">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          ) : error != null ? (
            <ErrorState error={error} title="Couldn't load position details" />
          ) : (
            <>
              <div
                className={`rounded-lg border p-4 ${
                  pnl != null && pnl < 0 ? "border-red-500/30" : "border-emerald-500/30"
                }`}
              >
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Profit / loss now
                </div>
                <div
                  className={`mt-1 text-3xl font-bold tabular-nums ${
                    pnl != null && pnl < 0 ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {formatSignedWithUnit(pnl)}
                </div>
                {margin != null && (
                  <div className="mt-1 text-sm text-muted-foreground tabular-nums">
                    {pnl != null && margin > 0 ? `${formatPct((pnl / margin) * 100)} ` : ""}on {balance(margin)} of your money
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
                  value: sl != null ? `${money(sl)}${awayText(slDistance)}${outcomeText(outcomeAt(sl))}` : "—",
                  tone: slDistance != null && ((isLong && slDistance < 0) || (!isLong && slDistance > 0)) ? "text-red-400" : undefined,
                },
                {
                  label: "Take profit",
                  value: tp != null ? `${money(tp)}${awayText(tpDistance)}${outcomeText(outcomeAt(tp))}` : "—",
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
                { label: "Size", value: `${qty(position.position_size)} ${String(position.symbol ?? "").toUpperCase().replace(/USDT$/, "")}` },
                { label: "Your money in", value: money(margin) },
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

              {detail?.positionId != null && (
                <div className="rounded-lg border border-border p-3">
                  <StopLossHistory positionId={detail.positionId} />
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
