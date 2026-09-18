import { describe, expect, it, vi } from "vitest";
import { OrderExecutorService } from "./order-executor";
import type { CoinSwitchClient } from "./client";
import type { ExecutionStore } from "./store";
import type { BotStateService, ExecutionRecord, OrderExecutorInput } from "./types";
import type { TradePlan } from "@/automation/planner/types";
import { evaluateLiquidationSafety, resolveSafeLeverage } from "@/automation/risk/liquidation-safety";

function plan(overrides: Partial<TradePlan> = {}): TradePlan {
  return {
    action: "BUY",
    side: "BUY",
    entryType: "LIMIT",
    limitPrice: 100,
    entryPrice: 100,
    stopLoss: 95,
    takeProfit: 110,
    riskRewardRatio: 2,
    confidence: 0.76,
    reason: "test",
    expiryTime: new Date(Date.now() + 7200_000).toISOString(),
    symbol: "ENAUSDT",
    ...overrides,
  } as TradePlan;
}

function instrument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: "ENAUSDT",
    min_base_quantity: "1",
    base_quantity_step_size: "1",
    lot_size: "1",
    quantity_precision: 8,
    price_precision: 8,
    min_leverage: "1",
    max_leverage: "100",
    leverage_step: "1",
    ...overrides,
  };
}

function executionRecord(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 1,
    botId: 1,
    userId: 1,
    symbol: "ENAUSDT",
    side: "BUY",
    state: "ENTRY_FILLED",
    executionKey: "1:1:ENAUSDT:BUY:100",
    limitPrice: 100,
    stopLoss: 95,
    takeProfit: 110,
    quantity: 1,
    filledQuantity: 1,
    remainingQuantity: 0,
    avgEntryPrice: 100,
    leverage: 16,
    expiresAt: Date.now() + 7200_000,
    positionId: null,
    entry: { orderId: "entry-1", clientOrderId: "c-entry-1", status: "EXECUTED" },
    stopLossOrder: { orderId: null, clientOrderId: null, status: null },
    takeProfitOrder: { orderId: null, clientOrderId: null, status: null },
    protectiveStatus: "NONE",
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeStore() {
  const store = {
    getActiveByExecutionKey: vi.fn(async () => null),
    createExecution: vi.fn(async () => 1),
    claimSubmission: vi.fn(async () => ({ ok: true, holderExecutionId: null })),
    updateState: vi.fn(async () => {}),
    saveNotification: vi.fn(async () => {}),
    updateEntryRef: vi.fn(async () => {}),
    updateFill: vi.fn(async () => {}),
    updateProtectiveRef: vi.fn(async () => {}),
    updateProtectiveStatus: vi.fn(async () => {}),
    getExecution: vi.fn(async () => executionRecord()),
  };
  return store as unknown as ExecutionStore & {
    getActiveByExecutionKey: ReturnType<typeof vi.fn>;
    createExecution: ReturnType<typeof vi.fn>;
    claimSubmission: ReturnType<typeof vi.fn>;
    updateState: ReturnType<typeof vi.fn>;
    saveNotification: ReturnType<typeof vi.fn>;
    getExecution: ReturnType<typeof vi.fn>;
    updateEntryRef: ReturnType<typeof vi.fn>;
    updateFill: ReturnType<typeof vi.fn>;
    updateProtectiveRef: ReturnType<typeof vi.fn>;
    updateProtectiveStatus: ReturnType<typeof vi.fn>;
  };
}

function makeClient() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const placeOrder = vi.fn(async (_userId: number, params: { orderType?: string; price?: number; clientOrderId?: string } | undefined) => {
    void _userId;
    calls.push({ method: "placeOrder", args: [_userId, params] });
    const id =
      params?.orderType === "STOP_MARKET"
        ? "sl-1"
        : params?.orderType === "TAKE_PROFIT_MARKET"
          ? "tp-1"
          : "entry-1";
    return {
      orderId: id,
      clientOrderId: params?.clientOrderId ?? "c-order",
      status: "RAISED",
      raw: { order_id: id, order_type: params?.orderType },
    };
  });
  const client = {
    getInstrumentInfo: vi.fn(async () => instrument()),
    setLeverage: vi.fn(async () => ({ symbol: "ENAUSDT", leverage: 16 })),
    getWalletBalance: vi.fn(async () => 5000),
    placeOrder,
    getOrderStatus: vi.fn(async () => ({
      status: "EXECUTED",
      clientOrderId: "c-entry-1",
      raw: { order_id: "entry-1", exec_quantity: "1", avg_execution_price: "100" },
    })),
    getOpenOrders: vi.fn(async () => []),
    cancelOrder: vi.fn(async () => true),
    setLeverageCalls: calls,
  };
  return {
    client: client as unknown as CoinSwitchClient,
    typed: client as unknown as {
      getInstrumentInfo: { mockResolvedValue: (v: Record<string, unknown> | null) => void };
      setLeverage: { mockResolvedValue: (v: unknown) => void };
      getWalletBalance: { mockResolvedValue: (v: number | null) => void };
      placeOrder: { mockResolvedValue: (v: unknown) => void };
      getOrderStatus: { mockResolvedValue: (v: unknown) => void };
      getOpenOrders: { mockResolvedValue: (v: unknown[]) => void };
    } & { setLeverage: ReturnType<typeof vi.fn> } & { placeOrder: ReturnType<typeof vi.fn> },
    calls,
  };
}

