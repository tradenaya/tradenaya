import { ExecutionStore } from "@/automation/executor/store";
import { ProtectiveOrdersService } from "@/automation/executor/services/protective-orders";
import { BotLifecycleService } from "@/automation/service/bot-lifecycle";
import type { ExchangePosition } from "@/automation/executor/client";
import type { CoinSwitchClientLike, PositionManagerConfig, PositionRecord, PositionStoreLike } from "./PositionManagerTypes";
import { detectExecutedClose } from "./executed-close";
import { reconcileClose } from "./close-accounting";

const ACTIVE_STATES = new Set(["WAITING_ENTRY", "ENTRY_PENDING", "ENTRY_EXECUTED", "PROTECTED", "TRAILING", "UNPROTECTED", "CLOSING"]);

export class PositionRecovery {
  constructor(
    private readonly client: CoinSwitchClientLike,
    private readonly store: PositionStoreLike,
    private readonly executionStore: ExecutionStore,
    private readonly protective: ProtectiveOrdersService,
    private readonly config: PositionManagerConfig,
    private readonly botState: { updateBotStatus(id: number, status: string, currentTrade?: string | null): Promise<void>; updateBotHeartbeat(id: number, lastAnalysisAt?: string | null, lastExecutionAt?: string | null): Promise<void> } = new BotLifecycleService(),
  ) {}

  async recoverAllActive(): Promise<void> {
    const executions = await this.executionStore.getActiveExecutions();
    const activeStates = new Set(["MONITORING_ENTRY", "ENTRY_FILLED", "PARTIALLY_FILLED", "UNPROTECTED"]);

    for (const execution of executions) {
      if (!activeStates.has(execution.state)) continue;

      const existing = await this.store.getPositionByExecutionId(execution.id);
      if (!existing) {
        await this.store.createPosition(execution, this.config);
      }
    }

    const positions = await this.store.getActivePositions();
    for (const position of positions) {
      await this.reconstruct(position);
    }
  }

  async syncNewExecutions(): Promise<void> {
    const executions = await this.executionStore.getActiveExecutions();
    for (const execution of executions) {
      if (execution.state === "PENDING_ENTRY") continue;
      const existing = await this.store.getPositionByExecutionId(execution.id);
      if (!existing) {
        await this.store.createPosition(execution, this.config);
      }
    }
  }

  private async reconstruct(position: PositionRecord): Promise<void> {
    if (!ACTIVE_STATES.has(position.state)) return;

    // If the exchange is unreachable during recovery, leave the position
    // untouched and let the PositionMonitor retry — never close based on a
    // transient API failure.
    let exchangePositions: ExchangePosition[];
    try {
      exchangePositions = await this.client.getPositions(position.userId, position.symbol);
    } catch {
      return;
    }

    const live = exchangePositions.find((p) => p.symbol.toLowerCase() === position.symbol.toLowerCase()) ?? null;
    const price = await this.client.getCurrentPrice(position.userId, position.symbol).catch(() => null);

    if (!live) {
      await this.reconcileMissingPosition(position, price);
      return;
    }

    await this.store.updateEntry(
      position.id,
      live?.entryPrice ?? position.entryPrice,
      live?.quantity ?? position.filledQuantity,
      live?.positionId ?? position.positionId,
      position.entryOrderId,
    );

    const execution = await this.executionStore.getExecution(position.executionId).catch(() => null);
    if (execution) {
      const slOrderId = execution.stopLossOrder.orderId ?? position.stopLossOrderId;
      const tpOrderId = execution.takeProfitOrder.orderId ?? position.takeProfitOrderId;
      await this.store.updateProtection(position.id, slOrderId, tpOrderId);
      position.stopLossOrderId = slOrderId;
      position.takeProfitOrderId = tpOrderId;
    }

    await this.reconcileProtection(position);

    if (position.state === "ENTRY_PENDING") {
      await this.recoverEntryFromLivePosition(position, execution);
    }

    await this.reconcileState(position);
  }

