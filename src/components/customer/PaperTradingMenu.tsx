"use client";

import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { ErrorState } from "@/components/ui/error-state";
import { fetchData } from "@/lib/api-client";
import { formatUsdtAmount } from "@/lib/currency/store";
import { useDisplayCurrency } from "@/lib/currency/CurrencyProvider";
import { setTradingMode } from "@/lib/trading-mode/store";
import { useTradingMode } from "@/lib/trading-mode/TradingModeProvider";

interface PaperWalletSnapshot {
  balance: number;
  initialBalance: number;
  available: number;
  equity: number;
  unrealizedPnl: number;
}

/** Live / Paper switch + paper wallet controls for the profile dropdown. */
export function PaperTradingMenu() {
  useDisplayCurrency();
  const mode = useTradingMode();
  const paper = mode === "PAPER";
  const [wallet, setWallet] = useState<PaperWalletSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!paper) return;
    let cancelled = false;
    fetchData<PaperWalletSnapshot>("/api/paper/wallet")
      .then((w) => {
        if (!cancelled) setWallet(w);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [paper]);

  async function reset() {
    setSaving(true);
    setError(null);
    try {
      const w = await fetchData<PaperWalletSnapshot>("/api/paper/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      setWallet(w);
      setAmount("");
      setConfirming(false);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  const amountValid = Number(amount) > 0;
  const pnl = wallet ? wallet.equity - wallet.initialBalance : 0;

  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm">
          <FlaskConical size={14} /> Trading
        </span>
        <div role="radiogroup" aria-label="Trading mode" className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--border)" }}>
          {(["LIVE", "PAPER"] as const).map((m) => {
            const active = mode === m;
            return (
              <button
                key={m}
                role="radio"
                aria-checked={active}
                onClick={() => setTradingMode(m)}
                className="px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer"
                style={active ? { backgroundColor: m === "PAPER" ? "#d97706" : "var(--primary)", color: m === "PAPER" ? "#111" : "var(--primary-foreground, #fff)" } : { color: "var(--muted-foreground)" }}
              >
                {m === "LIVE" ? "Live" : "Paper"}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-1.5 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
        {paper
          ? "Paper trading: simulated money, real prices. Everything you see and every bot you create now is paper only."
          : "Live trading with your real CoinSwitch account."}
      </p>

      {paper && (
        <div className="mt-2.5 space-y-2 rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--border)" }}>
          {wallet ? (
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
              <span style={{ color: "var(--muted-foreground)" }}>Paper balance</span>
              <span className="text-right font-semibold tabular-nums">{formatUsdtAmount(wallet.balance)}</span>
              <span style={{ color: "var(--muted-foreground)" }}>Available</span>
              <span className="text-right tabular-nums">{formatUsdtAmount(wallet.available)}</span>
              <span style={{ color: "var(--muted-foreground)" }}>Profit since reset</span>
              <span className={`text-right tabular-nums ${pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-red-400" : ""}`}>
                {pnl > 0 ? "+" : ""}
                {formatUsdtAmount(pnl)}
              </span>
            </div>
          ) : error == null ? (
            <div className="h-10 animate-pulse rounded bg-muted" />
          ) : null}

          {!confirming ? (
            <div className="flex gap-1.5">
              <input
                type="number"
                min={1}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="New balance (USDT)"
                className="h-7 w-full min-w-0 rounded-md border bg-transparent px-2 text-xs"
                style={{ borderColor: "var(--border)" }}
              />
              <button
                type="button"
                disabled={!amountValid}
                onClick={() => setConfirming(true)}
                className="h-7 shrink-0 rounded-md px-2 text-xs font-medium disabled:opacity-40"
                style={{ backgroundColor: "var(--muted)", color: "var(--foreground)" }}
              >
                Set
              </button>
            </div>
          ) : (
            <div className="space-y-1.5 text-[11px]">
              <p>
                Reset the paper wallet to <b>{Number(amount).toLocaleString("en-US")} USDT</b>? Paper trade history is kept; the
                balance starts over.
              </p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setConfirming(false)} className="h-7 flex-1 rounded-md text-xs" style={{ backgroundColor: "var(--muted)" }}>
                  Cancel
                </button>
                <button type="button" disabled={saving} onClick={reset} className="h-7 flex-1 rounded-md text-xs font-semibold text-black" style={{ backgroundColor: "#d97706" }}>
                  {saving ? "Saving…" : "Reset"}
                </button>
              </div>
            </div>
          )}

          {error != null && <ErrorState error={error} title="Paper wallet" compact />}
        </div>
      )}
    </div>
  );
}
