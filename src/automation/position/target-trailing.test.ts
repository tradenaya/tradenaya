import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: { query: vi.fn().mockResolvedValue([[]]) } }));
vi.mock("@/automation/order-history", () => ({ OrderHistoryRepository: class { saveOrder = vi.fn().mockResolvedValue(undefined); } }));
const getCandles = vi.fn();
vi.mock("@/automation/market/service", () => ({ serverMarketDataService: { getCandles: (...a: unknown[]) => getCandles(...a) } }));

import { PositionMonitor } from "./PositionMonitor";
import { TrailingStopManager } from "./TrailingStopManager";
import type { CoinSwitchClientLike, PositionRecord, PositionSnapshot, PositionStoreLike } from "./PositionManagerTypes";

/**
 * Smart "trailing take-profit": a long at 100, stop 98 (1R = 2), target 104 (2R).
 * Near the target the trade stays open: stop → 102 (entry + 1R), take-profit
 * pushed to 108; later the stop follows the last 10 candles.
 */
function position(over: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id: 7, botId: 3, userId: 1, executionId: 70, symbol: "ETHUSDT", side: "BUY", state: "PROTECTED",
    entryPrice: 100, stopLoss: 98, takeProfit: 104, filledQuantity: 1, quantity: 1,
    stopLossOrderId: "sl-1", takeProfitOrderId: "tp-1", trailingActivated: false,
    highestPrice: null, lowestPrice: null, createdAt: new Date().toISOString(), ...over,
  } as unknown as PositionRecord;
}
const snap = (p: PositionRecord, price: number) =>
  ({ position: p, currentPrice: price, exchangePosition: null, openOrders: [], positionsReadFailed: false, openOrdersReadFailed: false }) as unknown as PositionSnapshot;

function monitorWith(trailing: Partial<TrailingStopManager>) {
  const monitor = new PositionMonitor({} as never);
  const store = { markTrailingActivated: vi.fn().mockResolvedValue(undefined), saveEvent: vi.fn().mockResolvedValue(undefined), updateTrailing: vi.fn() };
  const executionStore = { getExecution: vi.fn().mockResolvedValue({ stopLoss: 98, takeProfit: 104 }), saveNotification: vi.fn() };
  const stateManager = { transition: vi.fn().mockResolvedValue(true) };
  Object.assign(monitor as object, { store, trailing, executionStore, stateManager });
  const run = (s: PositionSnapshot) => (monitor as unknown as { syncTargetTrailing(s: PositionSnapshot, tf: number): Promise<void> }).syncTargetTrailing(s, 60);
  return { run, store };
}

describe("Smart trailing take-profit — monitor", () => {
  beforeEach(() => getCandles.mockReset().mockResolvedValue([]));

  it("does nothing while price is still away from the take-profit", async () => {
    const trailing = { moveStopTo: vi.fn(), moveTakeProfitTo: vi.fn() };
    const { run, store } = monitorWith(trailing);
    await run(snap(position(), 102.5)); // 1.5R from target 104 is 0.75R away
    expect(trailing.moveStopTo).not.toHaveBeenCalled();
    expect(trailing.moveTakeProfitTo).not.toHaveBeenCalled();
    expect(store.markTrailingActivated).not.toHaveBeenCalled();
  });

  it("near the take-profit: locks +1R with the stop-loss and pushes the take-profit out", async () => {
    const trailing = {
      moveStopTo: vi.fn().mockResolvedValue({ moved: true, newStopLoss: 102, move: { from: 98, to: 102, price: 103.8 } }),
      moveTakeProfitTo: vi.fn().mockResolvedValue({ moved: true, from: 104, to: 108, newOrderId: "tp-2", oldOrderId: "tp-1" }),
    };
    const { run, store } = monitorWith(trailing);
    const p = position();
    await run(snap(p, 103.8)); // within 0.15R (0.3) of 104
    expect(trailing.moveStopTo.mock.calls[0][1]).toBeCloseTo(102, 8); // entry + (2R − 1R)
    expect(trailing.moveTakeProfitTo.mock.calls[0][1]).toBeCloseTo(108, 8); // target + one target distance
    expect(store.markTrailingActivated).toHaveBeenCalledWith(7);
    const types = store.saveEvent.mock.calls.map((c) => c[0].type);
    expect(types).toEqual(expect.arrayContaining(["TRAILING_ARMED", "TARGET_MOVED"]));
    // stop-loss is moved BEFORE the take-profit
    expect(trailing.moveStopTo.mock.invocationCallOrder[0]).toBeLessThan(trailing.moveTakeProfitTo.mock.invocationCallOrder[0]);
  });

  it("keeps pushing the take-profit each time price nears it again", async () => {
    const trailing = { moveStopTo: vi.fn().mockResolvedValue({ moved: false }), moveTakeProfitTo: vi.fn().mockResolvedValue({ moved: true, from: 108, to: 112 }) };
    const { run, store } = monitorWith(trailing);
    await run(snap(position({ trailingActivated: true, stopLoss: 105, takeProfit: 108 }), 107.9));
    expect(trailing.moveTakeProfitTo.mock.calls[0][1]).toBeCloseTo(112, 8);
    expect(store.markTrailingActivated).not.toHaveBeenCalled(); // already armed — stop not reset back
  });

  it("once armed, the stop-loss follows the last 10 closed candles", async () => {
    const H = 3600e3, now = Date.now();
    getCandles.mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ timestamp: now - (13 - i) * H, open: 105, high: 107, low: 104 + i * 0.1, close: 106, volume: 1, timeframe: "1h" })));
    const trailing = { moveStopTo: vi.fn().mockResolvedValue({ moved: false }), moveTakeProfitTo: vi.fn() };
    const { run } = monitorWith(trailing);
    await run(snap(position({ trailingActivated: true, stopLoss: 102, takeProfit: 112 }), 106));
    expect(trailing.moveTakeProfitTo).not.toHaveBeenCalled(); // not near 112
    expect(trailing.moveStopTo).toHaveBeenCalledTimes(1);
    expect(trailing.moveStopTo.mock.calls[0][1]).toBeCloseTo(104.2, 8); // lowest low of the last 10 closed candles
  });
});

