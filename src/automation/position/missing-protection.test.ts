import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: { query: vi.fn().mockResolvedValue([[]]) } }));
const dispatchTelegram = vi.fn();
vi.mock("@/lib/telegram-dispatch", () => ({ dispatchTelegram: (...a: unknown[]) => dispatchTelegram(...a) }));

import { PositionMonitor } from "./PositionMonitor";
import { PositionRecovery } from "./PositionRecovery";
import type { PositionRecord, PositionSnapshot } from "./PositionManagerTypes";

/**
 * What the monitor does when protection goes missing on an open, protected trade:
 *  - stop-loss missing → real danger: "UNPROTECTED" alert + emergency re-protection;
 *  - only the take-profit missing (stop-loss in place) → not dangerous: re-placed
 *    quietly, no alarm, the trade keeps being managed.
 */
const order = (orderId: string, type: string) => ({ orderId, clientOrderId: null, status: "OPEN", raw: { order_id: orderId, side: "SELL", reduce_only: true, order_type: type } });

function setup(openOrders: ReturnType<typeof order>[]) {
  const position = {
    id: 25, userId: 1, botId: 4, executionId: 28, symbol: "BNBUSDT", side: "BUY", state: "PROTECTED",
    stopLoss: 770.13, takeProfit: 788.25, stopLossOrderId: "sl-1", takeProfitOrderId: "tp-1",
    quantity: 0.03, filledQuantity: 0.03, createdAt: new Date().toISOString(),
  } as unknown as PositionRecord;
  const client = { getOrderStatus: vi.fn(async (_u: number, id: string) => ({ orderId: id, status: "CANCELLED", raw: {} })) };
  const monitor = new PositionMonitor(client as never);
  const events: string[] = [];
  const transitions: string[] = [];
  const emergencyProtect = vi.fn(async () => true);
  Object.assign(monitor as object, {
    store: { getPosition: vi.fn(async () => ({ ...position })), saveEvent: vi.fn(async (e: { type: string }) => void events.push(e.type)) },
    stateManager: { transition: vi.fn(async (_id: number, from: string, to: string) => { transitions.push(`${from}->${to}`); return true; }) },
    recovery: { emergencyProtect },
  });
  const m = monitor as unknown as Record<string, unknown>;
  m.expireRestingEntryRemainder = vi.fn();
  m.detectPartialExecution = vi.fn();
  m.detectClose = vi.fn(async () => ({ shouldClose: false }));
  m.syncTrailing = vi.fn();
  m.notify = vi.fn();
  const snapshot = {
    position, currentPrice: 771, openOrders, positionsReadFailed: false, openOrdersReadFailed: false,
    exchangePosition: { symbol: "BNBUSDT", quantity: 0.03, entryPrice: 777.35 },
  } as unknown as PositionSnapshot;
  const run = () => (monitor as unknown as { handleOpenPosition(s: PositionSnapshot): Promise<void> }).handleOpenPosition(snapshot);
  return { run, events, transitions, emergencyProtect, monitor };
}

beforeEach(() => dispatchTelegram.mockReset());

describe("missing protection on a protected trade", () => {
  it("stop-loss gone → UNPROTECTED alert and emergency re-protection", async () => {
    const { run, events, transitions, emergencyProtect } = setup([order("tp-1", "TAKE_PROFIT_MARKET")]);
    await run();
    expect(transitions[0]).toBe("PROTECTED->UNPROTECTED");
    expect(dispatchTelegram).toHaveBeenCalledWith(expect.anything(), "POSITION_UNPROTECTED", expect.anything());
    expect(emergencyProtect).toHaveBeenCalledTimes(1);
    expect(events).toContain("PROTECTED");
  });

  it("only the take-profit gone → re-placed quietly, no alarm, trade still managed", async () => {
    const { run, events, transitions, emergencyProtect, monitor } = setup([order("sl-1", "STOP_MARKET")]);
    await run();
    expect(dispatchTelegram).not.toHaveBeenCalled();
    expect(transitions).not.toContain("PROTECTED->UNPROTECTED");
    expect(events).toContain("TAKE_PROFIT_MISSING");
    expect(events).not.toContain("UNPROTECTED");
    expect(emergencyProtect).toHaveBeenCalledTimes(1);
    expect((monitor as unknown as { syncTrailing: ReturnType<typeof vi.fn> }).syncTrailing).toHaveBeenCalled();
  });

  it("everything in place → nothing re-placed", async () => {
    const { run, emergencyProtect } = setup([order("sl-1", "STOP_MARKET"), order("tp-1", "TAKE_PROFIT_MARKET")]);
    await run();
    expect(emergencyProtect).not.toHaveBeenCalled();
    expect(dispatchTelegram).not.toHaveBeenCalled();
  });
});

describe("emergency re-protection counts as done only with a stop-loss", () => {
  const recovery = (statuses: string[]) => {
    const placeProtection = vi.fn();
    for (const status of statuses) placeProtection.mockResolvedValueOnce({ status });
    const r = new PositionRecovery(
      {} as never,
      { getPositionByExecutionId: vi.fn(async () => null) } as never,
      { getExecution: vi.fn(async () => ({ id: 28, stopLoss: 770, takeProfit: 788, filledQuantity: 0.03 })) } as never,
      { placeProtection } as never,
      { emergencyRetries: statuses.length },
      { updateBotStatus: vi.fn(), updateBotHeartbeat: vi.fn() } as never,
    );
    return { r, placeProtection };
  };

  it("take-profit placed but stop-loss failed (TP_ONLY) is NOT recovered", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { r } = recovery(["TP_ONLY"]);
    const p = r.emergencyProtect(28);
    await vi.runAllTimersAsync();
    expect(await p).toBe(false);
    vi.useRealTimers();
  });

  it("stop-loss placed (with or without take-profit) is recovered", async () => {
    expect(await recovery(["SL_ONLY"]).r.emergencyProtect(28)).toBe(true);
    expect(await recovery(["PLACED"]).r.emergencyProtect(28)).toBe(true);
  });
});
