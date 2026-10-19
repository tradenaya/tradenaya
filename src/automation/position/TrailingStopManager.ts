import type { CoinSwitchClientLike, PositionSnapshot, PositionRecord, PositionStoreLike } from "./PositionManagerTypes";
import { clientOrderId } from "@/automation/executor/order-id";
import { OrderHistoryRepository, type OrderHistoryInsert } from "@/automation/order-history";
import { validateStopLossBoundary } from "@/automation/risk/liquidation-safety";
import type { OrderRef } from "@/automation/executor/types";

/** Called after a stop was replaced, so the trade (execution) record points at the new stop too. */
export type StopReplacedHook = (position: PositionRecord, ref: OrderRef) => Promise<void>;

const TERMINAL_STATUSES = new Set(["EXECUTED", "PARTIALLY_EXECUTED", "FILLED", "ALL_DONE", "CLOSED", "CANCELLED", "CANCELLATION_RAISED", "CANCELED", "REJECTED", "EXPIRED"]);

/** Everything needed to prove a stop move happened on the exchange. */
export interface StopMove {
  from: number;
  to: number;
  /** Market price when the stop was moved. */
  price: number;
  oldOrderId: string | null;
  /** Whether the exchange accepted the cancel of the old stop order. */
  oldOrderCancelled: boolean | null;
  newOrderId: string;
  /** Status the exchange reported for the new stop when it was confirmed. */
  newOrderStatus: string;
}

export interface TrailingUpdateResult {
  moved: boolean;
  newStopLoss: number | null;
  /** Why a wanted stop move did NOT happen (exchange error, safety gate…), so it is logged instead of failing silently. */
  failure?: string;
  /** Set when the stop moved: old → new level and the exchange orders involved. */
  move?: StopMove;
  /** The level the manager tried to move to (set on failure). */
  wanted?: number;
  /** The position was left without a stop (alert immediately). */
  critical?: boolean;
}

type ReplaceResult =
  | { ok: true; oldOrderId: string | null; oldOrderCancelled: boolean | null; newOrderId: string; newOrderStatus: string }
  | { ok: false; reason: string; critical?: boolean };

/** CoinSwitch's rejection when a second stop-market order is placed for a position. */
const ONE_STOP_PER_POSITION = /stop[\s_-]*market order already exists/i;

function moveOf(placed: Extract<ReplaceResult, { ok: true }>, from: number, to: number, price: number): StopMove {
  return {
    from,
    to,
    price,
    oldOrderId: placed.oldOrderId,
    oldOrderCancelled: placed.oldOrderCancelled,
    newOrderId: placed.newOrderId,
    newOrderStatus: placed.newOrderStatus,
  };
}

export interface TargetMoveResult {
  moved: boolean;
  from: number | null;
  to: number | null;
  newOrderId?: string;
  oldOrderId?: string | null;
  failure?: string;
}

export class TrailingStopManager {
  constructor(
    private readonly client: CoinSwitchClientLike,
    private readonly store: PositionStoreLike,
    private readonly onStopReplaced?: StopReplacedHook,
    private readonly onTargetReplaced?: StopReplacedHook,
  ) {}

