import { describe, expect, it } from "vitest";
import type { ExchangePosition, FuturesWalletSnapshot } from "@/automation/executor/client";
import { computeAccountEquity, resolveDrawdownPeak, type DrawdownPeakResult } from "./account-equity";
import { DefaultDrawdownProtection } from "./drawdown-protection";

/**
 * Account-equity tests for FIX 2 (correct maximum-drawdown equity).
 *
 * The production gate must measure TRUE account equity — never
 * total_available_balance, which falls whenever margin is locked in a position
 * even when the account has not lost money.
 */

const drawdown = new DefaultDrawdownProtection();

function makeWallet(overrides: Partial<FuturesWalletSnapshot> = {}): FuturesWalletSnapshot {
  return {
    available: 70,
    total: 100,
    blocked: 30,
    positionMargin: 30,
    openOrderMargin: 0,
    equity: null,
    ...overrides,
  };
}

function makePosition(unrealizedPnl: number | null): ExchangePosition {
  return {
    symbol: "BTCUSDT",
    side: "LONG",
    quantity: 1,
    entryPrice: 100_000,
    markPrice: 99_000,
    unrealizedPnl,
    realizedPnl: 0,
    leverage: 10,
    positionId: "pos-1",
    liquidationPrice: null,
    maintMargin: null,
    positionMargin: null,
  };
}

describe("computeAccountEquity", () => {
  it("uses the wallet's authoritative equity and does NOT double-count position PnL", () => {
    // Authoritative equity already includes unrealized PnL: adding it again
    // would double count (a naive total + unrealized would give 90, and
    // equity + unrealized would give 85 — both wrong).
    const wallet = makeWallet({ available: 70, total: 100, blocked: 30, equity: 95 });
    const position = makePosition(-10);
    expect(computeAccountEquity({ wallet, positions: [position] })).toBe(95);
  });

  it("computes equity = total balance + Σ unrealized PnL when no authoritative equity exists", () => {
    // total_balance = total_available_balance + total_blocked_balance (wallet
    // balance without unrealized PnL on CoinSwitch futures), so adding each
    // open position's PnL once is additive — no component is counted twice.
    const wallet = makeWallet();
    const positions = [makePosition(-10), makePosition(5)];
    expect(computeAccountEquity({ wallet, positions })).toBe(95);
  });

  it("does not add unrealized PnL twice for the same position", () => {
    const wallet = makeWallet();
    expect(computeAccountEquity({ wallet, positions: [makePosition(5)] })).toBe(105);
  });

  it("fails safely (null) when the wallet is null", () => {
    expect(computeAccountEquity({ wallet: null, positions: [] })).toBeNull();
  });

  it("fails safely (null) when wallet total is missing/invalid", () => {
    const wallet = makeWallet({ total: null, equity: null });
    expect(computeAccountEquity({ wallet, positions: [] })).toBeNull();
    expect(computeAccountEquity({ wallet: makeWallet({ total: 0, equity: null }), positions: [] })).toBeNull();
    expect(computeAccountEquity({ wallet: makeWallet({ total: NaN, equity: null }), positions: [] })).toBeNull();
  });

  it("fails safely (null) when a live position's PnL is unknown instead of inventing 0", () => {
    // Slotting 0 could mask a real loss and under-report the drawdown.
    const wallet = makeWallet();
    expect(computeAccountEquity({ wallet, positions: [makePosition(null)] })).toBeNull();
    expect(computeAccountEquity({ wallet, positions: [makePosition(Number.NaN)] })).toBeNull();
  });

  it("never uses total_available_balance as equity", () => {
    // available=35 while total=100 (65 USDT locked as margin / order margin).
    // Equity must still reflect total + PnL, not the free balance.
    const wallet = makeWallet({ available: 35, blocked: 65, positionMargin: 60, equity: null });
    expect(computeAccountEquity({ wallet, positions: [] })).toBe(100);
  });
});

