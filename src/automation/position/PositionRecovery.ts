import { ExecutionStore } from "@/automation/executor/store";
import { ProtectiveOrdersService } from "@/automation/executor/services/protective-orders";
import { BotLifecycleService } from "@/automation/service/bot-lifecycle";
import type { ExchangePosition } from "@/automation/executor/client";
import type { CoinSwitchClientLike, PositionManagerConfig, PositionRecord, PositionStoreLike } from "./PositionManagerTypes";
import { detectExecutedClose } from "./executed-close";

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
    await this.reconcileState(position);
  }

  /**
   * A tracked position no longer exists on the exchange. If one of the
   * protective orders actually executed (e.g. SL/TP fired while the server was
   * down) we record a real close using the exchange's fill data and release
   * the bot. Otherwise we leave it for the monitor, which applies its own
   * grace period / MANUAL_CLOSE handling — we never silently discard it.
   */
  private async reconcileMissingPosition(position: PositionRecord, price: number | null): Promise<void> {
    if (position.state === "WAITING_ENTRY" || position.state === "ENTRY_PENDING") return;

    const closing = await detectExecutedClose(this.client, position.userId, position);
    if (!closing) return;

    const exitPrice = closing.price ?? price ?? null;
    const realizedPnl = closing.realizedPnl ?? 0;
    const fees = closing.fees ?? 0;

    await this.store.markClose(position.id, exitPrice ?? 0, closing.reason, realizedPnl, fees);
    await this.store.recordCloseSummary({
      position,
      exitPrice,
      reason: closing.reason,
      realizedPnl: closing.realizedPnl,
      fees: closing.fees,
      entryPrice: position.entryPrice,
    });
    await this.executionStore.updateState(position.executionId, "CLOSED");
    await this.saveEvent(position, "RECOVERY_CLOSED", `${position.symbol} closed via ${closing.reason} at ${exitPrice ?? "n/a"} pnl=${realizedPnl}`);
    await this.releaseBot(position);
  }

  private async reconcileProtection(position: PositionRecord): Promise<void> {
    const openOrders = await this.client.getOpenOrders(position.userId, position.symbol).catch(() => []);

    const opposite = position.side === "BUY" ? "SELL" : "BUY";
    const slOrder = openOrders.find((o) => o.orderId === position.stopLossOrderId);
    const tpOrder = openOrders.find((o) => o.orderId === position.takeProfitOrderId);

    if (position.stopLoss && position.stopLossOrderId && !slOrder) {
      await this.store.updateProtection(position.id, null, position.takeProfitOrderId);
    }
    if (position.takeProfit && position.takeProfitOrderId && !tpOrder) {
      await this.store.updateProtection(position.id, position.stopLossOrderId, null);
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
