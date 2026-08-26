import { describe, expect, it, vi } from "vitest";
import { detectExecutedClose, type ExecutedCloseClientLike } from "./executed-close";

function client(getOrderStatus: (userId: number, orderId: string) => Promise<{ status?: string | null; raw?: Record<string, unknown> }>): ExecutedCloseClientLike {
  return { getOrderStatus: vi.fn(getOrderStatus) };
}

describe("detectExecutedClose", () => {
  it("returns TAKE_PROFIT details when the TP order executed", async () => {
    const c = client(async () => ({
      status: "EXECUTED",
      raw: { order_id: "tp1", avg_execution_price: "65000", realised_pnl: "12.5", execution_fee: "0.65" },
    }));
    const result = await detectExecutedClose(c, 1, { stopLossOrderId: "sl1", takeProfitOrderId: "tp1" });
    expect(result).toEqual({ reason: "TAKE_PROFIT", price: 65000, realizedPnl: 12.5, fees: 0.65 });
  });

  it("returns STOP_LOSS details when only the SL order executed", async () => {
    const c = client(async (_, orderId) => {
      if (orderId === "tp1") return { status: "RAISED", raw: {} };
      return { status: "EXECUTED", raw: { avg_execution_price: "61000", realised_pnl: "-4", execution_fee: "0.31" } };
    });
    const result = await detectExecutedClose(c, 1, { stopLossOrderId: "sl1", takeProfitOrderId: "tp1" });
    expect(result).toEqual({ reason: "STOP_LOSS", price: 61000, realizedPnl: -4, fees: 0.31 });
  });

  it("returns null when neither protective order has executed", async () => {
    const c = client(async () => ({ status: "RAISED", raw: {} }));
    const result = await detectExecutedClose(c, 1, { stopLossOrderId: "sl1", takeProfitOrderId: "tp1" });
    expect(result).toBeNull();
  });

  it("returns null when there are no protective order ids", async () => {
    const c = client(async () => ({ status: "EXECUTED", raw: {} }));
    const result = await detectExecutedClose(c, 1, { stopLossOrderId: null, takeProfitOrderId: null });
    expect(result).toBeNull();
    expect(c.getOrderStatus).not.toHaveBeenCalled();
  });

  it("tolerates an order-status API failure", async () => {
    const c = client(async () => {
      throw new Error("boom");
    });
    const result = await detectExecutedClose(c, 1, { stopLossOrderId: "sl1", takeProfitOrderId: "tp1" });
    expect(result).toBeNull();
  });
});
