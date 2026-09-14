import { describe, it, expect, vi } from "vitest";
import { detectLiquidation, type LedgerClientLike } from "./executed-close";
import type { LiquidationPositionLike } from "./executed-close";

function position(overrides: Partial<LiquidationPositionLike> = {}): LiquidationPositionLike {
  return {
    side: "BUY",
    entryPrice: 100,
    leverage: 10,
    quantity: 10,
    filledQuantity: 10,
    stopLossOrderId: "SL",
    takeProfitOrderId: null,
    symbol: "LINKUSDT",
    createdAt: "2026-08-26T17:40:00.000Z",
    ...overrides,
  };
}

function ledgerClient(txs: Array<{ type?: string; amount?: number; fee?: number | null; timestamp?: number }> = []): Pick<LedgerClientLike, "getTransactions"> {
  return {
    getTransactions: vi.fn().mockResolvedValue(txs) as LedgerClientLike["getTransactions"],
  };
}

describe("detectLiquidation", () => {
  it("flags a LONG whose current price is at/below the estimated boundary", async () => {
    // entry 100, 10x → boundary ≈ 90.65
    const result = await detectLiquidation(ledgerClient(), 1, position(), 89);
    expect(result.suspected).toBe(true);
    expect(result.boundary).toBeCloseTo(90.65, 2);
  });

  it("flags a SHORT whose current price is at/above the estimated boundary", async () => {
    const result = await detectLiquidation(ledgerClient(), 1, position({ side: "SELL" }), 110);
    expect(result.suspected).toBe(true);
  });

  it("flags a full-margin-loss P&L even when the price recovered", async () => {
    const result = await detectLiquidation(ledgerClient([{ type: "P&L", amount: -100, fee: -0.05, timestamp: 1724700000000 }]), 1, position(), 95);
    // margin = 10*100/10 = 100 → wiping the entire margin implies liquidation.
    expect(result.suspected).toBe(true);
    expect(result.realizedPnl).toBe(-100);
    expect(result.closedAtMs).toBe(1724700000000);
  });

  it("does NOT flag a normal loss (SL filled within the stop distance)", async () => {
    // SL at 96 → loss 4*10 = -40, far less than the -100 margin.
    const result = await detectLiquidation(ledgerClient([{ type: "P&L", amount: -40 }]), 1, position(), 96);
    expect(result.suspected).toBe(false);
  });

  it("cannot suspect when entry/leverage are unknown", async () => {
    const result = await detectLiquidation(ledgerClient(), 1, position({ entryPrice: null }), 50);
    expect(result.suspected).toBe(false);
    expect(result.boundary).toBeNull();
  });
});