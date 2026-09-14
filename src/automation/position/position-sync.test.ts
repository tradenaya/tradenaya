import { describe, expect, it, vi } from "vitest";
import { PositionRecovery } from "./PositionRecovery";
import type { PositionEventInput } from "./PositionManagerTypes";
import type { CoinSwitchClientLike, PositionRecord, PositionStoreLike } from "./PositionManagerTypes";
import type { ExecutionRecord } from "@/automation/executor/types";
import type { ExecutionStore } from "@/automation/executor/store";
import type { ClosedOrderRecord, ExchangeOrder, ExchangePosition, FuturesTransaction } from "@/automation/executor/client";
import type { ProtectiveOrdersService } from "@/automation/executor/services/protective-orders";

function position(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id: 1,
    executionId: 10,
    botId: 100,
    userId: 7,
    symbol: "NEARUSDT",
    side: "BUY",
    state: "PROTECTED",
    quantity: 100,
    filledQuantity: 100,
    remainingQuantity: 0,
    entryPrice: 100,
    currentPrice: 101,
    stopLoss: 96,
    takeProfit: 110,
    leverage: 10,
    positionId: "pos-1",
    entryOrderId: "entry-1",
    stopLossOrderId: "sl-1",
    takeProfitOrderId: "tp-1",
    stopLossTriggered: false,
    takeProfitTriggered: false,
    exitPrice: null,
    exitReason: null,
    realizedPnl: null,
    unrealizedPnl: null,
    fees: null,
    trailingEnabled: false,
    trailingActivated: false,
    trailingDistancePct: null,
    trailingActivationPct: null,
    highestPrice: null,
    lowestPrice: null,
    lastSyncAt: null,
    errorMessage: null,
    createdAt: "2026-08-26T17:40:00.000Z",
    updatedAt: "2026-08-26T17:40:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

function execution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 10,
    botId: 100,
    userId: 7,
    symbol: "NEARUSDT",
    side: "BUY",
    state: "ENTRY_FILLED",
    executionKey: "7:100:NEARUSDT:BUY:100",
    limitPrice: 100,
    stopLoss: 96,
    takeProfit: 110,
    quantity: 100,
    filledQuantity: 100,
    remainingQuantity: 0,
    avgEntryPrice: 100,
    leverage: 10,
    expiresAt: null,
    positionId: "pos-1",
    entry: { orderId: "entry-1", clientOrderId: null, status: "EXECUTED" },
    stopLossOrder: { orderId: "sl-1", clientOrderId: null, status: "RAISED" },
    takeProfitOrder: { orderId: "tp-1", clientOrderId: null, status: "RAISED" },
    protectiveStatus: "PLACED",
    errorMessage: null,
    createdAt: "2026-08-26T17:40:00.000Z",
    updatedAt: "2026-08-26T17:40:00.000Z",
    ...overrides,
  };
}

function exchangePosition(overrides: Partial<ExchangePosition> = {}): ExchangePosition {
  return {
    symbol: "NEARUSDT",
    side: "BUY",
    quantity: 100,
    entryPrice: 100,
    markPrice: 100,
    unrealizedPnl: 1,
    realizedPnl: 0,
    leverage: 5,
    positionId: "pos-1",
    liquidationPrice: 90,
    maintMargin: 0,
    positionMargin: 0,
    ...overrides,
  };
}

function openOrder(overrides: Partial<ExchangeOrder> = {}): ExchangeOrder {
  return { orderId: "x", clientOrderId: null, status: "RAISED", raw: {}, ...overrides };
}

function closedOrder(overrides: Partial<ClosedOrderRecord> = {}): ClosedOrderRecord {
  return {
    orderId: "co-1",
    clientOrderId: null,
    status: "EXECUTED",
    symbol: "NEARUSDT",
    side: "SELL",
    orderType: "PROFIT",
    quantity: 100,
    execQuantity: 100,
    price: null,
    triggerPrice: null,
    avgExecutionPrice: 108,
    executionFee: null,
    realizedPnl: 18,
    reduceOnly: true,
    createdAt: 1724700000000,
    updatedAt: 1724700000000,
    ...overrides,
  };
}

