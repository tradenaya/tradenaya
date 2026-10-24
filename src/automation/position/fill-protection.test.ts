import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { query: vi.fn().mockResolvedValue([[]]) } }));
const dispatchTelegram = vi.fn();
vi.mock("@/lib/telegram-dispatch", () => ({ dispatchTelegram: (...a: unknown[]) => dispatchTelegram(...a) }));

import { PositionMonitor } from "./PositionMonitor";
import type { PositionRecord, PositionSnapshot } from "./PositionManagerTypes";

/**
 * Production (Oct 21): a resting entry filled, nothing placed its stop-loss, the
 * next check raised "UNPROTECTED" (Telegram) and placed it as an emergency.
 * Now the fill itself places the protection.
 */
function position(over: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id: 47, botId: 13, userId: 1, executionId: 63, symbol: "XRPUSDT", side: "BUY", state: "ENTRY_PENDING",
    entryOrderId: "e-1", stopLoss: 1.33, takeProfit: 1.47, stopLossOrderId: null, takeProfitOrderId: null,
    quantity: 5.9, filledQuantity: null, createdAt: new Date().toISOString(), ...over,
  } as unknown as PositionRecord;
}

function setup({ placeOk = true, orderStatus = "EXECUTED" }: { placeOk?: boolean; orderStatus?: string | null } = {}) {
  const client = {
    getOrderStatus: vi.fn(async () => ({ orderId: "e-1", status: orderStatus, raw: { exec_quantity: "5.9", avg_execution_price: "1.3729" } })),
    cancelOrder: vi.fn(async () => true),
  };
  const monitor = new PositionMonitor(client as never);
  const saved: { type: string; message: string }[] = [];
  const store = {
    updateEntry: vi.fn(), updateFillQuantities: vi.fn(),
    getPosition: vi.fn(async () => position({ state: "ENTRY_EXECUTED", stopLossOrderId: "sl-1", takeProfitOrderId: "tp-1" })),
    saveEvent: vi.fn(async (e: { type: string; message: string }) => void saved.push(e)),
  };
  const executionStore = {
    getExecution: vi.fn(async () => ({ id: 63, stopLoss: 1.33, takeProfit: 1.47, filledQuantity: 5.9, expiresAt: Date.now() - 1000, quantity: 5.9 })),
    updateFill: vi.fn(), updateState: vi.fn(),
  };
  const transitions: string[] = [];
  const stateManager = { transition: vi.fn(async (_id: number, from: string, to: string) => { transitions.push(`${from}->${to}`); return true; }) };
  const protective = { placeProtection: vi.fn(async (_execution: { stopLoss: number | null; takeProfit: number | null }, _qty: number | null) => (placeOk ? { slPlaced: true, tpPlaced: true, status: "PLACED" } : { slPlaced: false, tpPlaced: false, status: "FAILED" })) };
  Object.assign(monitor as object, { store, executionStore, stateManager, protective });
  const snap = (p: PositionRecord) => ({ position: p, currentPrice: 1.37, exchangePosition: { symbol: "XRPUSDT", quantity: 5.9, entryPrice: 1.3729 }, openOrders: [], positionsReadFailed: false, openOrdersReadFailed: false }) as unknown as PositionSnapshot;
  return { monitor, client, protective, transitions, saved, snap };
}

describe("a resting entry that fills is protected straight away", () => {
  it("places stop-loss + take-profit on the fill and goes PROTECTED — no unprotected alert", async () => {
    const { monitor, protective, transitions, saved, snap } = setup();
    const p = position();
    await (monitor as unknown as { handleEntryPending(s: PositionSnapshot): Promise<void> }).handleEntryPending(snap(p));
    expect(protective.placeProtection).toHaveBeenCalledTimes(1);
    expect(protective.placeProtection.mock.calls[0][0]).toMatchObject({ stopLoss: 1.33, takeProfit: 1.47 });
    expect(transitions).toEqual(["ENTRY_PENDING->ENTRY_EXECUTED", "ENTRY_EXECUTED->PROTECTED"]);
    expect(saved.map((e) => e.type)).toEqual(["ENTRY_EXECUTED", "PROTECTED"]);
    expect(dispatchTelegram).not.toHaveBeenCalledWith(expect.anything(), "POSITION_UNPROTECTED", expect.anything());
  });

  it("if placing fails, it is retried on the next check without a scary alert", async () => {
    const { monitor, saved, snap } = setup({ placeOk: false });
    await (monitor as unknown as { handleEntryPending(s: PositionSnapshot): Promise<void> }).handleEntryPending(snap(position()));
    expect(saved.map((e) => e.type)).toContain("PROTECTION_PENDING");
    expect(dispatchTelegram).not.toHaveBeenCalled();
  });
});

describe("expired entry remainder", () => {
  it("does not fire a blind cancel when the order status can't be read", async () => {
    const { monitor, client, snap } = setup({ orderStatus: null });
    await (monitor as unknown as { expireRestingEntryRemainder(s: PositionSnapshot): Promise<void> }).expireRestingEntryRemainder(snap(position({ state: "PROTECTED", filledQuantity: 3 })));
    expect(client.cancelOrder).not.toHaveBeenCalled();
  });

  it("does nothing once the entry is fully filled", async () => {
    const { monitor, client, snap } = setup({ orderStatus: "OPEN" });
    await (monitor as unknown as { expireRestingEntryRemainder(s: PositionSnapshot): Promise<void> }).expireRestingEntryRemainder(snap(position({ state: "PROTECTED", filledQuantity: 5.9 })));
    expect(client.getOrderStatus).not.toHaveBeenCalled();
    expect(client.cancelOrder).not.toHaveBeenCalled();
  });

  it("still cancels a real remainder that is past its expiry", async () => {
    const { monitor, client, snap } = setup({ orderStatus: "PARTIALLY_EXECUTED_OPEN" });
    await (monitor as unknown as { expireRestingEntryRemainder(s: PositionSnapshot): Promise<void> }).expireRestingEntryRemainder(snap(position({ state: "PROTECTED", filledQuantity: 3 })));
    expect(client.cancelOrder).toHaveBeenCalledWith(1, "e-1");
  });
});
