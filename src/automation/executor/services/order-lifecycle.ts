import type { CoinSwitchClient } from "../client";
import type { ExecutionStore } from "../store";
import type { BotStateService } from "../types";
import type { TradePlan } from "@/automation/planner/types";
import { clientOrderId as buildClientOrderId } from "../order-id";
import { OrderHistoryRepository, type OrderHistoryInsert } from "@/automation/order-history";

function num(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strRaw(raw: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = raw?.[key];
  return v == null ? null : String(v);
}

export interface OrderLifecycleOptions {
  statusPollIntervalMs?: number;
  statusPollAttempts?: number;
}

export class OrderLifecycleService {
  constructor(
    private readonly client: CoinSwitchClient,
    private readonly store: ExecutionStore,
    private readonly botState: BotStateService,
    private readonly options: OrderLifecycleOptions = {},
  ) {}

  private readonly history = new OrderHistoryRepository();

  private async recordOrder(input: OrderHistoryInsert) {
    try {
      await this.history.saveOrder(input);
    } catch {
      // best-effort: order-history persistence must never break live trading
    }
  }

  private buildOrderRow(
    userId: number,
    exchangeOrderId: string,
    status: { status: string | null; clientOrderId: string | null; raw: Record<string, unknown> | null },
    overrides: Partial<OrderHistoryInsert>,
  ): OrderHistoryInsert {
    const raw = status?.raw ?? null;
    return {
      userId,
      userEmail: null,
      userCode: null,
      symbol: (strRaw(raw, "symbol") ?? "").toUpperCase(),
      side: (strRaw(raw, "side") ?? "BUY").toUpperCase() as "BUY" | "SELL",
      orderType: (strRaw(raw, "order_type") ?? "MARKET").toUpperCase(),
      orderContext: "entry",
      quantity: num(strRaw(raw, "quantity")),
      price: num(strRaw(raw, "price") ?? strRaw(raw, "trigger_price")) ?? null,
      triggerPrice: num(strRaw(raw, "trigger_price")) ?? null,
      reduceOnly: Boolean(raw ? raw["reduce_only"] : false),
      status: status.status ?? overrides.status ?? "PENDING",
      exchangeOrderId,
      clientOrderId: status.clientOrderId,
      responseStatus: status.status ?? null,
      message: null,
      amountUsed: null,
      avgExecutionPrice: null,
      executionFee: null,
      pnl: null,
      realizedPnl: null,
      isProfit: null,
      rawResponse: null,
      ...overrides,
    };
  }

  async submitEntry(executionId: number, userId: number, botId: number, plan: TradePlan, quantity: number) {
    const side = (plan.side ?? plan.action) as "BUY" | "SELL";
    const symbol = plan.symbol ?? "";
    const clientOrderId = buildClientOrderId(`exec_${executionId}`);

    const ref = await this.client.placeOrder(userId, {
      symbol,
      side,
      orderType: plan.entryType === "LIMIT" && plan.limitPrice ? "LIMIT" : "MARKET",
      quantity,
      price: plan.entryType === "LIMIT" && plan.limitPrice ? plan.limitPrice : undefined,
      clientOrderId,
    });

    await this.store.updateEntryRef(executionId, ref);

    if (!ref.orderId) {
      await this.store.updateState(executionId, "FAILED", "Entry order placed but no exchange order id returned");
      throw new Error("Entry order placed but no exchange order id returned");
    }

    await this.store.updateState(executionId, "MONITORING_ENTRY");
    return ref.orderId;
  }

  async pollEntryUntilFilled(executionId: number, userId: number, orderId: string): Promise<{ filled: boolean; filledQuantity: number | null }> {
    const interval = this.options.statusPollIntervalMs ?? 2000;
    const attempts = this.options.statusPollAttempts ?? 30;

    for (let i = 0; i < attempts; i++) {
      await this.sleep(interval);
      let status: Awaited<ReturnType<typeof this.client.getOrderStatus>>;
      try {
        status = await this.client.getOrderStatus(userId, orderId);
      } catch {
        // Transient failure (e.g. rate limit) — keep polling until the timeout;
        // never fail an already-placed order because one status read was throttled.
        continue;
      }

      // CoinSwitch futures terminal statuses are EXECUTED / PARTIALLY_EXECUTED.
      if (status.status === "EXECUTED" || status.status === "PARTIALLY_EXECUTED") {
        const filledQuantity = this.extractFilledQuantity(status.raw);
        if (filledQuantity != null) {
          await this.store.updateFilledQuantity(executionId, filledQuantity);
        }
        await this.store.updateState(executionId, status.status === "EXECUTED" ? "ENTRY_FILLED" : "PARTIALLY_FILLED");

        const qty = num(filledQuantity);
        const avg = num(strRaw(status.raw, "avg_execution_price") ?? strRaw(status.raw, "average_price") ?? strRaw(status.raw, "price"));
        void this.recordOrder(
          this.buildOrderRow(userId, orderId, status, {
            quantity: qty,
            price: avg ?? null,
            avgExecutionPrice: avg ?? null,
            amountUsed: qty && avg ? qty * avg : null,
            status: "FILLED",
          }),
        );

        return { filled: true, filledQuantity };
      }

      if (status.status === "CANCELLED" || status.status === "CANCELLATION_RAISED" || status.status === "REJECTED" || status.status === "EXPIRED") {
        await this.store.updateState(executionId, "CANCELLED", `Entry order ${status.status}`);
        void this.recordOrder(
          this.buildOrderRow(userId, orderId, status, {
            status: status.status === "CANCELLED" ? "CANCELLED" : status.status,
          }),
        );
        return { filled: false, filledQuantity: null };
      }
    }

    await this.store.updateState(executionId, "CANCELLED", "Entry order timed out waiting for fill");
    await this.cancelEntry(userId, executionId, orderId);
    return { filled: false, filledQuantity: null };
  }

  async cancelEntry(userId: number, executionId: number, orderId: string) {
    let orderStatus: { status: string | null; clientOrderId: string | null; raw: Record<string, unknown> | null } | null = null;
    try {
      orderStatus = await this.client.getOrderStatus(userId, orderId);
    } catch {
      // if we can't fetch status, still attempt cancel below
    }
    try {
      await this.client.cancelOrder(userId, orderId);
    } catch {
      // order may already be filled or cancelled
    }
    await this.store.updateState(executionId, "CANCELLED", "Entry order cancelled");

    if (orderStatus) {
      void this.recordOrder(this.buildOrderRow(userId, orderId, orderStatus, { status: "CANCELLED" }));
    }
  }

  private extractFilledQuantity(raw: Record<string, unknown> | null | undefined): number | null {
    const q = raw?.exec_quantity ?? raw?.filled_quantity ?? raw?.executed_quantity;
    if (q == null) return null;
    const value = Number(q);
    return Number.isFinite(value) ? value : null;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