function tx(overrides: Partial<FuturesTransaction> = {}): FuturesTransaction {
  return { type: "COMMISSION", symbol: "NEARUSDT", amount: 0, fee: null, timestamp: 1724700000000, orderId: null, raw: {}, ...overrides };
}

class FakeClient implements CoinSwitchClientLike {
  positions: ExchangePosition[] = [];
  openOrders: ExchangeOrder[] = [];
  orderStatus: Record<string, { status?: string | null; raw?: Record<string, unknown> }> = {};
  closedOrders: ClosedOrderRecord[] = [];
  transactions: FuturesTransaction[] = [];
  currentPrice: number | null = null;
  failReads = false;

  getPositions = vi.fn(async (_userId: number, _symbol?: string): Promise<ExchangePosition[]> => {
    if (this.failReads) throw new Error("positions read failed");
    return this.positions;
  });
  getOpenOrders = vi.fn(async (): Promise<ExchangeOrder[]> => this.openOrders);
  getCurrentPrice = vi.fn(async (): Promise<number | null> => this.currentPrice);
  getOrderStatus = vi.fn(async (_userId: number, orderId: string): Promise<ExchangeOrder> => {
    const s = this.orderStatus[orderId] ?? { status: "RAISED", raw: {} };
    return { orderId, clientOrderId: null, status: s.status ?? null, raw: s.raw ?? {} };
  });
  getTransactions = vi.fn(async (_userId: number, opts?: { type?: string }): Promise<FuturesTransaction[]> => {
    if (!opts?.type) return this.transactions;
    const t = opts.type.toLowerCase();
    return this.transactions.filter((x) => String(x.type).toLowerCase() === t);
  });
  getClosedOrders = vi.fn(async (): Promise<{ orders: ClosedOrderRecord[]; cursor: number | null }> => ({ orders: this.closedOrders, cursor: null }));
  cancelOrder = vi.fn(async (): Promise<boolean> => true);
  placeOrder = vi.fn(async (): Promise<ExchangeOrder> => ({ orderId: "placed", clientOrderId: null, status: "RAISED", raw: {} }));
}

class FakeStore implements PositionStoreLike {
  positions: PositionRecord[] = [];
  markCloseCalls: Array<{ id: number; exitPrice: number; reason: string; realizedPnl: number; fees: number; closedAt: string | undefined }> = [];
  closedSummaries: Array<{ id: number; reason: string; exitPrice: number | null }> = [];
  events: PositionEventInput[] = [];
  createdExecutions: ExecutionRecord[] = [];
  protectedUpdated: Array<{ id: number; sl: string | null; tp: string | null }> = [];