  /**
   * A tracked position no longer exists on the exchange. We attempt to figure
   * out what happened:
   *
   * 1. ENTRY_PENDING with an entry order → check if the order filled or was
   *    cancelled while we were offline.
   * 2. A protective (SL/TP) order executed → record the close with the
   *    exchange's fill data.
   * 3. Neither protective order executed (manual close on exchange, liquidation,
   *    or no protective orders were placed) → still close the position so the
   *    bot is released. We use the last known price as a best-effort exit.
   */
  private async reconcileMissingPosition(position: PositionRecord, price: number | null): Promise<void> {
    if (position.state === "WAITING_ENTRY") return;

    if (position.state === "ENTRY_PENDING") {
      await this.reconcilePendingEntry(position, price);
      return;
    }

    let closing = await detectExecutedClose(this.client, position.userId, position);

    if (!closing && (!position.stopLossOrderId || !position.takeProfitOrderId)) {
      closing = await this.detectCloseFromExchangeOrders(position);
    }

    const exitPrice = closing?.price ?? price ?? null;
    const realizedPnl = closing?.realizedPnl ?? null;
    const fees = closing?.fees ?? null;
    const reason = closing?.reason ?? "MANUAL_CLOSE";

    // Reconcile gross profit, full commission and funding so the net P&L ties
    // to the wallet rather than a price-only estimate.
    const accounting = await reconcileClose(
      this.client,
      position.userId,
      position,
      position.entryPrice,
      exitPrice,
    ).catch(() => ({
      grossProfit: realizedPnl ?? 0,
      commission: fees ?? 0,
      fundingFee: 0,
      realizedPnl: realizedPnl ?? 0,
      estimated: true,
    }));

    await this.store.markClose(position.id, exitPrice ?? 0, reason, accounting.realizedPnl, accounting.commission);
    await this.store.recordCloseSummary({
      position,
      exitPrice,
      reason,
      realizedPnl: accounting.realizedPnl,
      fees: accounting.commission,
      grossProfit: accounting.grossProfit,
      commission: accounting.commission,
      fundingFee: accounting.fundingFee,
      entryPrice: position.entryPrice,
    });
    await this.executionStore.updateState(position.executionId, "CLOSED");
    await this.saveEvent(position, "RECOVERY_CLOSED", `${position.symbol} closed via ${reason} (recovery: position missing from exchange) at ${exitPrice ?? "n/a"} pnl=${realizedPnl ?? "unknown"}`);
    await this.releaseBot(position);
  }

  /**
   * During recovery the entry order was pending and no position exists on the
   * exchange. Check whether the order was filled or cancelled while we were
   * offline so we can reconcile the DB state accordingly.
   */
  private async reconcilePendingEntry(position: PositionRecord, price: number | null): Promise<void> {
    const orderId = position.entryOrderId;
    if (!orderId) return;

    const order = await this.client.getOrderStatus(position.userId, orderId).catch(() => null);
    const status = order?.status ?? "";

    const FILLED = new Set(["EXECUTED", "PARTIALLY_EXECUTED", "FILLED", "ALL_DONE", "CLOSED"]);
    const TERMINAL = new Set(["CANCELLED", "CANCELLATION_RAISED", "CANCELED", "REJECTED", "EXPIRED"]);

    if (FILLED.has(status)) {
      const entryPrice = price ?? order?.raw?.avg_execution_price ?? order?.raw?.avg_price ?? null;
      const quantity = order?.raw?.exec_quantity ?? position.filledQuantity ?? null;
      await this.store.updateEntry(position.id, entryPrice, quantity, null, orderId);
      await this.store.updateState(position.id, "ENTRY_EXECUTED");
      await this.executionStore.updateState(position.executionId, "ENTRY_FILLED");
      await this.saveEvent(position, "RECOVERY_ENTRY_FILLED", `entry order ${orderId} was filled while offline`);
      return;
    }

    if (TERMINAL.has(status)) {
      await this.store.updateState(position.id, "CLOSED");
      await this.store.recordCloseSummary({
        position,
        exitPrice: null,
        reason: "ENTRY_CANCELLED",
        realizedPnl: 0,
        fees: 0,
        entryPrice: null,
      });
      await this.executionStore.updateState(position.executionId, "CANCELLED", `entry order ${status} while offline`);
      await this.saveEvent(position, "RECOVERY_ENTRY_CANCELLED", `entry order ${orderId} was ${status} while offline`);
      await this.releaseBot(position);
    }
  }

