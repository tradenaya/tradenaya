import type { CoinSwitchClientLike, CloseDetectionResult, PositionSnapshot } from "./PositionManagerTypes";
import { isFullyFilled } from "@/automation/executor/order-status";

export class TPMonitor {
  constructor(private readonly client: CoinSwitchClientLike) {}

  async check(snapshot: PositionSnapshot): Promise<CloseDetectionResult> {
    const { position } = snapshot;

    if (!position.takeProfit) {
      return { shouldClose: false, reason: "TAKE_PROFIT", exitPrice: null, detail: "no take profit configured" };
    }

    if (position.takeProfitTriggered) {
      return { shouldClose: true, reason: "TAKE_PROFIT", exitPrice: null, detail: "take profit already triggered" };
    }

    if (!position.takeProfitOrderId) {
      return { shouldClose: false, reason: "TAKE_PROFIT", exitPrice: null, detail: "no take profit order id" };
    }

    const order = await this.client.getOrderStatus(position.userId, position.takeProfitOrderId).catch(() => null);
    const status = order?.status ?? "";

    if (isFullyFilled(order?.status)) {
      return {
        shouldClose: true,
        reason: "TAKE_PROFIT",
        exitPrice: this.extractPrice(order?.raw) ?? position.takeProfit,
        detail: `take profit order ${position.takeProfitOrderId} filled (${status})`,
      };
    }

    return { shouldClose: false, reason: "TAKE_PROFIT", exitPrice: null, detail: `tp status ${status || "unknown"}` };
  }

  private extractPrice(raw: any): number | null {
    const p = raw?.avg_execution_price ?? raw?.avg_price ?? raw?.avgPrice ?? raw?.price ?? raw?.trigger_price ?? null;
    return p != null ? Number(p) : null;
  }
}
