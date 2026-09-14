import { ExecutionStore } from "@/automation/executor/store";
import { ProtectiveOrdersService } from "@/automation/executor/services/protective-orders";
import { BotLifecycleService } from "@/automation/service/bot-lifecycle";
import type { ExchangePosition } from "@/automation/executor/client";
import type { CoinSwitchClientLike, ExitReason, PositionManagerConfig, PositionRecord, PositionStoreLike, PositionSyncSummary } from "./PositionManagerTypes";
import { detectExecutedClose, detectClosedOrderClose, confirmExternalClose, detectLiquidation } from "./executed-close";
import { reconcileClose } from "./close-accounting";
import { classifyStatus } from "@/automation/executor/order-status";

const ACTIVE_STATES = new Set(["WAITING_ENTRY", "ENTRY_PENDING", "ENTRY_EXECUTED", "PROTECTED", "TRAILING", "UNPROTECTED", "CLOSING"]);

type ReconcileOutcome = "open" | "closed" | "kept_open" | "pending" | "skipped";

function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class PositionRecovery {
  constructor(
    private readonly client: CoinSwitchClientLike,
    private readonly store: PositionStoreLike,
    private readonly executionStore: ExecutionStore,
    private readonly protective: ProtectiveOrdersService,
    private readonly config: PositionManagerConfig,
    private readonly botState: { updateBotStatus(id: number, status: string, currentTrade?: string | null): Promise<void>; updateBotHeartbeat(id: number, lastAnalysisAt?: string | null, lastExecutionAt?: string | null): Promise<void> } = new BotLifecycleService(),
  ) {}

  async recoverAllActive(): Promise<PositionSyncSummary> {
    const executions = await this.executionStore.getActiveExecutions();
    const activeStates = new Set(["MONITORING_ENTRY", "ENTRY_FILLED", "PARTIALLY_FILLED", "UNPROTECTED"]);

    for (const execution of executions) {
      if (!activeStates.has(execution.state)) continue;

      const existing = await this.store.getPositionByExecutionId(execution.id);
      if (!existing) {
        await this.store.createPosition(execution, this.config);
      }
    }

    const summary: PositionSyncSummary = { positionsChecked: 0, confirmedClosed: 0, keptOpen: 0, failed: 0 };
    const positions = await this.store.getActivePositions();
    for (const position of positions) {
      summary.positionsChecked++;
      try {
        const outcome = await this.reconcile(position);
        if (outcome === "closed") summary.confirmedClosed++;
        else summary.keptOpen++;
      } catch {
        // A failure for one position must never abort the whole sweep; leave
        // the position untouched so the PositionMonitor retries on the next
        // cycle instead of double-processing or half-processing it.
        summary.failed++;
      }
    }
    return summary;
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

  private async reconcile(position: PositionRecord): Promise<ReconcileOutcome> {
    if (!ACTIVE_STATES.has(position.state)) return "skipped";

    // If the exchange is unreachable during recovery, leave the position
    // untouched and let the PositionMonitor retry — never close based on a
    // transient API failure.
    let exchangePositions: ExchangePosition[];
    try {
      exchangePositions = await this.client.getPositions(position.userId, position.symbol);
    } catch {
      return "kept_open";
    }

    const live = exchangePositions.find((p) => p.symbol.toLowerCase() === position.symbol.toLowerCase()) ?? null;
    const price = await this.client.getCurrentPrice(position.userId, position.symbol).catch(() => null);

    if (!live) {
      return await this.reconcileMissingPosition(position, price);
    }

    await this.store.updateEntry(
      position.id,
      live.entryPrice ?? position.entryPrice,
      live.quantity ?? position.filledQuantity,
      live.positionId ?? position.positionId,
      position.entryOrderId,
    );

    // Back-fill protective order refs from the execution record so the monitor
    // can keep tracking SL/TP after a restart.
    const execution = await this.executionStore.getExecution(position.executionId).catch(() => null);
    if (execution) {
      const slOrderId = execution.stopLossOrder.orderId ?? position.stopLossOrderId;
      const tpOrderId = execution.takeProfitOrder.orderId ?? position.takeProfitOrderId;
      await this.store.updateProtection(position.id, slOrderId, tpOrderId);
      position.stopLossOrderId = slOrderId;
      position.takeProfitOrderId = tpOrderId;
    }

    if (position.state === "ENTRY_PENDING") {
      await this.store.updateState(position.id, "ENTRY_EXECUTED");
      await this.executionStore.updateState(position.executionId, "ENTRY_FILLED");
    }

    return "open";
  }

  /**
   * A tracked position no longer exists on the exchange. We attempt to figure
   * out what happened:
   *
   * 1. ENTRY_PENDING with an entry order → check if the order filled or was
   *    cancelled while we were offline.
   * 2. A protective (SL/TP) order executed → record the close with the
   *    exchange's fill data.
   * 3. The closed-order history proves a terminal reduce-only fill → record it.
   * 4. The transaction ledger shows a realized P&L → closed externally
   *    (manual close / liquidation).
   * 5. None of the above can be proven → keep the position open and retry;
   *    never fabricate a close reason on a transient read.
   */
  private async reconcileMissingPosition(position: PositionRecord, price: number | null): Promise<ReconcileOutcome> {
    if (position.state === "WAITING_ENTRY") return "kept_open";

    if (position.state === "ENTRY_PENDING") {
      return await this.reconcilePendingEntry(position);
    }

    // Back-fill protective order refs from the execution record. Without them
    // the position keeps NULL sl/tp order ids (e.g. protected after the DB row
    // was created) and a filled SL/TP can never be verified, leaving the
    // position stuck as PROTECTED and the bot blocked.
    const exec = await this.executionStore.getExecution(position.executionId).catch(() => null);
    if (exec) {
      const slOrderId = exec.stopLossOrder.orderId ?? position.stopLossOrderId;
      const tpOrderId = exec.takeProfitOrder.orderId ?? position.takeProfitOrderId;
      if ((slOrderId || tpOrderId) && (slOrderId !== position.stopLossOrderId || tpOrderId !== position.takeProfitOrderId)) {
        await this.store.updateProtection(position.id, slOrderId, tpOrderId);
        position.stopLossOrderId = slOrderId;
        position.takeProfitOrderId = tpOrderId;
      }
    }

    // A read that succeeded and returned no position DOES mean the position is
    // gone from the exchange. But before we finalize a close we must confirm
    // HOW it closed (protective fill, closed-order history, ledger realized
    // P&L) so we never fabricate a MANUAL_CLOSE for a transient state or a
    // wrong recovery price. If we cannot confirm, we keep the position open.
    let closing = await detectExecutedClose(this.client, position.userId, position);
    if (!closing && (!position.stopLossOrderId || !position.takeProfitOrderId)) {
      closing = await detectClosedOrderClose(this.client, position.userId, position);
    }

    let closedAtMs: number | null = null;
    if (!closing) {
      const confirmed = await confirmExternalClose(this.client, position.userId, position);
      if (!confirmed.confirmed) {
        await this.saveEvent(position, "RECOVERY_UNAVAILABLE", `position not returned by exchange but close unconfirmed — keeping open and retrying`);
        return "kept_open";
      }
      closing = {
        reason: confirmed.reason ?? "MANUAL_CLOSE",
        price: confirmed.price ?? null,
        realizedPnl: confirmed.realizedPnl,
        fees: confirmed.fees,
      };
      closedAtMs = confirmed.closedAtMs;
    }

    let reason = closing.reason ?? "MANUAL_CLOSE";
    const exitPrice = closing.price ?? price ?? null;

    // Liquidation forensic check: an unclassified close whose realized P&L
    // wiped the full margin (or whose current price traded past the estimated
    // liquidation boundary) was an exchange LIQUIDATION, not a manual close.
    // Book it honestly so analytics reflect the true failure mode instead of a
    // placeholder stop that could never fill.
    if (reason === "MANUAL_CLOSE") {
      const liq = await detectLiquidation(this.client, position.userId, position, price);
      if (liq.suspected) {
        reason = "LIQUIDATION";
        closedAtMs = closedAtMs ?? liq.closedAtMs;
        await this.saveEvent(position, "RECOVERY_LIQUIDATION", `${position.symbol} was liquidated on the exchange: ${liq.reasoning}`);
      }
    }

    await this.finalizeClosed(position, reason, exitPrice, closedAtMs, closing);
    return "closed";
  }

  private async finalizeClosed(
    position: PositionRecord,
    reason: ExitReason,
    exitPrice: number | null,
    closedAtMs: number | null,
    closing: { realizedPnl: number | null; fees: number | null },
  ): Promise<void> {
    // Reconcile gross profit, full commission and funding so the net P&L ties
    // to the wallet rather than a price-only estimate.
    const accounting = await reconcileClose(
      this.client,
      position.userId,
      position,
      position.entryPrice,
      exitPrice,
    ).catch(() => ({
      grossProfit: closing.realizedPnl ?? 0,
      commission: closing.fees ?? 0,
      fundingFee: 0,
      realizedPnl: closing.realizedPnl ?? 0,
      estimated: true,
    }));

    const closedAt = closedAtMs != null ? new Date(closedAtMs).toISOString() : undefined;
    await this.store.markClose(position.id, exitPrice ?? 0, reason, accounting.realizedPnl, accounting.commission, closedAt);
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
    if (reason !== "LIQUIDATION") {
      await this.saveEvent(position, "RECOVERY_CLOSED", `${position.symbol} closed via ${reason} (recovery: position missing from exchange, close confirmed) at ${exitPrice ?? "n/a"} pnl=${accounting.realizedPnl ?? "unknown"}`);
    }
    await this.releaseBot(position);
  }

  /**
   * During recovery the entry order was pending and no position exists on the
   * exchange. Check whether the order filled or was cancelled while we were
   * offline so we can reconcile the DB state accordingly.
   */
  private async reconcilePendingEntry(position: PositionRecord): Promise<ReconcileOutcome> {
    const orderId = position.entryOrderId;
    if (!orderId) return "kept_open";

    const order = await this.client.getOrderStatus(position.userId, orderId).catch(() => null);
    const kind = classifyStatus(order?.status ?? "");

    if (kind === "FILLED" || kind === "PARTIAL") {
      const entryPrice = toNum(order?.raw?.avg_execution_price) ?? toNum(order?.raw?.avg_price) ?? position.entryPrice;
      const quantity = toNum(order?.raw?.exec_quantity) ?? position.filledQuantity ?? null;
      await this.store.updateEntry(position.id, entryPrice, quantity, null, orderId);
      await this.store.updateState(position.id, "ENTRY_EXECUTED");
      await this.executionStore.updateState(position.executionId, "ENTRY_FILLED");
      await this.saveEvent(position, "RECOVERY_ENTRY_FILLED", `entry order ${orderId} was filled while offline`);
      return "open";
    }

    if (kind === "CANCELLED") {
      await this.store.updateState(position.id, "CLOSED");
      await this.store.recordCloseSummary({
        position,
        exitPrice: null,
        reason: "ENTRY_CANCELLED",
        realizedPnl: 0,
        fees: 0,
        entryPrice: null,
      });
      await this.executionStore.updateState(position.executionId, "CANCELLED", `entry order ${order?.status ?? ""} while offline`);
      await this.saveEvent(position, "RECOVERY_ENTRY_CANCELLED", `entry order ${orderId} was ${order?.status ?? ""} while offline`);
      await this.releaseBot(position);
      return "closed";
    }

    return "kept_open";
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