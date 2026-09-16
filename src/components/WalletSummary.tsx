"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface WalletBalances {
  total_balance: string;
  total_available_balance: string;
  total_blocked_balance: string;
  total_position_margin: string;
  total_open_order_margin: string;
}

export default function WalletSummary() {
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchBalance() {
      try {
        const res = await fetch("/api/coinswitch/futures/wallet-balance", { cache: "no-store" });
        const json = await res.json();

        if (cancelled) return;

        if (!json.success) {
          setError(json.message ?? "failed to load balance");
          return;
        }

        const usdt = json.data.base_asset_balances?.find(
          (b: any) => b.base_asset === "USDT"
        );

        setBalances(usdt ? usdt.balances : null);
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      }
    }

    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) {
    return (
      <Card className="mb-5 bg-card">
        <CardContent className="py-4 text-sm text-red-400">
          Failed to load wallet balance: {error}
        </CardContent>
      </Card>
    );
  }

  if (!balances) {
    return (
      <Card className="mb-5 bg-card">
        <CardContent className="py-4">
          <Skeleton className="h-8 w-full rounded-md" />
        </CardContent>
      </Card>
    );
  }

  const total = Number(balances.total_balance);
  const isEmpty = total === 0;

  return (
    <Card className="mb-5 bg-card">
      <CardContent className="py-4">
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
          <Stat label="Total Balance" value={`${balances.total_balance} USDT`} />
          <Stat label="Available" value={`${balances.total_available_balance} USDT`} highlight />
          <Stat label="Blocked" value={`${balances.total_blocked_balance} USDT`} />
          <Stat label="In Positions" value={`${balances.total_position_margin} USDT`} />
          <Stat label="In Open Orders" value={`${balances.total_open_order_margin} USDT`} />
        </div>

        {isEmpty && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-400">
            <AlertTriangle size={14} />
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
