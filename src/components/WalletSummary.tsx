"use client";

import { useEffect, useState } from "react";

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
    const interval = setInterval(fetchBalance, 10000); // refresh every 10s

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) {
    return (
      <div className="w-full bg-zinc-900 rounded-xl p-4 mb-5 text-red-400 text-sm">
        Failed to load wallet balance: {error}
      </div>
    );
  }

  if (!balances) {
    return (
      <div className="w-full bg-zinc-900 rounded-xl p-4 mb-5 text-zinc-500 text-sm">
        Loading wallet balance…
      </div>
    );
  }

  const total = Number(balances.total_balance);
  const isEmpty = total === 0;

  return (
    <div className="w-full bg-zinc-900 rounded-xl p-4 mb-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
        <Stat label="Total Balance" value={`${balances.total_balance} USDT`} />
        <Stat label="Available" value={`${balances.total_available_balance} USDT`} highlight />
        <Stat label="Blocked" value={`${balances.total_blocked_balance} USDT`} />
        <Stat label="In Positions" value={`${balances.total_position_margin} USDT`} />
        <Stat label="In Open Orders" value={`${balances.total_open_order_margin} USDT`} />
      </div>

      {isEmpty && (
        <p className="text-yellow-400 text-xs mt-3">
          ⚠️ Futures wallet balance is 0 — deposit/transfer funds into your Futures wallet on
          CoinSwitch before placing real orders.
        </p>
      )}
    </div>
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
    <div>
      <div className="text-zinc-500 text-xs mb-1">{label}</div>
      <div className={`font-semibold ${highlight ? "text-emerald-400" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}