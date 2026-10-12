import type { CoinSwitchClientLike, PositionSnapshot, PositionRecord, PositionStoreLike } from "./PositionManagerTypes";
import { clientOrderId } from "@/automation/executor/order-id";
import { OrderHistoryRepository, type OrderHistoryInsert } from "@/automation/order-history";
import { validateStopLossBoundary } from "@/automation/risk/liquidation-safety";
import type { OrderRef } from "@/automation/executor/types";

/** Called after a stop was replaced, so the trade (execution) record points at the new stop too. */
export type StopReplacedHook = (position: PositionRecord, ref: OrderRef) => Promise<void>;

const TERMINAL_STATUSES = new Set(["EXECUTED", "PARTIALLY_EXECUTED", "FILLED", "ALL_DONE", "CLOSED", "CANCELLED", "CANCELLATION_RAISED", "CANCELED", "REJECTED", "EXPIRED"]);

export interface TrailingUpdateResult {
  moved: boolean;
  newStopLoss: number | null;
}

export class TrailingStopManager {
  constructor(
    private readonly client: CoinSwitchClientLike,
    private readonly store: PositionStoreLike,
    private readonly onStopReplaced?: StopReplacedHook,
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

    // ── Mandatory liquidation-safety gate ───────────────────────────────
    // A trailing SL must stay safely on the favorable side of the exchange's
    // authoritative liquidation price: for a LONG the stop sits ABOVE it, for
    // a SHORT BELOW it. When the exchange liquidation price is temporarily
    // unavailable the boundary is indeterminate and the replacement is SKIPPED
    // (the incumbent stop is kept) so the position is never left unprotected
    // and never moves into a stop that could not fill before liquidation.
    const gate = validateStopLossBoundary({
      side: position.side,
      stopLoss: candidate,
      liquidationPrice: snapshot.exchangePosition?.liquidationPrice ?? null,
      entryPrice: entry,
    });
    if (!gate.determinable || !gate.ok) {
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

  /**
   * Move the stop to an explicit level (e.g. a candle-channel trail). Only ever
   * tightens it, keeps it on the protective side of the live price, and goes
   * through the same liquidation gate + place-then-cancel replacement as
   * update().
   */
  async moveStopTo(snapshot: PositionSnapshot, level: number): Promise<TrailingUpdateResult> {
    const { position } = snapshot;
    const current = position.stopLoss;
    const price = snapshot.currentPrice;
    if (!current || !(level > 0) || !price || price <= 0) return { moved: false, newStopLoss: current ?? null };

    const isLong = position.side === "BUY";
    const candidate = this.roundPrice(level, isLong, price);
    const tighter = isLong ? candidate > current : candidate < current;
    const protective = isLong ? candidate < price : candidate > price;
    const movedFarEnough = Math.abs(candidate - current) / current >= 0.0001;
    if (!tighter || !protective || !movedFarEnough) return { moved: false, newStopLoss: current };

    const gate = validateStopLossBoundary({
      side: position.side,
      stopLoss: candidate,
      liquidationPrice: snapshot.exchangePosition?.liquidationPrice ?? null,
      entryPrice: snapshot.exchangePosition?.entryPrice ?? position.entryPrice,
    });
    if (!gate.determinable || !gate.ok) return { moved: false, newStopLoss: current };

    const placed = await this.replaceStopOrder(position, candidate);
    if (!placed) return { moved: false, newStopLoss: current };
    await this.store.updateTrailing(position.id, candidate, position.highestPrice ?? price, position.lowestPrice ?? price);
    return { moved: true, newStopLoss: candidate };
  }

  /**
   * Move the trailing stop safely.
   *
   * The previous implementation CANCELLED the existing SL and then placed the
   * new one. If the process died between the two calls the position was left
   * with NO stop loss while the DB still referenced the (now cancelled) order.
   *
   * This now:
   *   1. Places the replacement SL first.
   *   2. Confirms the replacement is active on the exchange.
   *   3. Only THEN cancels the obsolete SL.
   *   4. If the replacement cannot be created/confirmed, the existing SL is
   *      kept untouched so the position is never left unprotected.
   */
  private async replaceStopOrder(position: PositionRecord, newStop: number): Promise<boolean> {
    const opposite = position.side === "BUY" ? "SELL" : "BUY";

    let newOrderId: string | null = null;
    const newClientOrderId = clientOrderId(`trail_${position.executionId}_${Date.now()}`);
    try {
      const order = await this.client.placeOrder(position.userId, {
        symbol: position.symbol,
        side: opposite,
        orderType: "STOP_MARKET",
        quantity: position.filledQuantity ?? position.quantity,
        triggerPrice: newStop,
        reduceOnly: true,
        clientOrderId: newClientOrderId,
      });
      newOrderId = order.orderId ?? null;
      if (!newOrderId) throw new Error("replacement SL placed but no order id returned");
    } catch (error) {
      void error;
      return false;
    }

    let confirmed = false;
    try {
      const status = String((await this.client.getOrderStatus(position.userId, newOrderId))?.status ?? "");
      confirmed = status !== "" && !TERMINAL_STATUSES.has(status);
    } catch {
      confirmed = false;
    }

    if (!confirmed) {
      // The replacement could not be confirmed as active (transient API issue
      // or it filled instantly). Cancel the just-created replacement and keep
      // the existing SL so the position is never left with a phantom/unverified
      // protection and is never left unprotected.
      await this.client.cancelOrder(position.userId, newOrderId).catch(() => null);
      return false;
    }

    // Only now is it safe to remove the obsolete SL.
    if (position.stopLossOrderId) {
      await this.client.cancelOrder(position.userId, position.stopLossOrderId).catch(() => null);
      this.recordProtective("STOP_MARKET", position, position.stopLossOrderId, "CANCELLED", position.stopLoss).catch(() => null);
    }

    this.recordProtective("STOP_MARKET", position, newOrderId, "OPEN", newStop, position.filledQuantity ?? position.quantity).catch(() => null);
    await this.store.updateProtection(position.id, newOrderId, position.takeProfitOrderId);
    // Keep the execution record in step. Without this the monitor's snapshot
    // sync copied the ORIGINAL stop id back onto the position, so the next
    // trail cancelled the wrong order and left duplicate stops resting.
    await this.onStopReplaced?.(position, { orderId: newOrderId, clientOrderId: newClientOrderId, status: "OPEN" }).catch(() => null);
    position.stopLossOrderId = newOrderId;
    return true;
  }

  /** Best-effort persistence of protective SL orders so history survives sub-account unavailability. */
  private async recordProtective(
    orderType: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
    position: PositionRecord,
    exchangeOrderId: string,
    status: string,
    triggerPrice: number | null,
    quantity?: number | null,
  ): Promise<void> {
    try {
      const context = orderType === "STOP_MARKET" ? "stop_loss" : "take_profit";
      const row: OrderHistoryInsert = {
        userId: position.userId,
        userEmail: null,
        userCode: null,
        symbol: position.symbol,
        side: position.side === "BUY" ? "SELL" : "BUY",
        orderType,
        orderContext: context,
        quantity: quantity ?? position.filledQuantity ?? position.quantity ?? null,
        price: null,
        triggerPrice,
        reduceOnly: true,
        status,
        exchangeOrderId,
        clientOrderId: null,
        responseStatus: status,
        message: context,
        amountUsed: null,
        avgExecutionPrice: null,
        executionFee: null,
        pnl: null,
        realizedPnl: null,
        isProfit: null,
        rawResponse: null,
      };
      await new OrderHistoryRepository().saveOrder(row);
    } catch {
      // best-effort: history must never break trailing-stop management
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