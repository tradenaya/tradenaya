import type { CoinSwitchClientLike, PositionSnapshot, PositionStoreLike } from "./PositionManagerTypes";
import { clientOrderId } from "@/automation/executor/order-id";

export interface TrailingUpdateResult {
  moved: boolean;
  newStopLoss: number | null;
}

export class TrailingStopManager {
  constructor(
    private readonly client: CoinSwitchClientLike,
    private readonly store: PositionStoreLike,
  ) {}

  async update(snapshot: PositionSnapshot): Promise<TrailingUpdateResult> {
    const { position } = snapshot;

    if (!position.trailingEnabled || !position.stopLoss) {
      return { moved: false, newStopLoss: null };
    }

    const currentPrice = snapshot.currentPrice;
    if (!currentPrice || currentPrice <= 0) {
      return { moved: false, newStopLoss: null };
    }

    const entry = snapshot.exchangePosition?.entryPrice ?? position.entryPrice;
    if (!entry) return { moved: false, newStopLoss: null };

    const isLong = position.side === "BUY";
    const distancePct = (position.trailingDistancePct ?? 2) / 100;
    const activationPct = (position.trailingActivationPct ?? 0.5) / 100;
    const minDistancePct = distancePct;
    const stepSizePct = 0.01 / 100;

    let highest = position.highestPrice ?? entry;
    let lowest = position.lowestPrice ?? entry;

    if (isLong) highest = Math.max(highest, currentPrice);
    else lowest = Math.min(lowest, currentPrice);

    const favorableMove = isLong
      ? (currentPrice - entry) / entry
      : (entry - currentPrice) / entry;

    const activated = position.trailingActivated || favorableMove >= activationPct;

    if (!activated) {
      await this.store.updateTrailing(position.id, position.stopLoss, highest, lowest);
      return { moved: false, newStopLoss: position.stopLoss };
    }

    const rawCandidate = isLong ? highest * (1 - distancePct) : lowest * (1 + distancePct);
    const candidate = this.roundPrice(rawCandidate, isLong, currentPrice);

    const current = position.stopLoss;
    const isBetter = isLong ? candidate > current : candidate < current;
    const minDistanceOk = isLong
      ? currentPrice - candidate >= currentPrice * minDistancePct
      : candidate - currentPrice >= currentPrice * minDistancePct;

    const movedFarEnough = Math.abs(candidate - current) / current >= stepSizePct;

    if (!isBetter || !minDistanceOk || !movedFarEnough) {
      await this.store.updateTrailing(position.id, current, highest, lowest);
      return { moved: false, newStopLoss: current };
    }

    const placed = await this.replaceStopOrder(position, candidate);
    if (!placed) {
      await this.store.updateTrailing(position.id, current, highest, lowest);
      return { moved: false, newStopLoss: current };
    }

    await this.store.updateTrailing(position.id, candidate, highest, lowest);
    return { moved: true, newStopLoss: candidate };
  }

  private async replaceStopOrder(position: PositionSnapshot["position"], newStop: number): Promise<boolean> {
    try {
      if (position.stopLossOrderId) {
        await this.client.cancelOrder(position.userId, position.stopLossOrderId).catch(() => null);
      }

      const opposite = position.side === "BUY" ? "SELL" : "BUY";
      const order = await this.client.placeOrder(position.userId, {
        symbol: position.symbol,
        side: opposite,
        orderType: "STOP_MARKET",
        quantity: position.filledQuantity ?? position.quantity,
        triggerPrice: newStop,
        reduceOnly: true,
        clientOrderId: clientOrderId(`trail_${position.executionId}_${Date.now()}`),
      });

      if (order.orderId) {
        await this.store.updateProtection(position.id, order.orderId, position.takeProfitOrderId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private roundPrice(price: number, isLong: boolean, currentPrice: number): number {
    const tickSize = this.tickFor(price);
    let rounded = Math.round(price / tickSize) * tickSize;
    if (isLong) rounded = Math.min(rounded, currentPrice * 0.999999);
    else rounded = Math.max(rounded, currentPrice * 1.000001);
    return Number(rounded.toFixed(8));
  }

  private tickFor(price: number): number {
    if (price >= 10000) return 0.01;
    if (price >= 1000) return 0.001;
    if (price >= 100) return 0.0001;
    if (price >= 10) return 0.00001;
    if (price >= 1) return 0.000001;
    return 0.00000001;
  }
}
