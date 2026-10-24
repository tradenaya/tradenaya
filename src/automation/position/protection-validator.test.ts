import { describe, it, expect } from "vitest";
import { ProtectionValidator } from "./ProtectionValidator";
import type { PositionSnapshot } from "./PositionManagerTypes";

const order = (orderId: string, type: string | null, side = "SELL", reduceOnly = true) => ({
  orderId, clientOrderId: null, status: "OPEN",
  raw: { order_id: orderId, side, reduce_only: reduceOnly, ...(type ? { order_type: type } : {}) },
});

const snap = (openOrders: ReturnType<typeof order>[], over: Record<string, unknown> = {}) => ({
  position: { id: 25, symbol: "BNBUSDT", side: "BUY", stopLoss: 770.13, takeProfit: 788.25, stopLossOrderId: null, takeProfitOrderId: "tp-1", ...over },
  openOrders, currentPrice: 771, exchangePosition: { symbol: "BNBUSDT", quantity: 0.03 }, positionsReadFailed: false, openOrdersReadFailed: false,
}) as unknown as PositionSnapshot;

const validate = (s: PositionSnapshot) => new ProtectionValidator().validate(s);

describe("protection check: a take-profit is never mistaken for the stop-loss", () => {
  it("only a take-profit on the exchange → stop-loss reported missing (the e2e / production case)", async () => {
    const r = await validate(snap([order("tp-1", "TAKE_PROFIT_MARKET")]));
    expect(r.hasStopLoss).toBe(false);
    expect(r.hasTakeProfit).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.issues).toContain("stop loss order not found on exchange");
  });

  it("only a stop-loss → take-profit reported missing", async () => {
    const r = await validate(snap([order("sl-9", "STOP_MARKET")], { takeProfitOrderId: null }));
    expect(r.hasStopLoss).toBe(true);
    expect(r.hasTakeProfit).toBe(false);
  });

  it("both on the exchange → valid, even when the stored ids are missing", async () => {
    const r = await validate(snap([order("a", "STOP_MARKET"), order("b", "TAKE_PROFIT_MARKET")], { takeProfitOrderId: null }));
    expect(r.valid).toBe(true);
  });

  it("a stored stop-loss id pointing at a take-profit order is not trusted", async () => {
    const r = await validate(snap([order("tp-1", "TAKE_PROFIT_MARKET")], { stopLossOrderId: "tp-1" }));
    expect(r.hasStopLoss).toBe(false);
  });

  it("orders on the wrong side (would open, not close) don't count", async () => {
    const r = await validate(snap([order("a", "STOP_MARKET", "BUY"), order("b", "TAKE_PROFIT_MARKET", "BUY")], { takeProfitOrderId: null }));
    expect(r.hasStopLoss).toBe(false);
    expect(r.hasTakeProfit).toBe(false);
  });

  it("the resting entry order (not reduce-only, no stop type) is never protection", async () => {
    const r = await validate(snap([order("e", "LIMIT", "SELL", false)], { takeProfitOrderId: null }));
    expect(r.hasStopLoss).toBe(false);
    expect(r.hasTakeProfit).toBe(false);
  });

  it("exchange sends no order type: one reduce-only order counts once, not as both", async () => {
    const r = await validate(snap([order("x", null)], { takeProfitOrderId: null }));
    expect(r.hasStopLoss).toBe(true);
    expect(r.hasTakeProfit).toBe(false);
  });

  it("short positions: protective orders are BUY", async () => {
    const r = await validate(snap([order("a", "STOP_MARKET", "BUY"), order("b", "TAKE_PROFIT_MARKET", "BUY")], { side: "SELL", takeProfitOrderId: null }));
    expect(r.valid).toBe(true);
  });
});
