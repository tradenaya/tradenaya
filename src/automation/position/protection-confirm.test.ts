import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { query: vi.fn().mockResolvedValue([[]]) } }));

import { PositionMonitor } from "./PositionMonitor";
import type { PositionRecord, PositionSnapshot, ProtectionValidationResult } from "./PositionManagerTypes";

/**
 * Regression: CoinSwitch sometimes returns the open-orders list without the
 * stop / take-profit, which raised false "UNPROTECTED" alerts (and placed
 * duplicate protection) while the orders were really live on the exchange.
 */
function setup(statuses: Record<string, string | Error>) {
  const client = {
    getOrderStatus: vi.fn(async (_userId: number, orderId: string) => {
      const s = statuses[orderId];
      if (s instanceof Error) throw s;
      return { orderId, clientOrderId: null, status: s ?? null, raw: {} };
    }),
  };
  const monitor = new PositionMonitor(client as never);
  const position = {
    id: 1, userId: 7, botId: 2, executionId: 3, symbol: "XRPUSDT", side: "SELL",
    stopLoss: 1.4, takeProfit: 0.96, stopLossOrderId: "sl-1", takeProfitOrderId: "tp-1",
  } as unknown as PositionRecord;
  const snapshot = { position, currentPrice: 1.3, exchangePosition: null, openOrders: [], positionsReadFailed: false, openOrdersReadFailed: false } as unknown as PositionSnapshot;
  const missing: ProtectionValidationResult = {
    valid: false, hasStopLoss: false, hasTakeProfit: false,
    issues: ["stop loss order not found on exchange", "take profit order not found on exchange"],
  };
  const confirm = (r: ProtectionValidationResult) =>
    (monitor as unknown as { confirmProtection(s: PositionSnapshot, r: ProtectionValidationResult): Promise<ProtectionValidationResult> }).confirmProtection(snapshot, r);
  return { client, snapshot, missing, confirm };
}

describe("PositionMonitor.confirmProtection", () => {
  it("treats orders missing from the list but live by id as PROTECTED (no false alarm)", async () => {
    const { confirm, missing, client } = setup({ "sl-1": "OPEN", "tp-1": "UNTRIGGERED" });
    const r = await confirm(missing);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
    expect(client.getOrderStatus).toHaveBeenCalledTimes(2);
  });

  it("still reports a stop that is really gone (cancelled) as missing", async () => {
    const { confirm, missing } = setup({ "sl-1": "CANCELLED", "tp-1": "OPEN" });
    const r = await confirm(missing);
    expect(r.valid).toBe(false);
    expect(r.hasStopLoss).toBe(false);
    expect(r.hasTakeProfit).toBe(true);
    expect(r.issues).toEqual(["stop loss order not found on exchange"]);
  });

  it("an unreadable status is a failed read: no alarm, no re-placing, retry next cycle", async () => {
    const { confirm, missing, snapshot } = setup({ "sl-1": new Error("429 too many requests"), "tp-1": "OPEN" });
    const r = await confirm(missing);
    expect(r.valid).toBe(false);
    expect(snapshot.openOrdersReadFailed).toBe(true);
  });

  it("leaves a valid result alone and makes no extra calls", async () => {
    const { confirm, client } = setup({});
    const ok: ProtectionValidationResult = { valid: true, hasStopLoss: true, hasTakeProfit: true, issues: [] };
    expect(await confirm(ok)).toBe(ok);
    expect(client.getOrderStatus).not.toHaveBeenCalled();
  });
});
