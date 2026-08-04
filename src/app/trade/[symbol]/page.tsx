"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import TradingChart from "@/components/TradingChart";
import TickerBar from "@/components/TickerBar";
import WalletSummary from "@/components/WalletSummary";
import PlaceOrderPanel from "@/components/PlaceOrderPanel";
import PositionsPanel from "@/components/PositionsPanel";
import OpenOrdersPanel from "@/components/OpenOrdersPanel";
import { futuresTickerSocket, TickerData } from "@/lib/coinswitch/futuresTickerSocket";

export default function TradePage() {
  const params = useParams();
  const symbol = (params.symbol as string).toUpperCase();

  const [ticker, setTicker] = useState<TickerData | null>(null);

  useEffect(() => {
    setTicker(null);
    futuresTickerSocket.connect(symbol, (data) => setTicker(data));
    return () => futuresTickerSocket.disconnect();
  }, [symbol]);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-6">
      <h1 className="text-3xl font-bold mb-6">{symbol} Futures</h1>

      <WalletSummary />
      <TickerBar ticker={ticker} />

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2">
          <div className="bg-[var(--card)] rounded-xl h-[500px] flex items-center justify-center">
            <TradingChart symbol={symbol} />
          </div>
          <PositionsPanel symbol={symbol} />
          <OpenOrdersPanel symbol={symbol} />
        </div>

        <PlaceOrderPanel symbol={symbol} markPrice={ticker ? Number(ticker.c) : null} />
      </div>
    </div>
  );
}