  /**
   * Push the take-profit further out (only ever AWAY from the price, in the
   * trade's favour). The exchange keeps one take-profit per position, so the
   * old one is cancelled first — safe, because the stop-loss keeps protecting
   * the position meanwhile. If the new one cannot be placed, the old one is put
   * back at once.
   */
  async moveTakeProfitTo(snapshot: PositionSnapshot, level: number): Promise<TargetMoveResult> {
    const { position } = snapshot;
    const current = position.takeProfit;
    const price = snapshot.currentPrice;
    if (!current || !(level > 0) || !price) return { moved: false, from: current ?? null, to: null };
    const isLong = position.side === "BUY";
    const target = Number(this.roundTarget(level, isLong, await this.pricePrecision(position)));
    if (!(isLong ? target > current && target > price : target < current && target < price)) {
      return { moved: false, from: current, to: target };
    }
    const quantity = snapshot.exchangePosition?.quantity != null && snapshot.exchangePosition.quantity > 0
      ? Math.abs(snapshot.exchangePosition.quantity)
      : position.filledQuantity ?? position.quantity;

    const oldOrderId = position.takeProfitOrderId;
    if (oldOrderId) {
      const cancelled = await this.client.cancelOrder(position.userId, oldOrderId).catch(() => false);
      if (!cancelled) {
        const still = await this.confirmActive(position, oldOrderId);
        if (still.confirmed) return { moved: false, from: current, to: target, failure: `old take-profit ${oldOrderId} could not be cancelled; kept it at ${current}` };
      }
      this.recordProtective("TAKE_PROFIT_MARKET", position, oldOrderId, "CANCELLED", current).catch(() => null);
    }

    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const placed = await this.placeTarget(position, target, quantity);
      if ("error" in placed) { lastError = placed.error; continue; }
      const check = await this.confirmActive(position, placed.orderId);
      if (!check.confirmed) { lastError = `new take-profit not confirmed (status "${check.status || "unknown"}")`; continue; }
      await this.adoptTarget(position, placed, target, quantity);
      return { moved: true, from: current, to: target, newOrderId: placed.orderId, oldOrderId };
    }
    // Put the old take-profit back.
    const restored = await this.placeTarget(position, current, quantity);
    if (!("error" in restored)) await this.adoptTarget(position, restored, current, quantity);
    return { moved: false, from: current, to: target, failure: `could not place the new take-profit at ${target} (${lastError}); ${"error" in restored ? "the take-profit is missing and will be re-placed by protection" : `kept it at ${current}`}` };
  }

  private async placeTarget(position: PositionRecord, triggerPrice: number, quantity: number | null): Promise<{ orderId: string; clientOrderId: string } | { error: string }> {
    const clientId = clientOrderId(`tp_${position.executionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    try {
      const order = await this.client.placeOrder(position.userId, {
        symbol: position.symbol,
        side: position.side === "BUY" ? "SELL" : "BUY",
        orderType: "TAKE_PROFIT_MARKET",
        quantity,
        triggerPrice,
        reduceOnly: true,
        clientOrderId: clientId,
      });
      if (!order.orderId) return { error: "take-profit placed but no order id returned" };
      return { orderId: order.orderId, clientOrderId: clientId };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async adoptTarget(position: PositionRecord, placed: { orderId: string; clientOrderId: string }, target: number, quantity: number | null): Promise<void> {
    this.recordProtective("TAKE_PROFIT_MARKET", position, placed.orderId, "OPEN", target, quantity).catch(() => null);
    await this.store.updateProtection(position.id, position.stopLossOrderId, placed.orderId);
    await this.store.updateTakeProfit?.(position.id, target);
    await this.onTargetReplaced?.(position, { orderId: placed.orderId, clientOrderId: placed.clientOrderId, status: "OPEN" }).catch(() => null);
    position.takeProfitOrderId = placed.orderId;
    position.takeProfit = target;
  }

  /** Round a take-profit to the exchange's price step, rounding AWAY from the price. */
  private roundTarget(price: number, isLong: boolean, decimals: number | null): number {
    const tick = decimals != null ? 10 ** -decimals : this.tickFor(price);
    const rounded = isLong ? Math.ceil(price / tick) * tick : Math.floor(price / tick) * tick;
    return Number(rounded.toFixed(decimals ?? 8));
  }

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
    const candidate = this.roundPrice(rawCandidate, isLong, currentPrice, await this.pricePrecision(position));

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
    const blocked = this.liquidationBlock(snapshot, candidate, entry);
    if (blocked) {
      await this.store.updateTrailing(position.id, current, highest, lowest);
      return { moved: false, newStopLoss: current, failure: blocked, wanted: candidate };
    }

    const placed = await this.replaceStopOrder(position, candidate, snapshot.exchangePosition?.quantity ?? null);
    if (!placed.ok) {
      await this.store.updateTrailing(position.id, current, highest, lowest);
      return { moved: false, newStopLoss: current, failure: placed.reason, wanted: candidate, critical: placed.critical };
    }

    await this.store.updateTrailing(position.id, candidate, highest, lowest);
    return { moved: true, newStopLoss: candidate, move: moveOf(placed, current, candidate, currentPrice) };
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
    const candidate = this.roundPrice(level, isLong, price, await this.pricePrecision(position));
    const tighter = isLong ? candidate > current : candidate < current;
    const protective = isLong ? candidate < price : candidate > price;
    const movedFarEnough = Math.abs(candidate - current) / current >= 0.0001;
    if (!tighter || !protective || !movedFarEnough) return { moved: false, newStopLoss: current };

    const blocked = this.liquidationBlock(snapshot, candidate, snapshot.exchangePosition?.entryPrice ?? position.entryPrice);
    if (blocked) return { moved: false, newStopLoss: current, failure: blocked, wanted: candidate };

    const placed = await this.replaceStopOrder(position, candidate, snapshot.exchangePosition?.quantity ?? null);
    if (!placed.ok) return { moved: false, newStopLoss: current, failure: placed.reason, wanted: candidate, critical: placed.critical };
    await this.store.updateTrailing(position.id, candidate, position.highestPrice ?? price, position.lowestPrice ?? price);
    return { moved: true, newStopLoss: candidate, move: moveOf(placed, current, candidate, price) };
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
  /**
   * Liquidation-safety check for a TIGHTER stop. Returns a reason when the move
   * must be blocked, null when it may go ahead.
   *
   * Callers only ever tighten the stop (move it toward the price), which moves
   * it AWAY from liquidation, so a missing exchange liquidation price must not
   * block the move. Previously it did, silently.
   */
  private liquidationBlock(snapshot: PositionSnapshot, candidate: number, entry: number | null): string | null {
    const liquidationPrice = snapshot.exchangePosition?.liquidationPrice ?? null;
    if (!(liquidationPrice != null && liquidationPrice > 0)) return null;
    const gate = validateStopLossBoundary({ side: snapshot.position.side, stopLoss: candidate, liquidationPrice, entryPrice: entry });
    return gate.determinable && !gate.ok ? `liquidation safety: ${gate.reason}` : null;
  }

  private async replaceStopOrder(position: PositionRecord, newStop: number, exchangeQuantity: number | null = null): Promise<ReplaceResult> {
    // Size the new stop to what is REALLY open on the exchange, so no part of
    // the position is left without a stop if the local record is behind.
    const quantity = exchangeQuantity != null && exchangeQuantity > 0 ? Math.abs(exchangeQuantity) : position.filledQuantity ?? position.quantity;

    // Preferred: place the new stop FIRST, then cancel the old one — the
    // position is never without a stop.
    const placed = await this.placeStop(position, newStop, quantity);
    if ("error" in placed) {
      // CoinSwitch allows only ONE stop-market order per position ("Stop market
      // order already exists for this position"), so place-first can never work
      // there; replace it the only way the exchange allows.
      if (ONE_STOP_PER_POSITION.test(placed.error) && position.stopLossOrderId) {
        return this.replaceCancelFirst(position, newStop, quantity);
      }
      return { ok: false, reason: `exchange rejected the new stop at ${newStop}: ${placed.error}` };
    }

    const check = await this.confirmActive(position, placed.orderId);
    if (!check.confirmed) {
      // The replacement could not be confirmed as active (transient API issue
      // or it filled instantly). Cancel the just-created replacement and keep
      // the existing SL so the position is never left with a phantom/unverified
      // protection and is never left unprotected.
      await this.client.cancelOrder(position.userId, placed.orderId).catch(() => null);
      return { ok: false, reason: `new stop ${placed.orderId} at ${newStop} could not be confirmed active (status "${check.status || "unknown"}"); kept the old stop` };
    }

    // Only now is it safe to remove the obsolete SL.
    const oldOrderId = position.stopLossOrderId;
    let oldOrderCancelled: boolean | null = null;
    if (oldOrderId) {
      oldOrderCancelled = Boolean(await this.client.cancelOrder(position.userId, oldOrderId).catch(() => false));
      this.recordProtective("STOP_MARKET", position, oldOrderId, "CANCELLED", position.stopLoss).catch(() => null);
    }
    await this.adoptStop(position, placed, newStop, quantity);
    return { ok: true, oldOrderId, oldOrderCancelled, newOrderId: placed.orderId, newOrderStatus: check.status || "OPEN" };
  }

  /**
   * Replacement for exchanges that allow only one stop per position: cancel the
   * old stop, confirm it is gone, then place the new one straight away (retried).
   * If the new stop still cannot be placed, the OLD stop is put back at once;
   * if even that fails the result is flagged critical so the monitor alerts and
   * its protection check re-protects the position on the next cycle.
   */
  private async replaceCancelFirst(position: PositionRecord, newStop: number, quantity: number | null): Promise<ReplaceResult> {
    const oldOrderId = position.stopLossOrderId as string;
    const oldStop = position.stopLoss;

    const cancelled = await this.client.cancelOrder(position.userId, oldOrderId).catch(() => false);
    if (!cancelled) {
      const still = await this.confirmActive(position, oldOrderId);
      if (still.confirmed || still.status === "") {
        return { ok: false, reason: `exchange allows one stop per position and the old stop ${oldOrderId} could not be cancelled; kept it at ${oldStop}` };
      }
    }
    this.recordProtective("STOP_MARKET", position, oldOrderId, "CANCELLED", oldStop).catch(() => null);

    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const placed = await this.placeStop(position, newStop, quantity);
      if ("error" in placed) {
        lastError = placed.error;
        continue;
      }
      const check = await this.confirmActive(position, placed.orderId);
      if (check.confirmed) {
        await this.adoptStop(position, placed, newStop, quantity);
        return { ok: true, oldOrderId, oldOrderCancelled: true, newOrderId: placed.orderId, newOrderStatus: check.status || "OPEN" };
      }
      lastError = `new stop ${placed.orderId} not confirmed (status "${check.status || "unknown"}")`;
    }

    // The new stop failed — put the old one back immediately.
    if (oldStop != null) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const restored = await this.placeStop(position, oldStop, quantity);
        if (!("error" in restored)) {
          await this.adoptStop(position, restored, oldStop, quantity);
          return { ok: false, reason: `could not place the new stop at ${newStop} (${lastError}); restored the stop at ${oldStop}` };
        }
      }
    }
    await this.store.updateProtection(position.id, null, position.takeProfitOrderId);
    position.stopLossOrderId = null;
    return {
      ok: false,
      critical: true,
      reason: `POSITION HAS NO STOP-LOSS: the old stop was cancelled but neither the new stop at ${newStop} nor the old one at ${oldStop} could be placed (${lastError}) — emergency protection will re-place it`,
    };
  }

  private async placeStop(position: PositionRecord, triggerPrice: number, quantity: number | null): Promise<{ orderId: string; clientOrderId: string } | { error: string }> {
    const clientId = clientOrderId(`trail_${position.executionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    try {
      const order = await this.client.placeOrder(position.userId, {
        symbol: position.symbol,
        side: position.side === "BUY" ? "SELL" : "BUY",
        orderType: "STOP_MARKET",
        quantity,
        triggerPrice,
        reduceOnly: true,
        clientOrderId: clientId,
      });
      if (!order.orderId) return { error: "stop placed but no order id returned" };
      return { orderId: order.orderId, clientOrderId: clientId };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Confirm an order is live: by its status, or (when unreadable) by the open-orders list. */
  private async confirmActive(position: PositionRecord, orderId: string): Promise<{ confirmed: boolean; status: string }> {
    let status = "";
    try {
      status = String((await this.client.getOrderStatus(position.userId, orderId))?.status ?? "").toUpperCase();
      if (status !== "" && !TERMINAL_STATUSES.has(status)) return { confirmed: true, status };
    } catch {
      status = "";
    }
    if (TERMINAL_STATUSES.has(status)) return { confirmed: false, status };
    const open = await this.client.getOpenOrders(position.userId, position.symbol).catch(() => null);
    return { confirmed: Boolean(open?.some((o) => o.orderId === orderId)), status };
  }

  /** Make a confirmed stop the position's stop everywhere (DB position + execution record + history). */
  private async adoptStop(position: PositionRecord, placed: { orderId: string; clientOrderId: string }, stop: number, quantity: number | null): Promise<void> {
    this.recordProtective("STOP_MARKET", position, placed.orderId, "OPEN", stop, quantity).catch(() => null);
    await this.store.updateProtection(position.id, placed.orderId, position.takeProfitOrderId);
    // Keep the execution record in step. Without this the monitor's snapshot
    // sync copied the ORIGINAL stop id back onto the position, so the next
    // trail cancelled the wrong order and left duplicate stops resting.
    await this.onStopReplaced?.(position, { orderId: placed.orderId, clientOrderId: placed.clientOrderId, status: "OPEN" }).catch(() => null);
    position.stopLossOrderId = placed.orderId;
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

  private readonly precisionCache = new Map<string, { at: number; decimals: number | null }>();

  /** The exchange's price precision (decimals) for the symbol, cached for a day; null when unknown. */
  private async pricePrecision(position: PositionRecord): Promise<number | null> {
    const key = position.symbol.toUpperCase();
    const hit = this.precisionCache.get(key);
    if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.decimals;
    let decimals: number | null = null;
    try {
      const info = await this.client.getInstrumentInfo?.(position.userId, position.symbol);
      const p = Number(info?.price_precision);
      decimals = Number.isInteger(p) && p >= 0 && p <= 12 ? p : null;
    } catch {
      decimals = null;
    }
    this.precisionCache.set(key, { at: Date.now(), decimals });
    return decimals;
  }

  /**
   * Round a stop to a price the exchange accepts (its own price precision when
   * known, else a magnitude-based tick), staying strictly on the protective
   * side of the live price: below it for a long, above it for a short.
   */
  private roundPrice(price: number, isLong: boolean, currentPrice: number, decimals: number | null = null): number {
    const tickSize = decimals != null ? 10 ** -decimals : this.tickFor(price);
    let rounded = Math.round(price / tickSize) * tickSize;
    if (isLong && rounded >= currentPrice) rounded = Math.floor((currentPrice * 0.999999) / tickSize) * tickSize;
    if (!isLong && rounded <= currentPrice) rounded = Math.ceil((currentPrice * 1.000001) / tickSize) * tickSize;
    return Number(rounded.toFixed(decimals ?? 8));
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