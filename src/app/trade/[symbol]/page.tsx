"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import TradingChart from "@/components/TradingChart";
import TickerBar from "@/components/TickerBar";
import WalletSummary from "@/components/WalletSummary";
import PlaceOrderPanel from "@/components/PlaceOrderPanel";
import PositionsPanel from "@/components/PositionsPanel";
import OpenOrdersPanel from "@/components/OpenOrdersPanel";
import { futuresTickerSocket, TickerData } from "@/lib/coinswitch/futuresTickerSocket";

export default function TradePage() {
  const params = useParams();
  const router = useRouter();
  const symbol = (params.symbol as string).toUpperCase();

  const [ticker, setTicker] = useState<TickerData | null>(null);

  useEffect(() => {
    setTicker(null);
    futuresTickerSocket.connect(symbol, (data) => setTicker(data));
    return () => futuresTickerSocket.disconnect();
  }, [symbol]);

  return (
    <div className="min-h-screen p-6">
      <div className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => router.push("/dashboard/market")}>
          <ChevronLeft size={16} /> Markets
        </Button>
        <h1 className="text-2xl font-bold">{symbol} Futures</h1>
      </div>

      <WalletSummary />
      <TickerBar ticker={ticker} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card className="bg-card">
            <CardContent className="flex h-[500px] items-center justify-center p-0">
              <TradingChart symbol={symbol} />
            </CardContent>
          </Card>
          <PositionsPanel symbol={symbol} />
          <OpenOrdersPanel symbol={symbol} />
        </div>

        <PlaceOrderPanel symbol={symbol} markPrice={ticker ? Number(ticker.c) : null} />
      </div>
    </div>
  );
}
