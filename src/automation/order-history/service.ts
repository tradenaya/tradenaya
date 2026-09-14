import { OrderHistoryRepository } from "./repository";
import type { ClosedOrderRecord } from "@/automation/executor/client";
import { coinswitchClient } from "@/automation/executor/client";
import { getKeysForUser } from "@/lib/coinswitch.store";
import type { OrderHistoryInsert, OrderHistoryQuery, OrderHistoryRow, Paged } from "./types";

const CLOSED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EXECUTED_STATUSES = new Set([
  "EXECUTED",
  "PARTIALLY_EXECUTED",
  "FILLED",
  "ALL_DONE",
  "FILLED_CLOSED",
  "CLOSED",
]);

export class OrderHistoryService {
  constructor(private readonly repo: OrderHistoryRepository = new OrderHistoryRepository()) {}

  async getOrders(userId: number, query: OrderHistoryQuery): Promise<Paged<OrderHistoryRow>> {
    return this.repo.getOrders(userId, {
      page: Math.max(1, query.page || 1),
      pageSize: Math.min(Math.max(query.pageSize || 25, 1), 100),
      search: query.search ?? "",
    });
  }

  /**
   * Pull the CoinSwitch USDT sub-account's closed (terminal) orders into the
   * app's order history. The sub-account only exists while a USDT futures
   * position is open, so its trade history disappears from the UI — this sync
   * re-mirrors it locally. Existing orders are skipped (dedup by
   * exchange_order_id), so it's safe to run repeatedly.
   *
   * Pages back in 7-day windows (the API's max window) up to `days` ago.
   */
  async syncClosedOrdersFromExchange(
    userId: number,
    opts: { days?: number } = {},
  ): Promise<{ synced: number; total: number }> {
    const keys = await getKeysForUser(userId);
    if (!keys || keys.status !== "A") {
      throw new Error("CoinSwitch is not connected. Please connect your API keys first.");
    }

    const days = Math.min(Math.max(opts.days ?? 28, 1), 90);
    const floor = Date.now() - days * 24 * 60 * 60 * 1000;

    const pending: OrderHistoryInsert[] = [];
    let windowEnd = Date.now();

    while (windowEnd > floor) {
      const from = Math.max(floor, windowEnd - CLOSED_WINDOW_MS);
      let to = windowEnd;
      let guard = 0;

      while (guard < 60) {
        const { orders, cursor } = await coinswitchClient.getClosedOrders(userId, {
          fromTime: from,
          toTime: to,
          limit: 50,
        });
        for (const order of orders) {
          pending.push(this.toInsert(userId, order));
        }
        guard++;
        if (!orders.length || cursor == null || cursor >= to) break;
        to = cursor;
      }

      windowEnd = from;
    }

    const existing = await this.repo.findExistingExchangeOrderIds(
      userId,
      pending.map((o) => o.exchangeOrderId ?? ""),
    );
    const inserts = pending.filter((o) => o.exchangeOrderId && !existing.has(o.exchangeOrderId));

    for (const insert of inserts) {
      await this.repo.saveOrder(insert);
    }

    return { synced: inserts.length, total: pending.length };
  }

  private toInsert(userId: number, order: ClosedOrderRecord): OrderHistoryInsert {
    const status = order.status?.toUpperCase() ?? "UNKNOWN";
    const executed = EXECUTED_STATUSES.has(status);
    const realizedPnl = executed ? order.realizedPnl : null;

    const type = String(order.orderType ?? "").toUpperCase();
    let context: OrderHistoryInsert["orderContext"];
    if (order.reduceOnly) {
      context = type.includes("STOP")
        ? "stop_loss"
        : type.includes("TAKE_PROFIT")
          ? "take_profit"
          : "close_position";
    } else {
      context = "entry";
    }

    const qty = order.execQuantity > 0 ? order.execQuantity : order.quantity;
    const execPrice = order.avgExecutionPrice ?? order.price ?? null;
    const amountUsed = execPrice && qty ? execPrice * qty : null;

    return {
      userId,
      userEmail: null,
      userCode: `CUS-${userId}`,
      exchange: "EXCHANGE_2",
      symbol: order.symbol.toUpperCase(),
      side: order.side.toUpperCase() === "SELL" ? "SELL" : "BUY",
      orderType: order.orderType || "MARKET",
      orderContext: context,
      quantity: qty || null,
      price: order.price,
      triggerPrice: order.triggerPrice,
      reduceOnly: order.reduceOnly,
      status: order.status || "PENDING",
      exchangeOrderId: order.orderId,
      clientOrderId: order.clientOrderId,
      responseStatus: null,
      message: null,
      amountUsed: amountUsed && Number.isFinite(amountUsed) && amountUsed > 0 ? amountUsed : null,
      avgExecutionPrice: order.avgExecutionPrice,
      executionFee: order.executionFee,
      pnl: realizedPnl,
      realizedPnl,
      isProfit: realizedPnl == null ? null : realizedPnl > 0,
      rawResponse: null,
    };
  }
}

export const orderHistoryService = new OrderHistoryService();