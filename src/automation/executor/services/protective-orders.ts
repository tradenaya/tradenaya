import type { CoinSwitchClient } from "../client";
import type { ExecutionStore } from "../store";
import type { ExecutionRecord, OrderRef, ProtectiveStatus } from "../types";

export interface ProtectiveOrderResult {
  slPlaced: boolean;
  tpPlaced: boolean;
  status: ProtectiveStatus;
}

export class ProtectiveOrdersService {
  constructor(
    private readonly client: CoinSwitchClient,
    private readonly store: ExecutionStore,
  ) {}

  async placeProtection(execution: ExecutionRecord, filledQuantity: number | null): Promise<ProtectiveOrderResult> {
    const slPlaced = await this.placeStopLoss(execution);
    const tpPlaced = await this.placeTakeProfit(execution, filledQuantity);

    const status: ProtectiveStatus = slPlaced && tpPlaced ? "PLACED" : slPlaced ? "SL_ONLY" : tpPlaced ? "TP_ONLY" : "FAILED";

    await this.store.updateProtectiveStatus(execution.id, status);

    if (status === "FAILED") {
      await this.store.updateState(execution.id, "UNPROTECTED", "Failed to place stop loss and take profit");
    }

    return { slPlaced, tpPlaced, status };
  }

  private async placeStopLoss(execution: ExecutionRecord): Promise<boolean> {
    if (!execution.stopLoss) return false;

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
      return true;
    }
    return false;
  }

  private async placeTakeProfit(execution: ExecutionRecord, filledQuantity: number | null): Promise<boolean> {
    if (!execution.takeProfit) return false;

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
      return true;
    }
    return false;
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
