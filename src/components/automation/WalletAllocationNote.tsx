"use client";

import { effectiveAllocation } from "@/automation/risk/allocation-headroom";

interface WalletAllocationNoteProps {
  requestedPct: number;
  wallet: number | null;
  format: (usdt: number) => string;
}

/**
 * Explains what a wallet percentage actually allocates: requests above the safe
 * maximum are capped (margin headroom for fees/rounding), and the allocation is
 * a ceiling — each trade's margin is sized by Max Risk and the stop distance.
 */
export function WalletAllocationNote({ requestedPct, wallet, format }: WalletAllocationNoteProps) {
  if (wallet == null || !(wallet > 0) || !Number.isFinite(requestedPct) || requestedPct <= 0) return null;
  const allocation = effectiveAllocation(requestedPct, wallet);

  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {allocation.capped ? (
        <p className="text-amber-400">
          You chose {allocation.requestedPct}%. The bot will use up to {allocation.effectivePct.toFixed(1)}% (≈{" "}
          {format(allocation.amount)}) of your {format(wallet)} available — the rest stays free for fees and margin
          buffer so the exchange never rejects the order.
        </p>
      ) : (
        <p>≈ {format(allocation.amount)}</p>
      )}
      <p>
        Worked out from the money that is FREE in your wallet each time the bot looks for a trade — money already in
        other bots&apos; trades is not counted, so several bots can use 100%. Each trade&apos;s margin is sized by your
        Max Risk and the stop distance, so it is often much less.
      </p>
    </div>
  );
}