  ensureTable = vi.fn(async () => {});
  createPosition = vi.fn(async (execution: ExecutionRecord): Promise<number> => {
    this.createdExecutions.push(execution);
    const id = this.positions.length + 1;
    const rec = position({
      id,
      executionId: execution.id,
      botId: execution.botId,
      userId: execution.userId,
      symbol: execution.symbol,
      side: execution.side,
      quantity: execution.quantity,
      filledQuantity: execution.filledQuantity,
      entryPrice: execution.avgEntryPrice ?? null,
      state: "PROTECTED",
    });
    this.positions.push(rec);
    return id;
  });
  getPositionByExecutionId = vi.fn(async (executionId: number): Promise<PositionRecord | null> => this.positions.find((p) => p.executionId === executionId) ?? null);
  getActivePositions = vi.fn(async (): Promise<PositionRecord[]> => [...this.positions]);
  getPosition = vi.fn(async (id: number): Promise<PositionRecord | null> => this.positions.find((p) => p.id === id) ?? null);
  updateState = vi.fn(async (id: number, state: PositionRecord["state"]) => {
    const p = this.positions.find((x) => x.id === id);
    if (p) p.state = state;
  });
  updatePrices = vi.fn(async () => {});
  updateEntry = vi.fn(async () => {});
  updateProtection = vi.fn(async (id: number, sl: string | null, tp: string | null) => {
    this.protectedUpdated.push({ id, sl, tp });
    const p = this.positions.find((x) => x.id === id);
    if (p) {
      p.stopLossOrderId = sl;
      p.takeProfitOrderId = tp;
    }
  });
  updateTrailing = vi.fn(async () => {});
  updateFillQuantities = vi.fn(async () => {});
  markClose = vi.fn(async (id: number, exitPrice: number, reason: string, realizedPnl: number, fees: number, closedAt?: string) => {
    this.markCloseCalls.push({ id, exitPrice, reason, realizedPnl, fees, closedAt });
    const p = this.positions.find((x) => x.id === id);
    if (p) {
      p.state = "CLOSED";
      p.exitPrice = exitPrice;
      p.exitReason = reason as PositionRecord["exitReason"];
      p.realizedPnl = realizedPnl;
      p.fees = fees;
      p.closedAt = closedAt ?? new Date().toISOString();
    }
  });
  recordCloseSummary = vi.fn(async (input: { position: PositionRecord; exitPrice: number | null; reason: string; realizedPnl: number | null; fees: number | null; entryPrice: number | null }) => {
    this.closedSummaries.push({ id: input.position.id, reason: input.reason, exitPrice: input.exitPrice });
  });
  saveEvent = vi.fn(async (input: PositionEventInput) => {
    this.events.push(input);
  });
}

class FakeExecutionStore {
  records = new Map<number, ExecutionRecord>();
  activeStates = new Set(["PENDING_ENTRY", "MONITORING_ENTRY", "ENTRY_FILLED", "PARTIALLY_FILLED", "UNPROTECTED"]);
  stateUpdates: Array<{ id: number; state: string }> = [];

  getActiveExecutions = vi.fn(async (): Promise<ExecutionRecord[]> => Array.from(this.records.values()).filter((e) => this.activeStates.has(e.state)));
  getExecution = vi.fn(async (id: number): Promise<ExecutionRecord | null> => this.records.get(id) ?? null);
  updateState = vi.fn(async (id: number, state: string) => {
    this.stateUpdates.push({ id, state });
    const e = this.records.get(id);
    if (e) e.state = state as ExecutionRecord["state"];
  });
  updateFill = vi.fn(async (id: number, filledQuantity: number | null, remainingQuantity: number | null, avgEntryPrice: number | null) => {
    const e = this.records.get(id);
    if (e) {
      e.filledQuantity = filledQuantity;
      e.remainingQuantity = remainingQuantity;
      e.avgEntryPrice = avgEntryPrice;
    }
  });
}

class FakeBotState {
  statusUpdates: Array<{ id: number; status: string; currentTrade: string | null }> = [];
  updateBotStatus = vi.fn(async (id: number, status: string, currentTrade: string | null = null) => {
    this.statusUpdates.push({ id, status, currentTrade });
  });
  updateBotHeartbeat = vi.fn(async () => {});
}

function makeRecovery(client: FakeClient, store: FakeStore, execStore: FakeExecutionStore, botState: FakeBotState): PositionRecovery {
  return new PositionRecovery(
    client as CoinSwitchClientLike,
    store as PositionStoreLike,
    execStore as unknown as ExecutionStore,
    {} as unknown as ProtectiveOrdersService,
    {},
    botState,
  );
}

const ACTIVE_EXECUTION = () => execution();

