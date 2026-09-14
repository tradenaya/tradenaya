import type { CoinSwitchClient } from "../client";
import type { ExecutionStore } from "../store";
import type { BotStateService } from "../types";
import type { TradePlan } from "@/automation/planner/types";
import { clientOrderId as buildClientOrderId } from "../order-id";
import { OrderHistoryRepository, type OrderHistoryInsert } from "@/automation/order-history";
import { isFullyFilled, isPartiallyFilled, isTerminalCancelled } from "../order-status";

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

/** Result of the short inline fill-wait window for an entry order. */
export interface EntryPollResult {
  /** True only when the order fully executed (no remainder resting). */
  filled: boolean;
  /**
   * True when the order is STILL resting on the exchange and must keep being
   * monitored server-side (PositionMonitor) until it fills, invalidates,
   * is explicitly cancelled, or reaches its configured expiry (expires_at).
   */
  resting: boolean;
  /** Actual executed quantity, or null when the exchange did not report one. */
  filledQuantity: number | null;
  /** Quantity still resting on the exchange (order quantity minus filled), or null when not computable. */
  remainingQuantity: number | null;
  /** Exchange-reported terminal reason when the order ended (CANCELLED / CANCELLATION_RAISED / REJECTED / EXPIRED), else null. */
  terminal: string | null;
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

  async pollEntryUntilFilled(
    executionId: number,
    userId: number,
    orderId: string,
    opts: { quantity?: number | null } = {},
  ): Promise<EntryPollResult> {
    const interval = this.options.statusPollIntervalMs ?? 2000;
    const attempts = this.options.statusPollAttempts ?? 30;
    const orderQuantity = opts.quantity ?? null;

    // The inline window below is a fast-fill wait, NOT the order's lifetime.
    // A LIMIT entry lives until it fills, invalidates, is cancelled, or reaches
    // the configured orderExpiryMinutes (persisted as expires_at). When the
    // inline window ends with the order still open we hand it off to the
    // server-side PositionMonitor instead of cancelling a resting order early.
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
      if (isFullyFilled(status.status)) {
        const filledQuantity = this.extractFilledQuantity(status.raw) ?? orderQuantity;
        const avg = num(strRaw(status.raw, "avg_execution_price") ?? strRaw(status.raw, "average_price") ?? strRaw(status.raw, "price"));
        if (filledQuantity != null) {
          // Full fill → no resting remainder. Persisted so a restart keeps the
          // correct filled/remaining split.
          await this.store.updateFill(executionId, filledQuantity, 0, avg);
        }
        await this.store.updateState(executionId, "ENTRY_FILLED");

        if (filledQuantity != null) {
          void this.recordOrder(
            this.buildOrderRow(userId, orderId, status, {
              quantity: filledQuantity,
              price: avg ?? null,
              avgExecutionPrice: avg ?? null,
              amountUsed: filledQuantity && avg ? filledQuantity * avg : null,
              status: "FILLED",
            }),
          );
        }

        return { filled: true, resting: false, filledQuantity, remainingQuantity: 0, terminal: null };
      }

      if (isPartiallyFilled(status.status)) {
        const filledQuantity = this.extractFilledQuantity(status.raw);
        const remainingQuantity =
          filledQuantity != null && orderQuantity != null ? Math.max(0, orderQuantity - filledQuantity) : null;
        if (filledQuantity != null) {
          const avg = num(strRaw(status.raw, "avg_execution_price") ?? strRaw(status.raw, "average_price") ?? strRaw(status.raw, "price"));
          // Record the real fill but do NOT treat the order as fully filled —
          // the remainder keeps resting and must be monitored to expiry/fill.
          await this.store.updateFill(executionId, filledQuantity, remainingQuantity, avg);
        }
        await this.store.updateState(executionId, "PARTIALLY_FILLED");
        return {
          filled: false,
          resting: true,
          filledQuantity,
          remainingQuantity,
          terminal: null,
        };
      }

      if (isTerminalCancelled(status.status)) {
        await this.store.updateState(executionId, "CANCELLED", `Entry order ${status.status}`);
        void this.recordOrder(
          this.buildOrderRow(userId, orderId, status, {
            status: status.status === "CANCELLED" ? "CANCELLED" : (status.status ?? undefined),
          }),
        );
        return { filled: false, resting: false, filledQuantity: null, remainingQuantity: orderQuantity, terminal: status.status };
      }
    }

    // The short polling window ended while the order is still OPEN. NEVER cancel
    // a resting entry here — the PositionMonitor keeps watching the order
    // server-side for the full expiry period (configured orderExpiryMinutes,
    // persisted as expires_at), and only cancels on fill, EntryValidity
    // invalidation, explicit cancel, or expiry.
    await this.store.updateState(executionId, "MONITORING_ENTRY");
    return { filled: false, resting: true, filledQuantity: null, remainingQuantity: orderQuantity, terminal: null };
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
