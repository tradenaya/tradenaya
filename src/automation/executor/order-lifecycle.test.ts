import { describe, expect, it, vi } from "vitest";
import { OrderLifecycleService } from "./services/order-lifecycle";
import type { ExecutionStore } from "./store";
import type { CoinSwitchClient } from "./client";
import type { BotStateService } from "./types";
import type { TradePlan } from "../planner/types";
import { floorToStep, normalizeEntryOrder } from "./order-executor";

function plan(overrides: Partial<TradePlan> = {}): TradePlan {
  return {
    action: "SELL",
    side: "SELL",
    entryType: "NONE",
    limitPrice: null,
    stopLoss: 63472.90625,
    takeProfit: 61962.70625,
    riskRewardRatio: 2,
    confidence: 0.61,
    reason: "test",
    expiryTime: new Date().toISOString(),
    symbol: "BTCUSDT",
    ...overrides,
  } as TradePlan;
}

function fakeStore() {
  const store = {
    updateState: vi.fn(async () => {}),
    updateFill: vi.fn(async () => {}),
  };
  return store as unknown as ExecutionStore;
}

function fakeBotState(): BotStateService {
  return { updateBotStatus: vi.fn(async () => {}), updateBotHeartbeat: vi.fn(async () => {}) };
}

function makeClient(handlers: {
  getOrderStatus: () => Promise<{ status: string; raw: Record<string, unknown> }>;
  cancelOrder?: () => Promise<boolean>;
}): CoinSwitchClient {
  return {
    getOrderStatus: vi.fn(handlers.getOrderStatus),
    cancelOrder: vi.fn(handlers.cancelOrder ?? (async () => true)),
  } as unknown as CoinSwitchClient;
}

describe("OrderLifecycleService.pollEntryUntilFilled", () => {
  it("detects EXECUTED and records exec_quantity", async () => {
    const store = fakeStore();
    const client = makeClient({
      getOrderStatus: async () => ({
        status: "EXECUTED",
        raw: { order_id: "o1", exec_quantity: "0.002", avg_execution_price: "63000" },
      }),
    });
    const svc = new OrderLifecycleService(client, store, fakeBotState(), { statusPollIntervalMs: 1, statusPollAttempts: 3 });

    const result = await svc.pollEntryUntilFilled(1, 1, "o1", { quantity: 0.002 });

    expect(result).toEqual({ filled: true, resting: false, filledQuantity: 0.002, remainingQuantity: 0, terminal: null });
    expect(store.updateFill).toHaveBeenCalledWith(1, 0.002, 0, 63000);
    expect(store.updateState).toHaveBeenCalledWith(1, "ENTRY_FILLED");
  });

  it("tracks a PARTIALLY_EXECUTED order as partially filled with a remaining quantity instead of fully filled", async () => {
    const store = fakeStore();
    const client = makeClient({
      getOrderStatus: async () => ({
        status: "PARTIALLY_EXECUTED",
        raw: { order_id: "o1", exec_quantity: "0.001" },
      }),
    });
    const svc = new OrderLifecycleService(client, store, fakeBotState(), { statusPollIntervalMs: 1, statusPollAttempts: 3 });

    const result = await svc.pollEntryUntilFilled(1, 1, "o1", { quantity: 0.002 });

    expect(result.filled).toBe(false);
    expect(result.resting).toBe(true);
    expect(result.filledQuantity).toBe(0.001);
    expect(result.remainingQuantity).toBe(0.001);
    expect(store.updateFill).toHaveBeenCalledWith(1, 0.001, 0.001, null);
    expect(store.updateState).toHaveBeenCalledWith(1, "PARTIALLY_FILLED");
  });

  it("treats CANCELLATION_RAISED as a terminal outcome (not resting)", async () => {
    const store = fakeStore();
    const client = makeClient({
      getOrderStatus: async () => ({ status: "CANCELLATION_RAISED", raw: {} }),
    });
    const svc = new OrderLifecycleService(client, store, fakeBotState(), { statusPollIntervalMs: 1, statusPollAttempts: 3 });

    const result = await svc.pollEntryUntilFilled(1, 1, "o1");

    expect(result.filled).toBe(false);
    expect(result.resting).toBe(false);
    expect(result.terminal).toBe("CANCELLATION_RAISED");
    expect(store.updateState).toHaveBeenCalledWith(1, "CANCELLED", "Entry order CANCELLATION_RAISED");
  });

  it("keeps a still-open order resting after the poll window ends instead of cancelling early", async () => {
    const store = fakeStore();
    const client = makeClient({
      getOrderStatus: async () => ({ status: "RAISED", raw: {} }),
      cancelOrder: async () => true,
    });
    const svc = new OrderLifecycleService(client, store, fakeBotState(), { statusPollIntervalMs: 1, statusPollAttempts: 2 });
    const cancelEntry = vi.spyOn(svc, "cancelEntry").mockResolvedValue();

    const result = await svc.pollEntryUntilFilled(1, 1, "o1", { quantity: 0.002 });

    // The order must stay active — NEVER cancelled merely because the short
    // polling window ended; the server-side monitor handles the full expiry.
    expect(result.filled).toBe(false);
    expect(result.resting).toBe(true);
    expect(result.remainingQuantity).toBe(0.002);
    expect(result.terminal).toBeNull();
    expect(store.updateState).not.toHaveBeenCalledWith(1, "CANCELLED", "Entry order timed out waiting for fill");
    expect(store.updateState).toHaveBeenCalledWith(1, "MONITORING_ENTRY");
    expect(cancelEntry).not.toHaveBeenCalled();
  });

  it("returns the resting remainder as remaining quantity when the order never fills in-window", async () => {
    const store = fakeStore();
    const client = makeClient({
      getOrderStatus: async () => ({ status: "PARTIALLY_EXECUTED", raw: { order_id: "o1", exec_quantity: "0.0005" } }),
    });
    const svc = new OrderLifecycleService(client, store, fakeBotState(), { statusPollIntervalMs: 1, statusPollAttempts: 2 });

    const result = await svc.pollEntryUntilFilled(1, 1, "o1", { quantity: 0.001 });

    expect(result.resting).toBe(true);
    expect(result.filledQuantity).toBe(0.0005);
    expect(result.remainingQuantity).toBe(0.0005);
    expect(store.updateState).toHaveBeenCalledWith(1, "PARTIALLY_FILLED");
  });
});