describe("PositionRecovery.recoverAllActive (exchange→DB sync) — scenarios A–J", () => {
  it("A: no active positions → empty summary, nothing touched", async () => {
    const client = new FakeClient();
    const store = new FakeStore();
    const execStore = new FakeExecutionStore();
    const botState = new FakeBotState();

    const summary = await makeRecovery(client, store, execStore, botState).recoverAllActive();

    expect(summary).toEqual({ positionsChecked: 0, confirmedClosed: 0, keptOpen: 0, failed: 0 });
    expect(store.markCloseCalls).toEqual([]);
    expect(store.createdExecutions).toEqual([]);
  });

  it("B: exchange read fails → position kept open, never closed, retried", async () => {
    const client = new FakeClient();
    client.failReads = true;
    const store = new FakeStore();
    store.positions = [position()];
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());

    const summary = await makeRecovery(client, store, execStore, new FakeBotState()).recoverAllActive();

    expect(summary).toEqual({ positionsChecked: 1, confirmedClosed: 0, keptOpen: 1, failed: 0 });
    expect(store.markCloseCalls).toEqual([]);
    expect(store.positions[0].state).toBe("PROTECTED");
  });

  it("C: live exchange position → kept open + entry/protection synced", async () => {
    const client = new FakeClient();
    client.positions = [exchangePosition()];
    client.openOrders = [
      openOrder({ orderId: "sl-1", raw: { reduce_only: "1", side: "SELL", type: "STOP" } }),
      openOrder({ orderId: "tp-1", raw: { reduce_only: "1", side: "SELL", type: "PROFIT" } }),
    ];
    const store = new FakeStore();
    store.positions = [position()];
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());

    const summary = await makeRecovery(client, store, execStore, new FakeBotState()).recoverAllActive();

    expect(summary).toEqual({ positionsChecked: 1, confirmedClosed: 0, keptOpen: 1, failed: 0 });
    expect(store.markCloseCalls).toEqual([]);
    expect(store.positions[0].state).toBe("PROTECTED");
    expect(store.protectedUpdated.length).toBeGreaterThanOrEqual(1);
    expect(client.getPositions).toHaveBeenCalledWith(7, "NEARUSDT");
  });

  it("D: live position while DB is ENTRY_PENDING → recovered to ENTRY_EXECUTED, still open", async () => {
    const client = new FakeClient();
    client.positions = [exchangePosition()];
    client.openOrders = [openOrder({ orderId: "sl-1" }), openOrder({ orderId: "tp-1" })];
    const store = new FakeStore();
    store.positions = [position({ state: "ENTRY_PENDING", quantity: 100, filledQuantity: 100 })];
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());

    const summary = await makeRecovery(client, store, execStore, new FakeBotState()).recoverAllActive();

    expect(summary).toEqual({ positionsChecked: 1, confirmedClosed: 0, keptOpen: 1, failed: 0 });
    expect(store.positions[0].state).toBe("ENTRY_EXECUTED");
    expect(execStore.stateUpdates).toContainEqual({ id: 10, state: "ENTRY_FILLED" });
    expect(store.markCloseCalls).toEqual([]);
  });

  it("E: missing position + SL order EXECUTED → closed as STOP_LOSS with exchange prices", async () => {
    const client = new FakeClient();
    client.orderStatus = {
      "sl-1": { status: "EXECUTED", raw: { avg_execution_price: "96.5", realised_pnl: "-7", execution_fee: "0.2" } },
      "tp-1": { status: "RAISED", raw: {} },
    };
    client.transactions = [
      tx({ type: "commission", amount: 0.6 }),
      tx({ type: "funding fee", amount: 0.02 }),
    ];
    const store = new FakeStore();
    store.positions = [position()];
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());
    const botState = new FakeBotState();

    const summary = await makeRecovery(client, store, execStore, botState).recoverAllActive();

    expect(summary).toEqual({ positionsChecked: 1, confirmedClosed: 1, keptOpen: 0, failed: 0 });
    const p = store.positions[0];
    expect(p.state).toBe("CLOSED");
    expect(p.exitReason).toBe("STOP_LOSS");
    expect(p.exitPrice).toBeCloseTo(96.5, 2);
    expect(p.realizedPnl).toBeCloseTo(-350.62, 2);
    expect(p.fees).toBeCloseTo(0.6, 2);
    expect(store.closedSummaries[0].reason).toBe("STOP_LOSS");
    expect(execStore.stateUpdates).toContainEqual({ id: 10, state: "CLOSED" });
    expect(botState.statusUpdates).toContainEqual({ id: 100, status: "RUNNING", currentTrade: null });
  });

  it("F: missing position + TP order EXECUTED → closed as TAKE_PROFIT", async () => {
    const client = new FakeClient();
    client.orderStatus = {
      "tp-1": { status: "EXECUTED", raw: { avg_execution_price: "110", realised_pnl: "18", execution_fee: "0.4" } },
      "sl-1": { status: "RAISED", raw: {} },
    };
    client.transactions = [tx({ type: "commission", amount: 1.05 })];
    const store = new FakeStore();
    store.positions = [position({ takeProfit: 110 })];
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());

    const summary = await makeRecovery(client, store, execStore, new FakeBotState()).recoverAllActive();

    expect(summary.confirmedClosed).toBe(1);
    const p = store.positions[0];
    expect(p.state).toBe("CLOSED");
    expect(p.exitReason).toBe("TAKE_PROFIT");
    expect(p.exitPrice).toBeCloseTo(110, 2);
  });

  it("G: missing position + close proven via closed-order history → closed with real reason", async () => {
    const client = new FakeClient();
    client.closedOrders = [closedOrder({ orderId: "co-1", orderType: "PROFIT", avgExecutionPrice: 108, realizedPnl: 18 })];
    client.transactions = [tx({ type: "commission", amount: 1.05 })];
    const store = new FakeStore();
    store.positions = [position()];
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());

    const summary = await makeRecovery(client, store, execStore, new FakeBotState()).recoverAllActive();

    expect(summary.confirmedClosed).toBe(1);
    const p = store.positions[0];
    expect(p.state).toBe("CLOSED");
    expect(p.exitReason).toBe("TAKE_PROFIT");
    expect(p.exitPrice).toBeCloseTo(108, 2);
  });

  it("H: missing position + close proven via ledger realized P&L → closed MANUAL_CLOSE with ledger pnl", async () => {
    const client = new FakeClient();
    client.transactions = [tx({ type: "P&L", amount: 12.5, fee: -0.2 }), tx({ type: "commission", amount: 0.55 })];
    client.currentPrice = 99;
    const store = new FakeStore();
    store.positions = [position()];
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());

    const summary = await makeRecovery(client, store, execStore, new FakeBotState()).recoverAllActive();

    expect(summary.confirmedClosed).toBe(1);
    const p = store.positions[0];
    expect(p.state).toBe("CLOSED");
    expect(p.exitReason).toBe("MANUAL_CLOSE");
    expect(p.exitPrice).toBeCloseTo(99, 2);
    expect(p.realizedPnl).toBeCloseTo(-100.55, 2);
  });

  it("I: missing position but close unconfirmed → kept open, never closed", async () => {
    const client = new FakeClient();
    const store = new FakeStore();
    store.positions = [position()];
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());

    const summary = await makeRecovery(client, store, execStore, new FakeBotState()).recoverAllActive();

    expect(summary).toEqual({ positionsChecked: 1, confirmedClosed: 0, keptOpen: 1, failed: 0 });
    expect(store.positions[0].state).toBe("PROTECTED");
    expect(store.markCloseCalls).toEqual([]);
    expect(store.events.some((e) => e.type === "RECOVERY_UNAVAILABLE")).toBe(true);
  });

  it("J: missing position + ledger full-margin-loss → closed as LIQUIDATION with exact exit", async () => {
    const client = new FakeClient();
    // entry 100, qty 10, 10x → full margin loss = -100.
    client.transactions = [tx({ type: "P&L", amount: -100, fee: -0.05, timestamp: 1724700000000 })];
    client.currentPrice = 95; // above the boundary (~90.65) — liquidation detected via the P&L signal
    const store = new FakeStore();
    store.positions = [position({ quantity: 10, filledQuantity: 10, leverage: 10 })];
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, execution({ quantity: 10, filledQuantity: 10, leverage: 10 }));

    const summary = await makeRecovery(client, store, execStore, new FakeBotState()).recoverAllActive();

    expect(summary.confirmedClosed).toBe(1);
    const p = store.positions[0];
    expect(p.state).toBe("CLOSED");
    expect(p.exitReason).toBe("LIQUIDATION");
    expect(p.closedAt).toBe(new Date(1724700000000).toISOString());
    expect(store.events.some((e) => e.type === "RECOVERY_LIQUIDATION")).toBe(true);
  });
});

