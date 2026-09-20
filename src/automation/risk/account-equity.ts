import type { ExchangePosition, FuturesWalletSnapshot } from "@/automation/executor/client";

/**
 * Account-equity helpers for live drawdown protection.
 *
 * The authoritative metric for the 15% drawdown check is TRUE account equity,
 * never `total_available_balance`: available balance falls whenever margin is
 * locked into a position/order even when the account has not lost money, which
 * would produce false drawdown rejections.
 */

export interface AccountEquityInput {
  wallet: FuturesWalletSnapshot | null;
  positions: ExchangePosition[];
}

/**
 * Derive the account's true equity from the live exchange fields WITHOUT
 * double-counting:
 *
 *   1. If the wallet endpoint itself reports an authoritative equity value, use
 *      it as-is (position PnL is already included there — adding it again would
 *      double count).
 *   2. Otherwise equity = total wallet balance + Σ unrealized PnL of live open
 *      positions. On CoinSwitch futures, `total_balance` equals
 *      `total_available_balance + total_blocked_balance`, i.e. it is the wallet
 *      balance WITHOUT unrealized PnL, so adding position PnL is additive.
 *
 * Fails safe (returns null) when any required component is missing/invalid —
 * callers must never invent equity (e.g. from available balance or a fixed
 * capital config) when it cannot be measured.
 */
export function computeAccountEquity(input: AccountEquityInput): number | null {
  const wallet = input.wallet;
  if (!wallet) {
    console.warn("[drawdown] computeAccountEquity — no wallet snapshot; equity = null (cannot measure)");
    return null;
  }

  // Authoritative equity from the wallet — positional PnL is already inside it.
  if (wallet.equity != null && Number.isFinite(wallet.equity) && wallet.equity > 0) {
    console.log(
      `[drawdown] account equity source = wallet.equity (authoritative exchange field), value ${wallet.equity}`,
    );
    return wallet.equity;
  }

  const total = wallet.total;
  if (total == null || !Number.isFinite(total) || total <= 0) {
    console.warn(
      `[drawdown] computeAccountEquity — wallet.total missing/invalid (${total}); equity = null (fail safe)`,
    );
    return null;
  }

  const positions = Array.isArray(input.positions) ? input.positions : [];
  let unrealized = 0;
  for (const position of positions) {
    const pnl = position?.unrealizedPnl;
    if (pnl == null || !Number.isFinite(Number(pnl))) {
      // A live position whose PnL is unknown → equity cannot be determined
      // safely. Fail rather than slot in 0 (which could mask a real loss).
      console.warn(
        `[drawdown] computeAccountEquity — position ${position?.symbol} has unknown unrealized PnL; equity = null (fail safe)`,
      );
      return null;
    }
    unrealized += Number(pnl);
  }

  console.log(
    `[drawdown] account equity source = wallet.total ${total} + Σ unrealized PnL ${unrealized} of ${positions.length} open position(s) = ${total + unrealized}`,
  );
  return total + unrealized;
}

export type PeakEquityBasis = "equity" | "available_balance";

export interface DrawdownPeakInput {
  /** True account equity (null when it could not be measured safely). */
  equity: number | null;
  /** Persisted peak stored in automation_bots.peak_equity. */
  persistedPeak: number | null;
  /** Metric the persisted peak was captured under. */
  persistedBasis?: PeakEquityBasis | null;
}

export interface DrawdownPeakResult {
  /** Peak to use for the drawdown check this cycle. */
  peak: number | null;
  /** Metric the returned peak is now expressed in. */
  basis: PeakEquityBasis;
  /** True when the DB row must be updated (new high, or basis migration). */
  needsPersist: boolean;
}

/**
 * Ratchet the persisted drawdown peak using TRUE equity.
 *
 * Migration handling: before this fix, `peak_equity` was persisted under the
 * OLD metric (available balance). An available-balance peak is not comparable
 * to equity, so a legacy peak is NOT reused as the baseline — the peak is
 * explicitly re-baselined to the current true equity exactly once (basis moves
 * to "equity"). This is deliberate: historical values were never a live-loss
 * measurement and silently mixing the two units could spuriously trip the
 * drawdown gate. A peak that is already in the "equity" basis ratchets normally.
 *
 * When equity cannot be measured, the persisted peak is preserved untouched and
 * nothing is persisted (fail safe — no fabricated equity ever enters the peak).
 */
export function resolveDrawdownPeak(input: DrawdownPeakInput): DrawdownPeakResult {
  const validEquity = input.equity != null && Number.isFinite(input.equity) && input.equity > 0;
  const persistedBasis: PeakEquityBasis = input.persistedBasis === "equity" ? "equity" : "available_balance";

  if (!validEquity) {
    console.warn(
      `[drawdown] peak resolution — equity invalid; preserving persisted peak ${input.persistedPeak} (basis ${persistedBasis}), no persist`,
    );
    return {
      peak: input.persistedPeak != null && input.persistedPeak > 0 ? input.persistedPeak : null,
      basis: persistedBasis,
      needsPersist: false,
    };
  }

  // Normal ratchet under the current equity metric.
  if (persistedBasis === "equity" && input.persistedPeak != null && input.persistedPeak > 0) {
    const peak = Math.max(input.persistedPeak, input.equity as number);
    console.log(
      `[drawdown] peak ratchet (equity basis) — persisted peak ${input.persistedPeak}, current equity ${input.equity} -> peak ${peak}${peak !== input.persistedPeak ? " (raised)" : " (unchanged)"}`,
    );
    return { peak, basis: "equity", needsPersist: peak !== input.persistedPeak };
  }

  // Legacy available-balance peak (or no peak yet): re-baseline explicitly to
  // the current true equity and mark the row as equity-basis.
  console.log(
    `[drawdown] peak re-baseline — legacy/absent persisted peak ${input.persistedPeak} (basis ${persistedBasis}); rebaselining to current true equity ${input.equity}`,
  );
  return { peak: input.equity as number, basis: "equity", needsPersist: true };
}