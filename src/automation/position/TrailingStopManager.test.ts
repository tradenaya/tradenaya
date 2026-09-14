import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrailingStopManager } from "./TrailingStopManager";
import type { CoinSwitchClientLike, PositionRecord, PositionSnapshot, PositionStoreLike } from "./PositionManagerTypes";

vi.mock("@/automation/order-history", () => ({
  OrderHistoryRepository: class { async saveOrder() { /* no-op in tests */ } },
}));

function buildPosition(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id: 1,
    executionId: 10,
    botId: 100,
    userId: 1000,
    symbol: "BTCUSDT",
    side: "BUY",
    state: "PROTECTED",
    quantity: 0.001,
    filledQuantity: 0.001,
    remainingQuantity: null,
    entryPrice: 100,
    currentPrice: null,
    stopLoss: 98.5,
    takeProfit: null,
    leverage: 10,
    positionId: "pos-1",
    entryOrderId: "entry-1",
    stopLossOrderId: "sl-1",
    takeProfitOrderId: null,
    stopLossTriggered: false,
    takeProfitTriggered: false,
    exitPrice: null,
    exitReason: null,
    realizedPnl: null,
    unrealizedPnl: null,
    fees: null,
    trailingEnabled: true,
    trailingActivated: true,
    trailingDistancePct: 5,
    trailingActivationPct: 0.5,
    highestPrice: 110,
    lowestPrice: 99,
    lastSyncAt: null,
    errorMessage: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

function buildSnapshot(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    position: buildPosition(),
    currentPrice: 110,
    exchangePosition: {
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 0.001,
      entryPrice: 100,
      markPrice: 110,
      unrealizedPnl: null,
      realizedPnl: null,
      leverage: 10,
      positionId: "pos-1",
      liquidationPrice: 106,
      maintMargin: null,
      positionMargin: null,
    },
    openOrders: [],
    positionsReadFailed: false,
    openOrdersReadFailed: false,
    ...overrides,
  };
}

