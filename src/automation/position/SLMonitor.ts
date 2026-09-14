import type { CoinSwitchClientLike, CloseDetectionResult, PositionSnapshot } from "./PositionManagerTypes";
import { isFullyFilled } from "@/automation/executor/order-status";

export class SLMonitor {
  constructor(private readonly client: CoinSwitchClientLike) {}

  async check(snapshot: PositionSnapshot): Promise<CloseDetectionResult> {
    const { position } = snapshot;

    if (!position.stopLoss) {
      return { shouldClose: false, reason: "STOP_LOSS", exitPrice: null, detail: "no stop loss configured" };
    }

    if (position.stopLossTriggered) {
      return { shouldClose: true, reason: "STOP_LOSS", exitPrice: null, detail: "stop loss already triggered" };
    }

    if (!position.stopLossOrderId) {
      return { shouldClose: false, reason: "STOP_LOSS", exitPrice: null, detail: "no stop loss order id" };
    }

    const order = await this.client.getOrderStatus(position.userId, position.stopLossOrderId).catch(() => null);
    const status = order?.status ?? "";

    if (isFullyFilled(order?.status)) {
      return {
        shouldClose: true,
        reason: "STOP_LOSS",
        exitPrice: this.extractPrice(order?.raw) ?? position.stopLoss,
        detail: `stop loss order ${position.stopLossOrderId} filled (${status})`,
      };
    }

    return { shouldClose: false, reason: "STOP_LOSS", exitPrice: null, detail: `sl status ${status}` };
  }

  private extractPrice(raw: any): number | null {
    const p = raw?.avg_execution_price ?? raw?.avg_price ?? raw?.avgPrice ?? raw?.price ?? raw?.trigger_price ?? null;
    return p != null ? Number(p) : null;
  }
}
