import { describe, expect, it, vi } from "vitest";
import { grossProfitOf, reconcileClose } from "./close-accounting";
import type { PositionRecord } from "./PositionManagerTypes";

function position(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id: 1,
    executionId: 1,
    botId: 1,
    userId: 1,
    symbol: "PUMPFUNUSDT",
    side: "BUY",
    state: "CLOSED",
    quantity: 13700,
    filledQuantity: 13700,
    entryPrice: 0.004887,
    currentPrice: null,
    stopLoss: null,
    takeProfit: null,
    leverage: null,
    positionId: null,
    entryOrderId: null,
    stopLossOrderId: null,
    takeProfitOrderId: null,
    stopLossTriggered: false,
    takeProfitTriggered: false,
    exitPrice: 0.004945,
    exitReason: "MANUAL_CLOSE",
    realizedPnl: 0.72725,
    unrealizedPnl: null,
    fees: 0.06735,
    trailingEnabled: false,
    trailingActivated: false,
    trailingDistancePct: null,
    trailingActivationPct: null,
    highestPrice: null,
    lowestPrice: null,
    lastSyncAt: null,
    errorMessage: null,
    createdAt: "2026-08-26T17:40:00.000Z",
    updatedAt: "2026-08-27T14:05:00.000Z",
    closedAt: "2026-08-27T14:05:00.000Z",
    ...overrides,
  };
}

function noTxClient(): {
  getTransactions: ReturnType<typeof vi.fn>;
} {
  return {
    getTransactions: vi.fn().mockResolvedValue(null),
  };
}

describe("grossProfitOf", () => {
  it("computes BUY gross price profit", () => {
    expect(grossProfitOf("BUY", 0.004887, 0.004945, 13700)).toBeCloseTo(0.7946, 4);
  });

  it("computes SELL gross price profit", () => {
    expect(grossProfitOf("SELL", 0.01, 0.009, 100)).toBeCloseTo(0.1, 6);
  });

  it("returns null when prices/quantity are missing", () => {
    expect(grossProfitOf("BUY", null, 1, 1)).toBeNull();
  });
});

describe("reconcileClose", () => {
  it("falls back to an estimated round-trip commission when the ledger is unavailable", async () => {
    const client = noTxClient();
    const result = await reconcileClose(client as any, 1, position(), 0.004887, 0.004945);

    // gross = (0.004945 - 0.004887) * 13700 = 0.7946
    // estimated commission = (0.004887*13700 + 0.004945*13700) * 0.0005 = 0.0673...
    const gross = (0.004945 - 0.004887) * 13700;
    const estCommission = (0.004887 * 13700 + 0.004945 * 13700) * 0.0005;
    expect(result.grossProfit).toBeCloseTo(gross, 6);
    expect(result.fundingFee).toBe(0);
    expect(result.estimated).toBe(true);
    expect(result.realizedPnl).toBeCloseTo(gross - estCommission, 6);
  });

  it("uses confirmed commission and funding from the ledger when available", async () => {
    const client = {
      getTransactions: vi
        .fn()
        .mockResolvedValueOnce([{ type: "COMMISSION", amount: -0.04, fee: null }, { type: "COMMISSION", amount: -0.05, fee: null }])
        .mockResolvedValueOnce([{ type: "FUNDING_FEE", amount: -0.012, fee: null }]),
    };

    const result = await reconcileClose(client as any, 1, position(), 0.004887, 0.004945);
    expect(result.commission).toBeCloseTo(0.09, 6);
    expect(result.fundingFee).toBeCloseTo(0.012, 6);
    expect(result.estimated).toBe(false);
    // net = gross(0.7946) - 0.09 - 0.012
    const gross = (0.004945 - 0.004887) * 13700;
    expect(result.realizedPnl).toBeCloseTo(gross - 0.09 - 0.012, 6);
  });
});
