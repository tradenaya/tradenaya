"use client";

import { TickerData } from "@/lib/coinswitch/futuresTickerSocket";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function TickerBar({ ticker }: { ticker: TickerData | null }) {
  if (!ticker) {
    return (
      <Card className="mb-5 bg-card">
        <CardContent className="py-4">
          <Skeleton className="h-8 w-full rounded-md" />
        </CardContent>
      </Card>
    );
  }

  const changePct = Number(ticker.P);
  const isUp = changePct >= 0;

  const nextFundingIn = Math.max(0, ticker.T - Date.now());
  const hours = Math.floor(nextFundingIn / (1000 * 60 * 60));
  const mins = Math.floor((nextFundingIn % (1000 * 60 * 60)) / (1000 * 60));

  return (
    <Card className="mb-5 bg-card">
      <CardContent className="grid grid-cols-2 gap-4 py-4 text-sm md:grid-cols-4">
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
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number | undefined;
  highlight?: "up" | "down";
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold ${highlight === "up" ? "text-emerald-400" : highlight === "down" ? "text-red-400" : "text-foreground"}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}
