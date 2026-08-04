"use client";

import { TickerData } from "@/lib/coinswitch/futuresTickerSocket";

export default function TickerBar({ ticker }: { ticker: TickerData | null }) {
  if (!ticker) {
    return (
      <div className="w-full bg-[var(--card)] rounded-xl p-4 text-[var(--muted-foreground)] text-sm mb-5">
        Loading market data…
      </div>
    );
  }

  const changePct = Number(ticker.P);
  const isUp = changePct >= 0;

  const nextFundingIn = Math.max(0, ticker.T - Date.now());
  const hours = Math.floor(nextFundingIn / (1000 * 60 * 60));
  const mins = Math.floor((nextFundingIn % (1000 * 60 * 60)) / (1000 * 60));

  return (
    <div className="w-full bg-[var(--card)] rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-5">
      <Stat label="Last Price" value={ticker.c} highlight={isUp ? "up" : "down"} />
      <Stat label="24h Change" value={`${isUp ? "+" : ""}${changePct.toFixed(2)}%`} highlight={isUp ? "up" : "down"} />
      <Stat label="24h High" value={ticker.h} />
      <Stat label="24h Low" value={ticker.l} />
      <Stat label="Mark Price" value={ticker.p?.toFixed(6)} />
      <Stat label="Index Price" value={ticker.i?.toFixed(6)} />
      <Stat label="Funding Rate" value={`${(ticker.r * 100).toFixed(4)}%`} />
      <Stat label="Next Funding" value={`${hours}h ${mins}m`} />
      <Stat label="24h Volume (Base)" value={ticker.bv} />
      <Stat label="24h Volume (USDT)" value={Number(ticker.qv).toLocaleString()} />
      <Stat label="Best Bid" value={ticker.b} />
      <Stat label="Best Ask" value={ticker.a} />
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string | number | undefined; highlight?: "up" | "down" }) {
  return (
    <div>
      <div className="text-zinc-500 text-xs mb-1">{label}</div>
      <div className={`font-semibold ${highlight === "up" ? "text-emerald-400" : highlight === "down" ? "text-red-400" : "text-[var(--foreground)]"}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}