describe("PositionRecovery.recoverAllActive — entry-order & robustness scenarios", () => {
  it("K: ENTRY_PENDING entry order cancelled while offline → closed as ENTRY_CANCELLED", async () => {
    const client = new FakeClient();
    client.orderStatus = {
      "entry-1": { status: "CANCELLED", raw: {} },
    };
    const store = new FakeStore();
    store.positions = [position({ state: "ENTRY_PENDING", entryOrderId: "entry-1", stopLossOrderId: null, takeProfitOrderId: null })];
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());
    const botState = new FakeBotState();

    const summary = await makeRecovery(client, store, execStore, botState).recoverAllActive();

    expect(store.positions[0].state).toBe("CLOSED");
    expect(store.closedSummaries[0].reason).toBe("ENTRY_CANCELLED");
    expect(execStore.stateUpdates).toContainEqual({ id: 10, state: "CANCELLED" });
    expect(summary.positionsChecked).toBe(1);
    expect(botState.statusUpdates).toContainEqual({ id: 100, status: "RUNNING", currentTrade: null });
  });

  it("L: one failing position never aborts the sweep; others still reconcile", async () => {
    const client = new FakeClient();
    client.positions = [exchangePosition(), exchangePosition({ symbol: "BTCUSDT", positionId: "pos-2" })];
    client.openOrders = [openOrder({ orderId: "sl-1" }), openOrder({ orderId: "tp-1" })];
    const store = new FakeStore();
    store.positions = [
      position({ id: 1, symbol: "NEARUSDT", executionId: 10 }),
      position({ id: 2, symbol: "BTCUSDT", executionId: 11, botId: 101, stopLossOrderId: "sl-2", takeProfitOrderId: "tp-2" }),
    ];
    // A DB write failure for one position must not abort the whole sweep.
    store.updateEntry = vi.fn(async (id: number) => {
      if (id === 2) throw new Error("db write failed");
    });
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());
    execStore.records.set(11, execution({ id: 11, botId: 101, symbol: "BTCUSDT", executionKey: "7:101:BTCUSDT:BUY:100" }));

    const summary = await makeRecovery(client, store, execStore, new FakeBotState()).recoverAllActive();

    expect(summary).toEqual({ positionsChecked: 2, confirmedClosed: 0, keptOpen: 1, failed: 1 });
    expect(store.positions[0].state).toBe("PROTECTED"); // reconciled fine
    expect(store.positions[1].state).toBe("PROTECTED"); // left untouched for retry
    expect(store.markCloseCalls).toEqual([]);
  });

  it("M: active execution without a tracked position gets a position created first", async () => {
    const client = new FakeClient();
    client.positions = [exchangePosition()];
    client.openOrders = [openOrder({ orderId: "sl-1" }), openOrder({ orderId: "tp-1" })];
    const store = new FakeStore();
    const execStore = new FakeExecutionStore();
    execStore.records.set(10, ACTIVE_EXECUTION());

    const summary = await makeRecovery(client, store, execStore, new FakeBotState()).recoverAllActive();

    expect(store.createdExecutions.map((e) => e.id)).toEqual([10]);
    expect(store.positions).toHaveLength(1);
    expect(summary).toEqual({ positionsChecked: 1, confirmedClosed: 0, keptOpen: 1, failed: 0 });
    expect(store.markCloseCalls).toEqual([]);
  });
});