function makeBotState(): BotStateService {
  return { updateBotStatus: vi.fn(async () => {}), updateBotHeartbeat: vi.fn(async () => {}) } as unknown as BotStateService;
}

async function run(input: Partial<OrderExecutorInput>, opts: { instrument?: Record<string, unknown> | null } = {}) {
  const store = makeStore();
  const client = makeClient();
  if (opts.instrument !== undefined) {
    client.typed.getInstrumentInfo.mockResolvedValue(opts.instrument);
  }
  const executor = new OrderExecutorService({
    client: client.client,
    store,
    botState: makeBotState(),
    statusPollIntervalMs: 1,
    statusPollAttempts: 3,
  });
  const result = await executor.execute({
    userId: 1,
    botId: 1,
    leverage: 65,
    quantity: 1,
    plan: plan({ ...input.plan }),
    ...input,
  } as OrderExecutorInput);
  return { result, store, client };
}

function entryOrderCalls(client: ReturnType<typeof makeClient>) {
  return client.calls
    .filter((c) => c.method === "placeOrder")
    .map((c) => c.args[1] as { orderType?: string; price?: number; symbol?: string });
}

describe("OrderExecutorService.execute — liquidation-safe leverage downshift", () => {
  it("downshifts an unsafe 65x to a safe 16x, re-checks, and submits the LIMIT entry", async () => {
    const { result, client } = await run(
      { leverage: 65, quantity: 1, plan: plan({ limitPrice: 100, entryPrice: 100, stopLoss: 95 }) },
      { instrument: instrument() },
    );

    // 65x is unsafe for a 5% stop → the executor must set 16x on the exchange.
    expect(client.typed.setLeverage).toHaveBeenCalledTimes(1);
    expect(client.typed.setLeverage).toHaveBeenCalledWith(1, "ENAUSDT", 16);

    // The final leverage is liquidation-safe and the entry was submitted.
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: 100, stopLoss: 95, leverage: 16 }).ok).toBe(true);
    expect(client.typed.placeOrder).toHaveBeenCalled();
    expect(result.state).toBe("ENTRY_FILLED");
    expect(result.success).toBe(true);
  });

  it("rounds the safe ceiling DOWN to a valid step (16.8x → step 1 → 16x), never up", async () => {
    // 5% stop gives a 16.8x safe ceiling; step 1 must yield exactly 16x.
    const expected = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 95,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
    });
    expect(expected.ok).toBe(true);
    expect(expected.maxSafeLeverage).toBe(16);
    expect(expected.leverage).toBe(16);

    const { result, client } = await run(
      { leverage: 65, quantity: 1, plan: plan({ limitPrice: 100, entryPrice: 100, stopLoss: 95 }) },
      { instrument: instrument() },
    );
    expect(client.typed.setLeverage).toHaveBeenLastCalledWith(1, "ENAUSDT", 16);
    expect(result.state).toBe("ENTRY_FILLED");
  });

  it("preserves the configured leverage when the safe ceiling is higher (never increases)", async () => {
    // 1% stop → safe ceiling 51x; the 20x request stays 20x.
    const { result, client } = await run(
      { leverage: 20, quantity: 1, plan: plan({ limitPrice: 100, entryPrice: 100, stopLoss: 99 }) },
      { instrument: instrument() },
    );
    expect(client.typed.setLeverage).toHaveBeenCalledTimes(1);
    expect(client.typed.setLeverage).toHaveBeenCalledWith(1, "ENAUSDT", 20);
    expect(result.state).toBe("ENTRY_FILLED");
  });

  it("rejects when no leverage at or above the exchange minimum is safe — no order, no leverage increase", async () => {
    const { result, client } = await run(
      { leverage: 65, quantity: 1, plan: plan({ limitPrice: 100, entryPrice: 100, stopLoss: 95 }) },
      { instrument: instrument({ min_leverage: "20", max_leverage: "100" }) },
    );

    expect(result.state).toBe("CANCELLED");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/no valid leverage can make the planned SL safe/i);
    // setLeverage must NOT be called at all — no leverage shall be increased.
    expect(client.typed.setLeverage).not.toHaveBeenCalled();
    expect(client.typed.placeOrder).not.toHaveBeenCalled();
  });

  it("still cancels when the FINAL liquidation re-check fails (gate stays mandatory)", async () => {
    // knife-edge: 5.3% stop resolves to a 16x ceiling, but at 16x the gate has
    // zero margin — the mandatory second check must block the entry.
    const { result, client } = await run(
      { leverage: 65, quantity: 1, plan: plan({ limitPrice: 100, entryPrice: 100, stopLoss: 94.7 }) },
      { instrument: instrument() },
    );

    const resolved = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 94.7,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.leverage).toBe(16);
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: 100, stopLoss: 94.7, leverage: 16 }).ok).toBe(false);

    expect(client.typed.setLeverage).toHaveBeenCalledWith(1, "ENAUSDT", 16);
    expect(result.state).toBe("CANCELLED");
    expect(result.message).toMatch(/liquidation-safety gate/i);
    expect(client.typed.placeOrder).not.toHaveBeenCalled();
  });

  it("already-safe configured leverage: exactly one leverage-set call, entry proceeds unchanged", async () => {
    const { result, client } = await run(
      { leverage: 10, quantity: 1, plan: plan({ limitPrice: 100, entryPrice: 100, stopLoss: 98 }) },
      { instrument: instrument() },
    );
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: 100, stopLoss: 98, leverage: 10 }).ok).toBe(true);
    expect(client.typed.setLeverage).toHaveBeenCalledTimes(1);
    expect(client.typed.setLeverage).toHaveBeenCalledWith(1, "ENAUSDT", 10);
    expect(result.state).toBe("ENTRY_FILLED");
  });

  it("entry remains a LIMIT order with the planned price (never converted to market)", async () => {
    const { result, client } = await run(
      { leverage: 65, quantity: 1, plan: plan({ limitPrice: 100, entryPrice: 100, stopLoss: 95 }) },
      { instrument: instrument() },
    );
    const entryCalls = entryOrderCalls(client).filter((p) => p.orderType !== "STOP_MARKET" && p.orderType !== "TAKE_PROFIT_MARKET");
    expect(entryCalls).toHaveLength(1);
    expect(entryCalls[0].orderType).toBe("LIMIT");
    expect(entryCalls[0].price).toBe(100);
    expect(result.state).toBe("ENTRY_FILLED");
  });

  it("regression: ENA-style 65x downshifts to a safe valid leverage instead of being cancelled", async () => {
    const p = plan({ symbol: "ENAUSDT", limitPrice: 0.170083112, entryPrice: 0.170083112, stopLoss: 0.1619359267, takeProfit: 0.178 });
    const expected = resolveSafeLeverage({
      side: "BUY",
      entryPrice: p.limitPrice!,
      stopLoss: p.stopLoss!,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
    });
    expect(expected.ok).toBe(true);
    expect(expected.leverage!).toBeLessThan(65);

    const { result, client } = await run(
      { leverage: 65, quantity: 1, plan: p },
      { instrument: instrument({ min_leverage: "1", max_leverage: "100", leverage_step: "1" }) },
    );
    expect(client.typed.setLeverage).toHaveBeenCalledWith(1, "ENAUSDT", expected.leverage);
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: p.limitPrice, stopLoss: p.stopLoss, leverage: expected.leverage! }).ok).toBe(true);
    expect(result.state).toBe("ENTRY_FILLED");
  });

  it("regression: SOXL-style 65x downshifts to a safe valid leverage instead of being cancelled", async () => {
    const p = plan({ symbol: "SOXLUSDT", limitPrice: 119.02186, entryPrice: 119.02186, stopLoss: 118.0572696, takeProfit: 121 });
    const expected = resolveSafeLeverage({
      side: "BUY",
      entryPrice: p.limitPrice!,
      stopLoss: p.stopLoss!,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
    });
    expect(expected.ok).toBe(true);
    expect(expected.leverage!).toBeLessThan(65);

    const { result, client } = await run(
      { leverage: 65, quantity: 1, plan: p },
      { instrument: instrument({ min_leverage: "1", max_leverage: "100", leverage_step: "1" }) },
    );
    expect(client.typed.setLeverage).toHaveBeenCalledWith(1, "SOXLUSDT", expected.leverage);
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: p.limitPrice, stopLoss: p.stopLoss, leverage: expected.leverage! }).ok).toBe(true);
    expect(result.state).toBe("ENTRY_FILLED");
  });

  it("regression: TAO-style 65x downshifts to a safe valid leverage instead of being cancelled", async () => {
    const p = plan({ symbol: "TAOUSDT", limitPrice: 300, entryPrice: 300, stopLoss: 284.5, takeProfit: 330 });
    const expected = resolveSafeLeverage({
      side: "BUY",
      entryPrice: p.limitPrice!,
      stopLoss: p.stopLoss!,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
    });
    expect(expected.ok).toBe(true);
    expect(expected.leverage!).toBeLessThan(65);

    const { result, client } = await run(
      { leverage: 65, quantity: 1, plan: p },
      { instrument: instrument({ min_leverage: "1", max_leverage: "100", leverage_step: "1" }) },
    );
    expect(client.typed.setLeverage).toHaveBeenCalledWith(1, "TAOUSDT", expected.leverage);
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: p.limitPrice, stopLoss: p.stopLoss, leverage: expected.leverage! }).ok).toBe(true);
    expect(result.state).toBe("ENTRY_FILLED");
  });
});