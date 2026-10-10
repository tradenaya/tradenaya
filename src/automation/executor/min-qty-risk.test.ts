import { describe, expect, it } from "vitest";
import { normalizeEntryOrder } from "./order-executor";
import type { OrderExecutorInput } from "./types";

const instrument = { min_base_quantity: "0.01", base_quantity_step_size: "0.01", quantity_precision: 2, price_precision: 2 };

function input(overrides: Partial<OrderExecutorInput> = {}): OrderExecutorInput {
  return {
    userId: 1,
    botId: 1,
    quantity: 0.004, // below the 0.01 minimum
    leverage: 20,
    allocatedCapital: 5,
    plan: {
      action: "BUY",
      entryType: "LIMIT",
      limitPrice: 2500,
      stopLoss: 2480, // 20 USDT per unit at SL
      takeProfit: 2540,
      riskRewardRatio: 2,
      confidence: 0.6,
      reason: "test",
      expiryTime: new Date().toISOString(),
      symbol: "ETHUSDT",
      side: "BUY",
    },
    ...overrides,
  };
}

describe("normalizeEntryOrder — raising to the exchange minimum", () => {
  it("raises to the minimum when the extra loss still fits Max Risk", () => {
    // 0.01 * 20 = 0.2 USDT at SL; limit allows 0.25.
    const result = normalizeEntryOrder(instrument, input({ maxRiskAmount: 0.25 }));
    expect(result.ok).toBe(true);
    expect(result.quantity).toBe(0.01);
  });

  it("skips the trade when raising to the minimum would exceed Max Risk", () => {
    // 0.01 * 20 = 0.2 USDT at SL; limit allows only 0.08.
    const result = normalizeEntryOrder(instrument, input({ maxRiskAmount: 0.08 }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Max Risk/);
  });
});