  /**
   * During recovery the position state is ENTRY_PENDING but the position
   * actually exists on the exchange — meaning the entry filled while the
   * server was down and the fill was never recorded. Transition to
   * ENTRY_EXECUTED. If the DB has no protective order IDs, search the
   * exchange for reduce-only orders that could be the SL/TP.
   */
  private async recoverEntryFromLivePosition(position: PositionRecord, execution: import("@/automation/executor/types").ExecutionRecord | null): Promise<void> {
    if (!execution) {
      await this.store.updateState(position.id, "ENTRY_EXECUTED");
      await this.executionStore.updateState(position.executionId, "ENTRY_FILLED");
      await this.saveEvent(position, "RECOVERY_ENTRY_FILLED", "entry was filled while offline (no execution record)");
      return;
    }

    const entryPrice = execution.entry.orderId ? null : position.entryPrice;
    const quantity = execution.filledQuantity ?? position.filledQuantity;
    await this.store.updateEntry(position.id, entryPrice ?? position.entryPrice, quantity, position.positionId, execution.entry.orderId ?? position.entryOrderId);
    await this.store.updateState(position.id, "ENTRY_EXECUTED");
    await this.executionStore.updateState(position.executionId, "ENTRY_FILLED");

    if (!position.stopLossOrderId && !position.takeProfitOrderId && execution.stopLoss && execution.takeProfit) {
      await this.recoverProtectiveOrdersFromExchange(position, execution);
    }

    await this.saveEvent(position, "RECOVERY_ENTRY_FILLED", "entry was filled while offline; position reconciled");
  }

  /**
   * The entry filled and protective orders were placed on the exchange, but
   * their IDs were never saved to the DB (server crashed between placement
   * and persistence). Search the exchange for reduce-only orders and save
   * their IDs so the monitor can track them.
   */
  private async recoverProtectiveOrdersFromExchange(position: PositionRecord, execution: import("@/automation/executor/types").ExecutionRecord): Promise<void> {
    const opposite = position.side === "BUY" ? "SELL" : "BUY";

    let openOrders;
    try {
      openOrders = await this.client.getOpenOrders(position.userId, position.symbol);
    } catch {
      return;
    }

    let slOrderId: string | null = null;
    let tpOrderId: string | null = null;

    for (const order of openOrders) {
      const raw = order.raw ?? {};
      const isReduceOnly = raw.reduce_only === true || raw.reduceOnly === true || String(raw.reduce_only) === "1";
      const orderSide = String(raw.side ?? "").toUpperCase();
      const orderType = String(raw.type ?? raw.order_type ?? "").toUpperCase();
      if (!isReduceOnly || orderSide !== opposite || !order.orderId) continue;

      if (orderType.includes("STOP") && !slOrderId) {
        slOrderId = order.orderId;
      } else if ((orderType.includes("PROFIT") || orderType.includes("LIMIT")) && !tpOrderId) {
        tpOrderId = order.orderId;
      }
    }

    if (slOrderId || tpOrderId) {
      await this.store.updateProtection(position.id, slOrderId, tpOrderId);
      await this.saveEvent(position, "RECOVERY_PROTECTIVE_RECOVERED", `recovered protective orders from exchange: SL=${slOrderId ?? "none"} TP=${tpOrderId ?? "none"}`);
    }
  }
  private async detectCloseFromExchangeOrders(position: PositionRecord): Promise<import("./executed-close").ExecutedCloseInfo | null> {
    const opposite = position.side === "BUY" ? "SELL" : "BUY";

    let openOrders;
    try {
      openOrders = await this.client.getOpenOrders(position.userId, position.symbol);
    } catch {
      return null;
    }

    for (const order of openOrders) {
      const raw = order.raw ?? {};
      const isReduceOnly = raw.reduce_only === true || raw.reduceOnly === true || String(raw.reduce_only) === "1";
      const orderSide = String(raw.side ?? "").toUpperCase();
      if (!isReduceOnly || orderSide !== opposite) continue;

      const status = await this.client.getOrderStatus(position.userId, order.orderId!).catch(() => null);
      const s = String(status?.status ?? "");
      if (["EXECUTED", "FILLED", "ALL_DONE", "CLOSED"].includes(s)) {
        return {
          reason: "STOP_LOSS",
          price: Number(status?.raw?.avg_execution_price) || null,
          realizedPnl: Number(status?.raw?.realised_pnl) || null,
          fees: Number(status?.raw?.execution_fee) || null,
        };
      }
    }

    return null;
  }

