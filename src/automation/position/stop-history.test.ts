import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({ db: { query: (...args: unknown[]) => queryMock(...args) } }));
const getOrderStatus = vi.fn();
vi.mock("@/automation/executor/client", () => ({ coinswitchClient: { getOrderStatus: (...a: unknown[]) => getOrderStatus(...a) } }));
vi.mock("@/automation/paper/mode", () => ({ withBotMode: (_id: number, fn: () => unknown) => fn() }));

import { getStopHistory } from "./stop-history";

const position = {
  id: 40, execution_id: 56, bot_id: 10, user_id: 1, symbol: "HYPEUSDT", side: "SELL", state: "TRAILING",
  entry_price: "82.615", filled_quantity: "0.83", quantity: "0.83", leverage: "16", current_price: "79.1",
  stop_loss: "81.5", take_profit: "67.94", sl_order_id: "sl-3", tp_order_id: "tp-1",
  exit_price: null, exit_reason: null, created_at: new Date("2026-10-13T05:02:01Z"), closed_at: null,
  trading_mode: "PAPER", plan_stop_loss: "84.08", plan_take_profit: "67.94", exec_created_at: new Date("2026-10-13T05:01:58Z"),
};

function route(sql: string) {
  if (sql.includes("FROM automation_positions p")) return [[position]];
  if (sql.includes("FROM automation_position_events")) {
    return [[
      // recorded before details existed: only a message
      { type: "TRAILING_MOVED", message: "stop loss trailed to the 10-candle high 82.078 USDT", details: null, created_at: new Date("2026-10-18T04:02:34Z") },
      { type: "TRAILING_FAILED", message: "exchange rejected the new stop at 81.9: Trigger price invalid", details: JSON.stringify({ reason: "exchange rejected the new stop at 81.9: Trigger price invalid", wanted: 81.9 }), created_at: new Date("2026-10-18T05:00:00Z") },
      // new style: full details
      {
        type: "TRAILING_MOVED", message: "stop loss trailed to the 10-candle high 81.5 USDT",
        details: JSON.stringify({ from: 82.078, to: 81.5, price: 78.9, rule: "10-candle high", oldOrderId: "sl-2", oldOrderCancelled: true, newOrderId: "sl-3", newOrderStatus: "OPEN" }),
        created_at: new Date("2026-10-18T08:02:00Z"),
      },
    ]];
  }
  if (sql.includes("FROM futures_orders_history")) {
    return [[
      { exchange_order_id: "sl-1", trigger_price: "84.08", status: "OPEN", created_at: new Date("2026-10-13T05:02:05Z") },
      { exchange_order_id: "sl-1", trigger_price: "84.08", status: "CANCELLED", created_at: new Date("2026-10-18T04:02:34Z") },
      { exchange_order_id: "sl-2", trigger_price: "82.078", status: "OPEN", created_at: new Date("2026-10-18T04:02:34Z") },
    ]];
  }
  return [[]]; // schema checks (information_schema / CREATE TABLE)
}

describe("getStopHistory", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => route(sql));
    getOrderStatus.mockReset();
    getOrderStatus.mockImplementation(async (_u: number, id: string) => ({ orderId: id, status: id === "sl-3" ? "OPEN" : "UNTRIGGERED", raw: {} }));
  });

  it("builds the full, provable stop timeline (old and new style events)", async () => {
    const h = await getStopHistory(1, { positionId: 40 });
    expect(h).not.toBeNull();
    expect(h!.original).toMatchObject({ price: 84.08, orderId: "sl-1" });
    expect(h!.moves).toHaveLength(2);
    // legacy event: level parsed from the message, orders matched from order history
    expect(h!.moves[0]).toMatchObject({ from: 84.08, to: 82.078, oldOrderId: "sl-1", oldOrderCancelled: true, newOrderId: "sl-2" });
    // new event: everything straight from the recorded details
    expect(h!.moves[1]).toMatchObject({ from: 82.078, to: 81.5, price: 78.9, rule: "10-candle high", newOrderId: "sl-3", newOrderStatus: "OPEN", oldOrderCancelled: true });
    expect(h!.failures).toEqual([{ at: "2026-10-18T05:00:00.000Z", reason: "exchange rejected the new stop at 81.9: Trigger price invalid", wanted: 81.9 }]);
    expect(h!.takeProfit).toMatchObject({ price: 67.94, trails: false });
    expect(h!.margin).toBeCloseTo((82.615 * 0.83) / 16, 6);
  });

  it("checks the current stop and target with the exchange for open positions", async () => {
    const h = await getStopHistory(1, { positionId: 40 });
    expect(getOrderStatus).toHaveBeenCalledWith(1, "sl-3");
    expect(getOrderStatus).toHaveBeenCalledWith(1, "tp-1");
    expect(h!.current.check).toMatchObject({ orderId: "sl-3", status: "OPEN", active: true });
    expect(h!.takeProfit.check).toMatchObject({ orderId: "tp-1", status: "UNTRIGGERED", active: true });
  });

  it("reports a failed exchange check instead of claiming the order is fine", async () => {
    getOrderStatus.mockRejectedValue(new Error("429 rate limited"));
    const h = await getStopHistory(1, { positionId: 40 });
    expect(h!.current.check).toMatchObject({ active: null, status: null, error: "429 rate limited" });
  });

  it("returns null for a position that is not the user's", async () => {
    queryMock.mockImplementation(async (sql: string) => (sql.includes("FROM automation_positions p") ? [[]] : route(sql)));
    expect(await getStopHistory(2, { positionId: 40 })).toBeNull();
  });
});
