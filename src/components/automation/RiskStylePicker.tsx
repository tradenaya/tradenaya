"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { Label } from "@/components/ui/label";
import { errorMessage, fetchData } from "@/lib/api-client";

export type RiskStyle = "SAFE" | "RISKY";

type Level = "PREDICTABLE" | "NORMAL" | "VOLATILE";

interface CoinCondition {
  symbol: string;
  level: Level;
  reasons: string[];
}

interface MarketConditionView {
  level: Level;
  recommended: RiskStyle;
  headline: string;
  basis: "coin" | "market-leaders";
  timeframe: string;
  coins: CoinCondition[];
}

const LEVEL_META: Record<Level, { label: string; className: string }> = {
  PREDICTABLE: { label: "Predictable", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
  NORMAL: { label: "Mixed", className: "border-amber-500/30 bg-amber-500/10 text-amber-400" },
  VOLATILE: { label: "Volatile", className: "border-red-500/30 bg-red-500/10 text-red-400" },
};

interface RiskStylePickerProps {
  value: RiskStyle;
  onChange: (value: RiskStyle) => void;
  /** Bot timeframe the market is judged on. */
  timeframe: string;
  /** Fixed coin, or null for an auto-select bot (judged on the market leaders). */
  symbol: string | null;
  /** Show the live "Market right now" read (off for backtests, which run on past prices). */
  showMarket?: boolean;
}

/**
 * Trade style (Safe / Risky) with a live "is the market predictable?" read so
 * the user can pick based on current conditions. Used by create and edit, for
 * paper and live bots alike.
 */
export function RiskStylePicker({ value, onChange, timeframe, symbol, showMarket = true }: RiskStylePickerProps) {
  const [condition, setCondition] = useState<MarketConditionView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ timeframe });
        if (symbol) params.set("symbol", symbol);
        const data = await fetchData<MarketConditionView>(`/api/bots/market-condition?${params.toString()}`, { signal });
        setCondition(data);
      } catch (err) {
        if (signal?.aborted) return;
        setError(errorMessage(err, "Could not read the market right now."));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [timeframe, symbol],
  );

  useEffect(() => {
    if (!showMarket) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load, showMarket]);

  const meta = condition ? LEVEL_META[condition.level] : null;
  const riskyAgainstMarket = value === "RISKY" && condition != null && condition.level !== "PREDICTABLE";

  return (
    <div className="space-y-2 md:col-span-2">
      <Label>Trade style</Label>
      <div className="grid grid-cols-2 gap-2">
        <StyleButton
          active={value === "SAFE"}
          onClick={() => onChange("SAFE")}
          tone="safe"
          icon={<ShieldCheck size={14} />}
          title="Safe"
          text="Each trade is sized so a stop-loss hit loses at most your Max risk %."
        />
        <StyleButton
          active={value === "RISKY"}
          onClick={() => onChange("RISKY")}
          tone="risky"
          icon={<Zap size={14} />}
          title="Risky — full amount"
          text="Uses the whole amount as margin. One stop-loss hit can lose a big part of it."
        />
      </div>

      {showMarket && (
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-foreground">
            Market right now{" "}
            <span className="font-normal text-muted-foreground">
              ({timeframe}, {symbol ? symbol : "market leaders: BTC, ETH, SOL, XRP, BNB, DOGE"})
            </span>
          </p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="Refresh market condition"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>

        {error && <p className="mt-2 text-red-400">{error}</p>}
        {!error && loading && !condition && <p className="mt-2 text-muted-foreground">Reading recent candles…</p>}

        {condition && meta && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}>{meta.label}</span>
              <span className="text-foreground">{condition.headline}</span>
            </div>
            {condition.basis === "coin" && condition.coins[0] ? (
              <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                {condition.coins[0].reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {condition.coins.map((c) => (
                  <span
                    key={c.symbol}
                    title={c.reasons.join(" · ")}
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${LEVEL_META[c.level].className}`}
                  >
                    {c.symbol.replace(/USDT$/, "")}: {LEVEL_META[c.level].label}
                  </span>
                ))}
              </div>
            )}
            <p className="text-muted-foreground">
              Suggested: <span className="font-medium text-foreground">{condition.recommended === "RISKY" ? "Risky can be considered" : "Safe"}</span>
              {" — "}this is a read of recent candles, not a promise about what happens next.
            </p>
          </div>
        )}
      </div>
      )}

      {value === "RISKY" && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            {riskyAgainstMarket && <p className="font-semibold">The market isn&apos;t predictable right now — Risky is not recommended.</p>}
            <p>
              Risky ignores Max risk / trade: the whole amount is used as margin at the bot&apos;s leverage. A stop-loss is still placed on every
              trade and the bot still checks the stop-loss is hit before liquidation (lowering leverage or skipping the trade if not). Your daily
              loss limit still applies.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function StyleButton({
  active,
  onClick,
  tone,
  icon,
  title,
  text,
}: {
  active: boolean;
  onClick: () => void;
  tone: "safe" | "risky";
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  const activeClass =
    tone === "safe" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-red-500/40 bg-red-500/10 text-red-400";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
        active ? activeClass : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
      }`}
    >
      <span className="flex items-center gap-1.5 font-medium">
        {icon}
        {title}
      </span>
      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{text}</span>
    </button>
  );
}