describe("resolveDrawdownPeak", () => {
  it("ratchets the peak upward using actual equity (never available balance)", () => {
    const first: DrawdownPeakResult = resolveDrawdownPeak({ equity: 105, persistedPeak: 100, persistedBasis: "equity" });
    expect(first.peak).toBe(105);
    expect(first.basis).toBe("equity");
    expect(first.needsPersist).toBe(true);

    // Equity drops later — the peak must NOT fall.
    const second: DrawdownPeakResult = resolveDrawdownPeak({ equity: 90, persistedPeak: first.peak, persistedBasis: "equity" });
    expect(second.peak).toBe(105);
    expect(second.needsPersist).toBe(false);

    // A new high ratchets again.
    const third: DrawdownPeakResult = resolveDrawdownPeak({ equity: 110, persistedPeak: second.peak, persistedBasis: "equity" });
    expect(third.peak).toBe(110);
    expect(third.needsPersist).toBe(true);
  });

  it("re-baselines a legacy available-balance peak to true equity exactly once", () => {
    // Legacy peak_equity was persisted under available balance (could be HIGHER
    // than current equity because margin was locked). Mixing the two units could
    // spuriously trip the drawdown gate, so the peak is explicitly re-baselined
    // to current equity instead of reusing the legacy value.
    const result: DrawdownPeakResult = resolveDrawdownPeak({
      equity: 100,
      persistedPeak: 150,
      persistedBasis: "available_balance",
    });
    expect(result.peak).toBe(100);
    expect(result.basis).toBe("equity");
    expect(result.needsPersist).toBe(true);
  });

  it("then ratchets normally once the peak basis has moved to equity", () => {
    const rebased: DrawdownPeakResult = resolveDrawdownPeak({
      equity: 100,
      persistedPeak: 150,
      persistedBasis: "available_balance",
    });
    const next: DrawdownPeakResult = resolveDrawdownPeak({
      equity: 120,
      persistedPeak: rebased.peak,
      persistedBasis: rebased.basis,
    });
    expect(next.peak).toBe(120);
    expect(next.basis).toBe("equity");
  });

  it("baselines to current equity when no peak is persisted yet", () => {
    const result: DrawdownPeakResult = resolveDrawdownPeak({ equity: 98, persistedPeak: null, persistedBasis: "available_balance" });
    expect(result.peak).toBe(98);
    expect(result.basis).toBe("equity");
    expect(result.needsPersist).toBe(true);
  });

  it("preserves the persisted peak untouched (fail-safe) when equity cannot be measured", () => {
    const result: DrawdownPeakResult = resolveDrawdownPeak({ equity: null, persistedPeak: 120, persistedBasis: "equity" });
    expect(result.peak).toBe(120);
    expect(result.basis).toBe("equity");
    expect(result.needsPersist).toBe(false);
  });
});

