"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { StatsSkeleton } from "@/components/ui/skeletons";
import { fetchData } from "@/lib/api-client";
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider";
import { convertUsdt, currencyLabel, getCurrencyState } from "@/lib/currency/store";
import { ConvertInrToUsdtBanner } from "@/components/coinswitch/convert";

interface WalletBalances {
  total_balance: string;
  total_available_balance: string;
  total_blocked_balance: string;
  total_position_margin: string;
  total_open_order_margin: string;
}

export default function WalletSummary() {
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cancelled = useRef(false);
  useDisplayCurrency();

  async function fetchBalance() {
    try {
      const data = await fetchData<{ base_asset_balances?: { base_asset: string; balances: WalletBalances }[] }>(
        "/api/coinswitch/futures/wallet-balance",
      );
      if (cancelled.current) return;

      const usdt = data?.base_asset_balances?.find((b) => b.base_asset === "USDT");
      setBalances(usdt ? usdt.balances : null);
      setError(null);
    } catch (err) {
      if (!cancelled.current) setError(err);
    } finally {
      if (!cancelled.current) setLoaded(true);
    }
  }

  useEffect(() => {
    cancelled.current = false;
    void fetchBalance();
    const interval = setInterval(fetchBalance, 10000);

    return () => {
      cancelled.current = true;
      clearInterval(interval);
    };
  }, []);

  if (error != null && !balances) {
    return (
      <Card className="mb-5 bg-card">
        <CardContent className="py-4">
          <ErrorState error={error} title="Couldn't load your wallet balance" onRetry={() => void fetchBalance()} />
          <ConvertInrToUsdtBanner className="mt-3" onConverted={() => void fetchBalance()} />
        </CardContent>
      </Card>
    );
  }

  if (!loaded) {
    return (
      <Card className="mb-5 bg-card">
        <CardContent className="py-4">
          <StatsSkeleton count={5} className="md:grid-cols-5" />
        </CardContent>
      </Card>
    );
  }

  if (!balances) {
    return (
      <Card className="mb-5 bg-card">
        <CardContent className="space-y-3 py-4 text-sm text-muted-foreground">
          <p>No USDT balance found in your CoinSwitch futures wallet.</p>
          <ConvertInrToUsdtBanner onConverted={() => void fetchBalance()} />
        </CardContent>
      </Card>
    );
  }

  const total = Number(balances.total_balance);
  const isEmpty = total === 0;

  const money = (value: string): string => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "—";
    const state = getCurrencyState();
    const conv = convertUsdt(num);
    const isInr = state.currency === "INR" && conv != null;
    return `${(conv ?? num).toLocaleString(isInr ? "en-IN" : "en-US", { maximumFractionDigits: 2 })} ${currencyLabel()}`;
  };

  return (
    <Card className="mb-5 bg-card">
      <CardContent className="py-4">
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
          <Stat label="Total Balance" value={money(balances.total_balance)} />
          <Stat label="Available" value={money(balances.total_available_balance)} highlight />
          <Stat label="Blocked" value={money(balances.total_blocked_balance)} />
          <Stat label="In Positions" value={money(balances.total_position_margin)} />
          <Stat label="In Open Orders" value={money(balances.total_open_order_margin)} />
        </div>

        <ConvertInrToUsdtBanner
          className="mt-3"
          onConverted={() => void fetchBalance()}
        />

        {isEmpty && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle size={13} className="text-amber-400" />
            Futures wallet balance is 0 — deposit/transfer funds into your Futures wallet on
            CoinSwitch before placing real orders.
          </p>
        )}
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
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className={`min-w-0 font-semibold break-all ${highlight ? "text-emerald-400" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}