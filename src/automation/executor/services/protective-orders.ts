import type { CoinSwitchClient } from "../client";
import type { ExecutionStore } from "../store";
import type { ExecutionRecord, OrderRef, ProtectiveStatus } from "../types";
import { OrderHistoryRepository, type OrderHistoryInsert } from "@/automation/order-history";
import type { PositionStore } from "@/automation/position/PositionStore";
import { positionStore as defaultPositionStore } from "@/automation/position/PositionStore";

export interface ProtectiveOrderResult {
  slPlaced: boolean;
  tpPlaced: boolean;
  status: ProtectiveStatus;
}

export class ProtectiveOrdersService {
  constructor(
    private readonly client: CoinSwitchClient,
    private readonly store: ExecutionStore,
    private readonly positions: PositionStore = defaultPositionStore,
  ) {}

  private readonly history = new OrderHistoryRepository();

  async placeProtection(execution: ExecutionRecord, filledQuantity: number | null): Promise<ProtectiveOrderResult> {
    // Open orders currently live on the exchange for this symbol. Used to make
    // placement idempotent: if a protective order is already resting on the
    // exchange we do NOT place a duplicate; if the stored ref is stale (no
    // longer open) we place a fresh one.
    const openOrderIds = new Set<string>();
    let openOrdersReadFailed = false;
    try {
      const open = await this.client.getOpenOrders(execution.userId, execution.symbol);
      for (const o of open) if (o.orderId) openOrderIds.add(o.orderId);
    } catch {
      openOrdersReadFailed = true;
    }
    // Only when the read genuinely FAILED do we fall back to the execution-ref
    // guard (skip when the ref is present). A successful-but-empty read means
    // protection is truly missing and must be re-placed.
    const slPlaced = await this.placeStopLoss(execution, openOrderIds, openOrdersReadFailed);
    const tpPlaced = await this.placeTakeProfit(execution, filledQuantity, openOrderIds, openOrdersReadFailed);

    const status: ProtectiveStatus = slPlaced && tpPlaced ? "PLACED" : slPlaced ? "SL_ONLY" : tpPlaced ? "TP_ONLY" : "FAILED";

    await this.store.updateProtectiveStatus(execution.id, status);

    if (status === "FAILED") {
      await this.store.updateState(execution.id, "UNPROTECTED", "Failed to place stop loss and take profit");
    }

    return { slPlaced, tpPlaced, status };
  }

  private async placeStopLoss(
    execution: ExecutionRecord,
    openOrderIds: Set<string>,
    openOrdersReadFailed: boolean,
  ): Promise<boolean> {
    if (!execution.stopLoss) return false;

    // Idempotency: skip only when an SL order is ALREADY resting on the
    // exchange. A stored ref that is no longer open (cancelled externally /
    // replaced by trailing) must be re-placed, otherwise the position would be
    // left unprotected.
    if (execution.stopLossOrder.orderId && (openOrdersReadFailed || openOrderIds.has(execution.stopLossOrder.orderId))) {
      return true;
    }

    const orderRef = await this.tryPlace(execution.userId, {
      symbol: execution.symbol,
      side: execution.side === "BUY" ? "SELL" : "BUY",
      orderType: "STOP_MARKET",
      quantity: execution.filledQuantity ?? execution.quantity ?? 0,
      triggerPrice: execution.stopLoss,
      reduceOnly: true,
    });

    if (orderRef) {
      await this.store.updateProtectiveRef(execution.id, "sl", orderRef);
      await this.syncPositionRefs(execution.id);
      this.recordProtective(execution, "STOP_MARKET", orderRef, "OPEN").catch(() => null);
      return true;
    }
    return false;
  }

  private async placeTakeProfit(
    execution: ExecutionRecord,
    filledQuantity: number | null,
    openOrderIds: Set<string>,
    openOrdersReadFailed: boolean,
  ): Promise<boolean> {
    if (!execution.takeProfit) return false;

    if (execution.takeProfitOrder.orderId && (openOrdersReadFailed || openOrderIds.has(execution.takeProfitOrder.orderId))) {
      return true;
    }

    const orderRef = await this.tryPlace(execution.userId, {
      symbol: execution.symbol,
      side: execution.side === "BUY" ? "SELL" : "BUY",
      orderType: "TAKE_PROFIT_MARKET",
      quantity: filledQuantity ?? execution.filledQuantity ?? execution.quantity ?? 0,
      triggerPrice: execution.takeProfit,
      reduceOnly: true,
    });

    if (orderRef) {
      await this.store.updateProtectiveRef(execution.id, "tp", orderRef);
      await this.syncPositionRefs(execution.id);
      this.recordProtective(execution, "TAKE_PROFIT_MARKET", orderRef, "OPEN").catch(() => null);
      return true;
    }
    return false;
  }

  /**
   * Keep the position row's SL/TP order refs in sync with the execution at the
   * moment of placement. This is the authoritative source of truth for close
   * confirmation; without it a position created before protection was placed
   * would keep NULL order ids forever, leaving close-confirmation unable to
   * verify a filled TP/SL (position stuck as PROTECTED). Best effort — never
   * allowed to fail protective placement.
   */
  private async syncPositionRefs(executionId: number): Promise<void> {
    try {
      const position = await this.positions.getPositionByExecutionId(executionId);
      if (!position) return;
      await this.positions.updateProtection(
        position.id,
        position.stopLossOrderId,
        position.takeProfitOrderId,
      );
    } catch {
      // best-effort: position sync must never break protective placement
    }
  }

  /** Best-effort persistence of protective orders so history survives sub-account unavailability. */
  private async recordProtective(
    execution: ExecutionRecord,
    orderType: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
    ref: OrderRef,
    status: string,
  ): Promise<void> {
    try {
      const row: OrderHistoryInsert = {
        userId: execution.userId,
        userEmail: null,
        userCode: null,
        symbol: execution.symbol,
        side: execution.side === "BUY" ? "SELL" : "BUY",
        orderType,
        orderContext: orderType === "STOP_MARKET" ? "stop_loss" : "take_profit",
        quantity: execution.filledQuantity ?? execution.quantity ?? null,
        price: null,
        triggerPrice: orderType === "STOP_MARKET" ? execution.stopLoss : execution.takeProfit,
        reduceOnly: true,
        status,
        exchangeOrderId: ref.orderId,
        clientOrderId: ref.clientOrderId,
        responseStatus: status,
        message: orderType === "STOP_MARKET" ? "stop_loss" : "take_profit",
        amountUsed: null,
        avgExecutionPrice: null,
        executionFee: null,
        pnl: null,
        realizedPnl: null,
        isProfit: null,
        rawResponse: null,
      };
      await this.history.saveOrder(row);
    } catch {
      // best-effort: history must never break protective placement
    }
  }

  private async tryPlace(userId: number, params: Parameters<CoinSwitchClient["placeOrder"]>[1]): Promise<OrderRef | null> {
    try {
      const ref = await this.client.placeOrder(userId, params);
      if (!ref.orderId) return null;
      return ref;
    } catch (error) {
      console.error("ProtectiveOrders: placeOrder failed — order may be live on exchange without DB record", {
        symbol: params.symbol,
        side: params.side,
        triggerPrice: params.triggerPrice,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