function mockClient(overrides: Record<string, unknown> = {}): MockedClient {
  return {
    getPositions: vi.fn().mockResolvedValue([]),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getCurrentPrice: vi.fn().mockResolvedValue(null),
    getOrderStatus: vi.fn().mockResolvedValue({ orderId: "new-sl", clientOrderId: null, status: "NEW", raw: {} }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    placeOrder: vi.fn().mockResolvedValue({ orderId: "new-sl", clientOrderId: null, status: "NEW", raw: {} }),
    getTransactions: vi.fn().mockResolvedValue([]),
    getClosedOrders: vi.fn().mockResolvedValue({ orders: [], cursor: null }),
    ...overrides,
  } as unknown as MockedClient;
}

type MockedClient = CoinSwitchClientLike & {
  placeOrder: ReturnType<typeof vi.fn>;
  getOrderStatus: ReturnType<typeof vi.fn>;
  cancelOrder: ReturnType<typeof vi.fn>;
};

function mockStore(): PositionStoreLike {
  return {
    ensureTable: vi.fn(),
    createPosition: vi.fn(),
    getPositionByExecutionId: vi.fn(),
    getActivePositions: vi.fn(),
    getPosition: vi.fn(),
    updateState: vi.fn(),
    updatePrices: vi.fn(),
    updateEntry: vi.fn(),
    updateProtection: vi.fn(),
    updateTrailing: vi.fn(),
    markClose: vi.fn(),
    recordCloseSummary: vi.fn(),
    saveEvent: vi.fn(),
  } as unknown as PositionStoreLike;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("TrailingStopManager — authoritative liquidation-safety gate", () => {
  let client: ReturnType<typeof mockClient>;
  let store: ReturnType<typeof mockStore>;
  let manager: TrailingStopManager;

  beforeEach(() => {
    client = mockClient();
    store = mockStore();
    manager = new TrailingStopManager(client, store);
  });

  it("LONG: blocks a trailing SL that would sit beyond the exchange liquidation price", async () => {
    // entry=100, highest=110, distancePct=5% → candidate ≈ 104.5.
    // liq=106 → minSafe = 106 + 0.3 = 106.3 → 104.5 < 106.3 → blocked.
    const snap = buildSnapshot();
    const result = await manager.update(snap);

    expect(result.moved).toBe(false);
    expect(result.newStopLoss).toBe(98.5);
    expect(client.placeOrder).not.toHaveBeenCalled();
    expect(client.cancelOrder).not.toHaveBeenCalled();
    // Current trailing state is still persisted (no stale highest from the blocked path).
    expect(store.updateTrailing).toHaveBeenCalledWith(1, 98.5, 110, 99);
  });

  it("LONG: accepts a trailing SL that is safely above the exchange liquidation price", async () => {
    // liq=95 → minSafe = 95.3; candidate ≈ 104.5 → safe.
    const snap = buildSnapshot({
      exchangePosition: {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.001,
        entryPrice: 100,
        markPrice: 110,
        unrealizedPnl: null,
        realizedPnl: null,
        leverage: 10,
        positionId: "pos-1",
        liquidationPrice: 95,
        maintMargin: null,
        positionMargin: null,
      },
    });
    const result = await manager.update(snap);

    expect(result.moved).toBe(true);
    expect(result.newStopLoss).toBe(104.5);
    expect(client.placeOrder).toHaveBeenCalledTimes(1);
    // Create-new before cancel-old: placeOrder must be called before cancelOrder.
    expect(client.placeOrder.mock.invocationCallOrder[0])
      .toBeLessThan(client.cancelOrder.mock.invocationCallOrder[0]);
    expect(store.updateProtection).toHaveBeenCalledWith(1, "new-sl", null);
  });

  it("SHORT: blocks a trailing SL that would sit beyond the exchange liquidation price", async () => {
    // entry=100, currentPrice=90, lowest=90, distancePct=5% → candidate ≈ 94.5.
    // liq=92 → maxSafe = 92 - 0.3 = 91.7; 94.5 > 91.7 → blocked.
    const pos = buildPosition({
      side: "SELL",
      stopLoss: 95,
      trailingDistancePct: 5,
      trailingActivationPct: 0.5,
      highestPrice: 110,
      lowestPrice: 90,
    });
    const snap = buildSnapshot({
      position: pos,
      currentPrice: 90,
      exchangePosition: {
        symbol: "BTCUSDT",
        side: "SELL",
        quantity: 0.001,
        entryPrice: 100,
        markPrice: 90,
        unrealizedPnl: null,
        realizedPnl: null,
        leverage: 10,
        positionId: "pos-1",
        liquidationPrice: 92,
        maintMargin: null,
        positionMargin: null,
      },
    });

    const result = await manager.update(snap);
    expect(result.moved).toBe(false);
    expect(result.newStopLoss).toBe(95);
    expect(client.placeOrder).not.toHaveBeenCalled();
  });

  it("SHORT: accepts a trailing SL that is safely below the exchange liquidation price", async () => {
    // liq=110 → maxSafe = 109.7; candidate ≈ 94.5 → safe.
    const pos = buildPosition({
      side: "SELL",
      stopLoss: 95,
      trailingDistancePct: 5,
      trailingActivationPct: 0.5,
      highestPrice: 110,
      lowestPrice: 90,
    });
    const snap = buildSnapshot({
      position: pos,
      currentPrice: 90,
      exchangePosition: {
        symbol: "BTCUSDT",
        side: "SELL",
        quantity: 0.001,
        entryPrice: 100,
        markPrice: 90,
        unrealizedPnl: null,
        realizedPnl: null,
        leverage: 10,
        positionId: "pos-1",
        liquidationPrice: 110,
        maintMargin: null,
        positionMargin: null,
      },
    });

    const result = await manager.update(snap);
    expect(result.moved).toBe(true);
    expect(client.placeOrder).toHaveBeenCalledTimes(1);
  });

  it("missing liquidationPrice: does NOT submit a new SL, keeps the current SL, and does not cancel anything", async () => {
    // liq=null → no known liquidation boundary → replacement is SKIPPED.
    const snap = buildSnapshot({
      exchangePosition: {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.001,
        entryPrice: 100,
        markPrice: 110,
        unrealizedPnl: null,
        realizedPnl: null,
        leverage: 10,
        positionId: "pos-1",
        liquidationPrice: null,
        maintMargin: null,
        positionMargin: null,
      },
    });
    const result = await manager.update(snap);

    // 1. no new SL placement
    expect(result.moved).toBe(false);
    expect(client.placeOrder).not.toHaveBeenCalled();
    // 2. existing SL remains untouched
    expect(result.newStopLoss).toBe(98.5);
    expect(store.updateProtection).not.toHaveBeenCalled();
    expect(store.updateTrailing).toHaveBeenCalledWith(1, 98.5, 110, 99);
    // 3. no cancelOrder occurs
    expect(client.cancelOrder).not.toHaveBeenCalled();
    // 5. no unprotected gap: nothing placed, nothing cancelled — the incumbent
    //    stop stays as the only protection.
    expect(client.placeOrder.mock.calls.length + client.cancelOrder.mock.calls.length).toBe(0);
  });

  it("resumes normal trailing replacement once a valid liquidationPrice becomes available", async () => {
    // First tick: liquidation data missing → replacement skipped, current SL kept.
    const missingSnap = buildSnapshot({
      exchangePosition: {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.001,
        entryPrice: 100,
        markPrice: 110,
        unrealizedPnl: null,
        realizedPnl: null,
        leverage: 10,
        positionId: "pos-1",
        liquidationPrice: null,
        maintMargin: null,
        positionMargin: null,
      },
    });
    const skipped = await manager.update(missingSnap);
    expect(skipped.moved).toBe(false);
    expect(client.placeOrder).not.toHaveBeenCalled();

    // Second tick: authoritative liquidation price now available → normal safe
    // replacement proceeds (create-new before cancel-old).
    const validSnap = buildSnapshot({
      exchangePosition: {
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 0.001,
        entryPrice: 100,
        markPrice: 110,
        unrealizedPnl: null,
        realizedPnl: null,
        leverage: 10,
        positionId: "pos-1",
        liquidationPrice: 95,
        maintMargin: null,
        positionMargin: null,
      },
    });
    const resumed = await manager.update(validSnap);
    expect(resumed.moved).toBe(true);
    expect(resumed.newStopLoss).toBe(104.5);
    expect(client.placeOrder).toHaveBeenCalledTimes(1);
    expect(client.placeOrder.mock.invocationCallOrder[0])
      .toBeLessThan(client.cancelOrder.mock.invocationCallOrder[0]);
  });

  it("never enters the create-new-before-cancel-old sequence when blocked (no unprotected gap)", async () => {
    // Same as the LONG blocked case — placeOrder is never touched.
    const snap = buildSnapshot();
    const result = await manager.update(snap);

    expect(result.moved).toBe(false);
    expect(client.placeOrder).not.toHaveBeenCalled();
    expect(client.cancelOrder).not.toHaveBeenCalled();
    expect(store.updateProtection).not.toHaveBeenCalled();
  });
});

describe("TrailingStopManager — existing mandatory pre-entry guard still works", () => {
  it("the pre-entry gate still uses the ESTIMATED fallback and rejects unsafe stops", async () => {
    const { evaluateLiquidationSafety } = await import("@/automation/risk/liquidation-safety");
    // NEARUSDT-style 29x LONG: pre-entry (no authoritative price), the estimated
    // boundary blocks the stop — same regression test as liquidation-safety.test.
    const result = evaluateLiquidationSafety({
      side: "BUY",
      entryPrice: 3.399,
      stopLoss: 2.9,
      leverage: 29,
    });
    expect(result.boundarySource).toBe("ESTIMATED");
    expect(result.determinable).toBe(true);
    expect(result.ok).toBe(false);
  });
});