describe("Smart trailing take-profit — moving the take-profit order", () => {
  const client = (over: Record<string, unknown> = {}) =>
    ({
      getOpenOrders: vi.fn().mockResolvedValue([]),
      getOrderStatus: vi.fn().mockResolvedValue({ orderId: "tp-2", status: "NEW", raw: {} }),
      cancelOrder: vi.fn().mockResolvedValue(true),
      placeOrder: vi.fn().mockResolvedValue({ orderId: "tp-2", clientOrderId: null, status: "NEW", raw: {} }),
      getInstrumentInfo: vi.fn().mockResolvedValue({ price_precision: 2 }),
      ...over,
    }) as unknown as CoinSwitchClientLike & { placeOrder: ReturnType<typeof vi.fn>; cancelOrder: ReturnType<typeof vi.fn> };
  const store = () => ({ updateProtection: vi.fn(), updateTakeProfit: vi.fn(), updateTrailing: vi.fn() }) as unknown as PositionStoreLike & { updateProtection: ReturnType<typeof vi.fn>; updateTakeProfit: ReturnType<typeof vi.fn> };

  it("cancels the old take-profit, places the new one further out and records it", async () => {
    const c = client(), st = store(), hook = vi.fn().mockResolvedValue(undefined);
    const p = position();
    const r = await new TrailingStopManager(c, st, undefined, hook).moveTakeProfitTo(snap(p, 103.8), 108.003);
    expect(r).toMatchObject({ moved: true, from: 104, to: 108.01, newOrderId: "tp-2" });
    expect(c.cancelOrder).toHaveBeenCalledWith(1, "tp-1");
    expect(c.placeOrder.mock.calls[0][1]).toMatchObject({ orderType: "TAKE_PROFIT_MARKET", side: "SELL", triggerPrice: 108.01, reduceOnly: true });
    expect(st.updateProtection).toHaveBeenCalledWith(7, "sl-1", "tp-2"); // the stop-loss is untouched
    expect(st.updateTakeProfit).toHaveBeenCalledWith(7, 108.01);
    expect(hook).toHaveBeenCalled();
    expect(p.takeProfit).toBe(108.01);
  });

  it("never moves the take-profit closer (only further out)", async () => {
    const c = client();
    const r = await new TrailingStopManager(c, store()).moveTakeProfitTo(snap(position(), 103), 103.5);
    expect(r.moved).toBe(false);
    expect(c.cancelOrder).not.toHaveBeenCalled();
  });

  it("puts the old take-profit back if the new one cannot be placed", async () => {
    const c = client({
      placeOrder: vi.fn()
        .mockRejectedValueOnce(new Error("busy")).mockRejectedValueOnce(new Error("busy")).mockRejectedValueOnce(new Error("busy"))
        .mockResolvedValue({ orderId: "tp-restored", clientOrderId: null, status: "NEW", raw: {} }),
      getOrderStatus: vi.fn().mockResolvedValue({ orderId: "tp-restored", status: "NEW", raw: {} }),
    });
    const st = store();
    const r = await new TrailingStopManager(c, st).moveTakeProfitTo(snap(position(), 103.8), 108);
    expect(r.moved).toBe(false);
    expect(r.failure).toMatch(/kept it at 104/);
    expect(c.placeOrder.mock.calls.at(-1)![1].triggerPrice).toBe(104);
    expect(st.updateProtection).toHaveBeenCalledWith(7, "sl-1", "tp-restored");
  });
});

describe("emergency re-protection after trailing", () => {
  it("re-places the CURRENT stop-loss / take-profit, not the stale planned ones", async () => {
    const { PositionRecovery } = await import("./PositionRecovery");
    const placeProtection = vi.fn().mockResolvedValue({ status: "PLACED" });
    const store = { getPositionByExecutionId: vi.fn().mockResolvedValue(position({ stopLoss: 105, takeProfit: 112 })) };
    const executionStore = { getExecution: vi.fn().mockResolvedValue({ id: 70, stopLoss: 98, takeProfit: 104, filledQuantity: 1 }) };
    const recovery = new PositionRecovery({} as never, store as never, executionStore as never, { placeProtection } as never, {}, { updateBotStatus: vi.fn(), updateBotHeartbeat: vi.fn() });
    expect(await recovery.emergencyProtect(70)).toBe(true);
    expect(placeProtection.mock.calls[0][0]).toMatchObject({ stopLoss: 105, takeProfit: 112 });
  });
});