describe("normalizeEntryOrder", () => {
  const instrument: Record<string, unknown> = {
    symbol: "btc",
    min_base_quantity: "0.001",
    base_quantity_step_size: "0.001",
    lot_size: "0.001",
    quantity_precision: 3,
    price_precision: 2,
  };

  it("rejects a quantity below the exchange minimum with a clear reason", () => {
    const result = normalizeEntryOrder(instrument, { userId: 1, botId: 1, plan: plan(), quantity: 0.00002012316249503371, leverage: 25 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("below the exchange minimum (0.001)");
  });

  it("raises a risk-capped quantity up to the exchange minimum when the allocated capital allows it", () => {
    const linkInstrument: Record<string, unknown> = {
      symbol: "link",
      min_base_quantity: "0.8",
      base_quantity_step_size: "0.1",
      lot_size: "0.1",
      quantity_precision: 2,
      price_precision: 2,
    };
    const result = normalizeEntryOrder(linkInstrument, {
      userId: 1,
      botId: 1,
      plan: plan({ symbol: "LINKUSDT", limitPrice: 11.85 }),
      quantity: 0.1,
      leverage: 15,
      allocatedCapital: 15,
    });
    expect(result.ok).toBe(true);
    expect(result.quantity).toBe(0.8);
  });

  it("rejects when raising to the exchange minimum would exceed the allocated capital", () => {
    const result = normalizeEntryOrder(instrument, {
      userId: 1,
      botId: 1,
      plan: plan({ limitPrice: 63000 }),
      quantity: 0.0001,
      leverage: 1,
      allocatedCapital: 0.0001,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("cannot be raised");
  });

  it("rejects a quantity that floors to zero", () => {
    const result = normalizeEntryOrder({ ...instrument, min_base_quantity: null }, { userId: 1, botId: 1, plan: plan(), quantity: 0.0005, leverage: 25 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("rounds to zero");
  });

  it("floors a valid quantity to the step and precision", () => {
    const result = normalizeEntryOrder(instrument, { userId: 1, botId: 1, plan: plan(), quantity: 0.002351, leverage: 25 });
    expect(result.ok).toBe(true);
    expect(result.quantity).toBe(0.002);
  });

  it("rounds LIMIT prices to price_precision", () => {
    const result = normalizeEntryOrder(instrument, {
      userId: 1,
      botId: 1,
      plan: plan({ entryType: "LIMIT", limitPrice: 62991.512345 }),
      quantity: 0.002,
      leverage: 25,
    });
    expect(result.ok).toBe(true);
    expect(result.plan?.limitPrice).toBe(62991.51);
  });

  it("falls back to the raw quantity when no instrument is available", () => {
    const result = normalizeEntryOrder(null, { userId: 1, botId: 1, plan: plan(), quantity: 0.002351, leverage: 25 });
    expect(result.ok).toBe(true);
    expect(result.quantity).toBe(0.002351);
  });
});

describe("floorToStep", () => {
  it("floors to the nearest step multiple and trims to precision", () => {
    expect(floorToStep(0.002351, 0.001, 3)).toBe(0.002);
    expect(floorToStep(1.234567, 0.25, 3)).toBe(1);
    expect(floorToStep(1.3, 0.25, 3)).toBe(1.25);
  });

  it("falls back to toFixed when step is not positive", () => {
    expect(floorToStep(0.123456, 0, 3)).toBe(0.123);
  });
});
