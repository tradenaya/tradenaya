import type { ExchangeOrder } from "@/automation/executor/client";
import type { ProtectionValidationResult, PositionSnapshot } from "./PositionManagerTypes";

export class ProtectionValidator {
  async validate(snapshot: PositionSnapshot): Promise<ProtectionValidationResult> {
    const { position, openOrders } = snapshot;
    const issues: string[] = [];

    const opposite = position.side === "BUY" ? "SELL" : "BUY";
    const slOrder = this.findProtective(openOrders, position.stopLossOrderId, "stop_loss", opposite);
    const tpOrder = this.findProtective(openOrders, position.takeProfitOrderId, "take_profit", opposite);

    const hasStopLoss = Boolean(position.stopLoss && slOrder);
    const hasTakeProfit = Boolean(position.takeProfit && tpOrder);

    if (!position.stopLoss) issues.push("stop loss price missing");
    else if (!slOrder) issues.push("stop loss order not found on exchange");

    if (!position.takeProfit) issues.push("take profit price missing");
    else if (!tpOrder) issues.push("take profit order not found on exchange");

    return {
      valid: hasStopLoss && hasTakeProfit,
      hasStopLoss,
      hasTakeProfit,
      issues,
    };
  }

  private findProtective(orders: ExchangeOrder[], knownOrderId: string | null, context: "stop_loss" | "take_profit", side: string): ExchangeOrder | null {
    if (knownOrderId) {
      const byId = orders.find((o) => o.orderId === knownOrderId);
      if (byId) return byId;
    }

    const matchingContext = orders.find((o) => {
      const raw = o.raw ?? {};
      const rawSide = String(raw.side ?? o.raw?.position_side ?? "").toUpperCase();
      const isReduceOnly = raw.reduce_only === true || raw.reduceOnly === true || String(raw.reduce_only) === "1";
      return isReduceOnly && rawSide === side;
    });

    if (matchingContext) return matchingContext;

    return orders.find((o) => {
      const raw = o.raw ?? {};
      const rawSide = String(raw.side ?? "").toUpperCase();
      const orderType = String(raw.order_type ?? "").toUpperCase();
      const isStop = orderType === "STOP_MARKET" || orderType === "STOP_LOSS" || orderType === "STOP";
      const isTp = orderType === "TAKE_PROFIT_MARKET" || orderType === "TAKE_PROFIT" || orderType === "TP";
      if (context === "stop_loss" && !isStop) return false;
      if (context === "take_profit" && !isTp) return false;
      return rawSide === side;
    }) ?? null;
  }
}