  private async reconcileProtection(position: PositionRecord): Promise<void> {
    const openOrders = await this.client.getOpenOrders(position.userId, position.symbol).catch(() => []);

    const opposite = position.side === "BUY" ? "SELL" : "BUY";
    const slOrder = openOrders.find((o) => o.orderId === position.stopLossOrderId);
    const tpOrder = openOrders.find((o) => o.orderId === position.takeProfitOrderId);

    if (position.stopLoss && position.stopLossOrderId && !slOrder) {
      const slStatus = await this.client.getOrderStatus(position.userId, position.stopLossOrderId).catch(() => null);
      const slFilled = slStatus && ["EXECUTED", "FILLED", "ALL_DONE", "CLOSED"].includes(String(slStatus.status ?? ""));
      if (!slFilled) {
        await this.store.updateProtection(position.id, null, position.takeProfitOrderId);
      }
    }
    if (position.takeProfit && position.takeProfitOrderId && !tpOrder) {
      const tpStatus = await this.client.getOrderStatus(position.userId, position.takeProfitOrderId).catch(() => null);
      const tpFilled = tpStatus && ["EXECUTED", "FILLED", "ALL_DONE", "CLOSED"].includes(String(tpStatus.status ?? ""));
      if (!tpFilled) {
        await this.store.updateProtection(position.id, position.stopLossOrderId, null);
      }
    }

    const hasSl = Boolean(position.stopLoss && (slOrder || (await this.findReduceOnly(openOrders, position.stopLoss, opposite))));
    const hasTp = Boolean(position.takeProfit && (tpOrder || (await this.findReduceOnly(openOrders, position.takeProfit, opposite))));

    if (!hasSl || !hasTp) {
      await this.store.saveEvent({
        userId: position.userId,
        botId: position.botId,
        executionId: position.executionId,
        positionId: position.id,
        type: "RECOVERY_UNPROTECTED",
        message: `Recovery found ${!hasSl ? "missing stop loss" : ""} ${!hasTp ? "missing take profit" : ""}`,
      });
    }
  }

  private async reconcileState(position: PositionRecord): Promise<void> {
    if (position.state === "WAITING_ENTRY" || position.state === "ENTRY_PENDING") {
      await this.store.updateState(position.id, "ENTRY_EXECUTED");
    }
  }

  private async findReduceOnly(orders: Array<{ raw?: Record<string, unknown> }>, triggerPrice: number, side: string): Promise<{ raw?: Record<string, unknown> } | null> {
    return orders.find((o) => {
      const raw = o.raw ?? {};
      const rawSide = String(raw.side ?? "").toUpperCase();
      const isReduceOnly = raw.reduce_only === true || raw.reduceOnly === true || String(raw.reduce_only) === "1";
      return isReduceOnly && rawSide === side;
    }) ?? null;
  }

  private async saveEvent(position: PositionRecord, type: string, message: string): Promise<void> {
    await this.store.saveEvent({
      userId: position.userId,
      botId: position.botId,
      executionId: position.executionId,
      positionId: position.id,
      type,
      message,
    });
  }

  private async releaseBot(position: PositionRecord): Promise<void> {
    await this.botState.updateBotStatus(position.botId, "RUNNING", null).catch(() => null);
    await this.botState.updateBotHeartbeat(position.botId, null, new Date().toISOString()).catch(() => null);
  }

  async emergencyProtect(executionId: number): Promise<boolean> {
    const execution = await this.executionStore.getExecution(executionId);
    if (!execution) return false;

    const retries = this.config.emergencyRetries ?? 2;
    for (let i = 0; i < retries; i++) {
      const { status } = await this.protective.placeProtection(execution, execution.filledQuantity);
      if (status !== "FAILED" && status !== "NONE") return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }
}
