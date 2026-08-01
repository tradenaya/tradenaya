"use client";

import { useEffect, useState } from "react";

interface Position {
  position_id: string;
  symbol: string;
  position_side: "LONG" | "SHORT";
  leverage: string;
  position_size: string;
  position_value: string;
  position_margin: string;
  maint_margin: string;
  avg_entry_price: string;
  mark_price: string;
  liquidation_price: string;
  unrealised_pnl: string;
  margin_type: string;
  status: string;
}

export default function PositionsPanel({ symbol }: { symbol: string }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchPositions() {
      try {
        const res = await fetch(`/api/coinswitch/futures/positions?symbol=${symbol}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!cancelled && json.success) {
          setPositions(json.data ?? []);
        }
      } catch {
        // stay silent on transient poll failures — next tick will retry
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPositions();
    const interval = setInterval(fetchPositions, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol]);

  if (loading) {
    return (
      <div className="bg-zinc-900 rounded-xl p-5 mt-5 text-zinc-500 text-sm">
        Loading positions…
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="bg-zinc-900 rounded-xl p-5 mt-5 text-zinc-500 text-sm">
        No open position on {symbol}.
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 rounded-xl p-5 mt-5">
      <h2 className="text-xl font-bold mb-4">Open Position</h2>

      {positions.map((pos) => {
        const pnl = Number(pos.unrealised_pnl);
        const isProfit = pnl >= 0;
        const markPrice = Number(pos.mark_price);
        const liqPrice = Number(pos.liquidation_price);
        const liqDistance =
          markPrice > 0 ? (Math.abs(markPrice - liqPrice) / markPrice) * 100 : 0;
        const liqWarning = liqDistance < 10; // within 10% of liquidation

        return (
          <div key={pos.position_id} className="bg-zinc-800 rounded-lg p-4 text-sm">
            <div className="flex justify-between items-center mb-3">
              <span
                className={`px-2 py-0.5 rounded text-xs font-bold ${
                  pos.position_side === "LONG"
                    ? "bg-emerald-600/20 text-emerald-400"
                    : "bg-red-600/20 text-red-400"
                }`}
              >
                {pos.position_side} {pos.leverage}x
              </span>
              <span className="text-zinc-500 text-xs">{pos.margin_type}</span>
            </div>

            <Row label="Size" value={`${pos.position_size} ${symbol.replace("USDT", "")}`} />
            <Row label="Entry Price" value={pos.avg_entry_price} />
            <Row label="Mark Price" value={pos.mark_price} />
            <Row
              label="Unrealised PnL"
              value={`${isProfit ? "+" : ""}${pnl.toFixed(4)} USDT`}
              valueClass={isProfit ? "text-emerald-400" : "text-red-400"}
            />
            <Row label="Position Margin" value={`${pos.position_margin} USDT`} />
            <Row label="Position Value" value={`${pos.position_value} USDT`} />
            <Row
              label="Liquidation Price"
              value={pos.liquidation_price}
              valueClass={liqWarning ? "text-red-400 font-bold" : undefined}
            />
            {liqWarning && (
              <p className="text-red-400 text-xs mt-2">
                ⚠️ Mark price is within {liqDistance.toFixed(1)}% of liquidation — consider adding margin or reducing size.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-zinc-500">{label}</span>
      <span className={valueClass ?? "text-white"}>{value}</span>
    </div>
  );
}