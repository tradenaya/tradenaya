/**
 * Wallet-allocation headroom shared by the UI and the server.
 *
 * At 100% allocation the order margin equals the whole free balance, so a few
 * cents of fees or rounding make the exchange reject with "Insufficient
 * balance". Instead of rejecting a high percentage, the requested percentage is
 * capped at the safe maximum and the user is told what will actually be used.
 *
 * Pure module (no server imports) so client components can use it.
 */

/** Reserve on top of the raw margin for maker/taker fees and min-notional rounding (USDT). */
export const MARGIN_FEE_BUFFER = 0.01;

/** Fraction of the free (available) balance that is always left untouched. */
export const MARGIN_HEADROOM = 0.02;

/**
 * Highest allocation (as a percentage of the available balance) that still
 * leaves the configured headroom + fee buffer untouched.
 */
export function maxSafeAllocationPct(available: number, headroom = MARGIN_HEADROOM, feeBuffer = MARGIN_FEE_BUFFER): number {
  if (!(available > 0)) return 0;
  const override = (available * (1 - headroom) - feeBuffer) / available;
  return Math.max(0, override) * 100;
}

export interface EffectiveAllocation {
  /** Percentage the user asked for. */
  requestedPct: number;
  /** Percentage that will actually be allocated (requested, capped at the safe maximum). */
  effectivePct: number;
  /** USDT that will actually be allocated. */
  amount: number;
  /** True when the request was above the safe maximum and was capped. */
  capped: boolean;
}

/** Resolve a requested wallet percentage against the live available balance. */
export function effectiveAllocation(requestedPct: number, available: number | null | undefined): EffectiveAllocation {
  const requested = Number.isFinite(requestedPct) ? Math.max(0, requestedPct) : 0;
  if (available == null || !(available > 0)) {
    return { requestedPct: requested, effectivePct: requested, amount: 0, capped: false };
  }
  const safe = maxSafeAllocationPct(available);
  const effectivePct = Math.min(requested, safe);
  return {
    requestedPct: requested,
    effectivePct,
    amount: available * (effectivePct / 100),
    capped: requested > safe + 1e-9,
  };
}

/**
 * Share of the wallet (of its TOTAL balance) kept free as a cushion for the
 * fees and margin of trades that are already open. When less than this is
 * free — e.g. a Risky bot put the whole wallet into one trade — other bots
 * wait instead of opening tiny trades from the leftovers.
 */
export const WALLET_RESERVE_PCT = 5;

/** Free balance new trades may use: the available balance, or 0 when only the reserve (or less) is free. */
export function freeForNewTrades(available: number | null | undefined, total: number | null | undefined): number {
  if (available == null || !(available > 0)) return 0;
  const reserve = total != null && total > 0 ? total * (WALLET_RESERVE_PCT / 100) : 0;
  return available <= reserve ? 0 : available;
}
