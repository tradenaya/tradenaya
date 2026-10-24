import type { ExchangeOrder } from "@/automation/executor/client";
import type { ProtectionValidationResult, PositionSnapshot } from "./PositionManagerTypes";

type ProtectiveKind = "stop_loss" | "take_profit";

/** What kind of protective order this is, from the exchange's order type (null when the type isn't given). */
export function protectiveKind(order: ExchangeOrder): ProtectiveKind | null {
  const raw = order.raw ?? {};
  const type = String(raw.order_type ?? raw.orderType ?? raw.type ?? "").toUpperCase();
  if (!type) return null;
  if (type.includes("TAKE_PROFIT") || type === "TP") return "take_profit";
  if (type.includes("STOP")) return "stop_loss";
  return null;
}

export class ProtectionValidator {
  async validate(snapshot: PositionSnapshot): Promise<ProtectionValidationResult> {
    const { position, openOrders } = snapshot;
    const issues: string[] = [];

    const opposite = position.side === "BUY" ? "SELL" : "BUY";
    const slOrder = this.findProtective(openOrders, position.stopLossOrderId, "stop_loss", opposite, null);
    // One order can never count as both the stop-loss and the take-profit.
    const tpOrder = this.findProtective(openOrders, position.takeProfitOrderId, "take_profit", opposite, slOrder);

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

  /**
   * Find the live protective order of one kind. A take-profit must never be
   * accepted as the stop-loss (or the other way round): production positions
   * with only a take-profit on the exchange passed as "protected" because any
   * reduce-only order on the closing side matched, so the missing stop-loss was
   * never re-placed.
   */
  private findProtective(orders: ExchangeOrder[], knownOrderId: string | null, kind: ProtectiveKind, side: string, exclude: ExchangeOrder | null): ExchangeOrder | null {
    const candidates = orders.filter((o) => o !== exclude);
    const rawSide = (o: ExchangeOrder) => String(o.raw?.side ?? o.raw?.position_side ?? "").toUpperCase();

    if (knownOrderId) {
      const byId = candidates.find((o) => o.orderId === knownOrderId);
      if (byId && protectiveKind(byId) !== (kind === "stop_loss" ? "take_profit" : "stop_loss")) return byId;
    }

    const byType = candidates.find((o) => protectiveKind(o) === kind && rawSide(o) === side);
    if (byType) return byType;

    // Exchange gave no order type: fall back to a reduce-only order on the closing side.
    return candidates.find((o) => {
      const raw = o.raw ?? {};
      const isReduceOnly = raw.reduce_only === true || raw.reduceOnly === true || String(raw.reduce_only) === "1";
      return protectiveKind(o) === null && isReduceOnly && rawSide(o) === side;
    }) ?? null;
  }
}