describe("live drawdown gate integration (equity input, 15% limit)", () => {
  /** Replicates the AnalysisCycleRunner wiring: equity → peak → drawdown check. */
  function runGate(input: { wallet: FuturesWalletSnapshot | null; positions: ExchangePosition[]; persistedPeak: number | null; persistedBasis?: "equity" | "available_balance" }) {
    const equity = computeAccountEquity({ wallet: input.wallet, positions: input.positions });
    const peakInfo = resolveDrawdownPeak({
      equity,
      persistedPeak: input.persistedPeak,
      persistedBasis: input.persistedBasis,
    });
    return drawdown.check(
      {
        balance: input.wallet?.available ?? 0,
        equity: equity ?? 0,
        peakBalance: peakInfo.peak ?? equity ?? 0,
      },
      15,
    );
  }

  it("does NOT trigger drawdown protection when margin is locked but actual equity is unchanged", () => {
    // Cycle N: 30 USDT locked in one position, unrealized 0 → equity 100.
    const before = runGate({
      wallet: makeWallet({ available: 70, blocked: 30, positionMargin: 30, equity: null }),
      positions: [makePosition(0)],
      persistedPeak: 100,
      persistedBasis: "equity",
    });
    expect(before.passed).toBe(true);

    // Cycle N+1: the account opens MORE positions → available falls 70→35,
    // blocked rises to 65, but unrealized PnL is still 0 and equity is still 100.
    const after = runGate({
      wallet: makeWallet({ available: 35, blocked: 65, positionMargin: 60, equity: null }),
      positions: [makePosition(0), makePosition(0)],
      persistedPeak: 100,
      persistedBasis: "equity",
    });
    expect(after.passed).toBe(true);

    // Under the OLD metric (available balance as equity) this same drop was
    // 50% "drawdown" — a false rejection. The new gate must not see it.
    const oldMetricPeak = 70;
    const oldMetricEquity = 35;
    const oldMetricDrawdown = ((oldMetricPeak - oldMetricEquity) / oldMetricPeak) * 100;
    expect(oldMetricDrawdown).toBeGreaterThanOrEqual(15);
  });

  it("rejects when actual equity falls by exactly 15%", () => {
    const wallet = makeWallet({ available: 85, blocked: 15, positionMargin: 15, equity: null });
    const result = runGate({ wallet, positions: [makePosition(-15)], persistedPeak: 100, persistedBasis: "equity" });
    expect(result.passed).toBe(false);
    expect(result.message).toContain("15.00%");
  });

  it("rejects when actual equity falls MORE than 15%", () => {
    const wallet = makeWallet({ available: 82, blocked: 18, positionMargin: 18, equity: null });
    const result = runGate({ wallet, positions: [makePosition(-20)], persistedPeak: 100, persistedBasis: "equity" });
    expect(result.passed).toBe(false);
    expect(result.message).toContain("20.00%");
  });

  it("passes when actual equity falls BELOW the 15% threshold (threshold semantics: >= 15 rejects)", () => {
    // 14% drawdown from 100 → equity 86 → passes.
    const under = runGate({
      wallet: makeWallet({ available: 86, blocked: 14, positionMargin: 14, equity: null }),
      positions: [makePosition(-14)],
      persistedPeak: 100,
      persistedBasis: "equity",
    });
    expect(under.passed).toBe(true);

    // 14.99% → still passes; 15.00% (equity 85) → rejects (covered above).
    const justUnder = runGate({
      wallet: makeWallet({ available: 86, blocked: 14, positionMargin: 14, equity: null }),
      positions: [makePosition(-15.01)],
      persistedPeak: 100,
      persistedBasis: "equity",
    });
    // equity = 100 - 15.01 = 84.99 → drawdown 15.01% ≥ 15 → reject.
    expect(justUnder.passed).toBe(false);
  });

  it("measures drawdown from the TRUE-equity peak after it ratchets", () => {
    // Peak ratchets to 110 on a genuine equity high (equity, not available).
    const high = runGate({
      wallet: makeWallet({ available: 75, blocked: 25, positionMargin: 25, equity: null }),
      positions: [makePosition(10)],
      persistedPeak: 100,
      persistedBasis: "equity",
    });
    expect(high.passed).toBe(true);
    // equity 110 > peak 100 → new high; peak moves to 110 (needsPersist).

    // Later a 16% genuine drop from the 110 peak → equity ≈ 92.4 → reject.
    const later = runGate({
      wallet: makeWallet({ available: 62, blocked: 38, positionMargin: 35, equity: null }),
      positions: [makePosition(-17.6)],
      persistedPeak: 110,
      persistedBasis: "equity",
    });
    // equity = 100 - 17.6 = 82.4 → drawdown (110 - 82.4) / 110 = 25% → reject.
    expect(later.passed).toBe(false);
  });

  it("fails safe when equity cannot be measured (no invented equity, no fabricated rejection)", () => {
    // Wallet fetch failed entirely → computeAccountEquity is null → the gate
    // reports "not applicable" rather than inventing equity from available
    // balance or a fixed capital config.
    const result = runGate({ wallet: null, positions: [], persistedPeak: 100, persistedBasis: "equity" });
    expect(result.passed).toBe(true);
    expect(result.message).toContain("not applicable");
  });
});