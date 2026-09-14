import type { ExecutionRecord, ExecutionState } from "@/automation/executor/types";
import { executionStore, ExecutionStore } from "@/automation/executor/store";
import { positionStore, PositionStore } from "@/automation/position/PositionStore";
import type { PositionManagerConfig, PositionRecord } from "@/automation/position/PositionManagerTypes";
import { clientOrderId } from "@/automation/executor/order-id";
import { classifyStatus } from "@/automation/executor/order-status";
import type { CoinSwitchClientLike } from "@/automation/position/PositionManagerTypes";
import { coinswitchClient, type ExchangeOrder } from "@/automation/executor/client";

const ENTRY_SEED_PREFIX = "exec_";

const ACTIVE_EXECUTION_STATES = new Set<ExecutionState>([
  "MONITORING_ENTRY",
  "ENTRY_FILLED",
  "PARTIALLY_FILLED",
  "UNPROTECTED",
]);
const TERMINAL_EXECUTION_STATES = new Set<ExecutionState>(["CANCELLED", "FAILED", "CLOSED"]);

const isReduceOnly = (raw?: Record<string, unknown>): boolean =>
  Boolean(raw && (raw.reduce_only === true || raw.reduceOnly === true || String(raw.reduce_only) === "1"));

const rawOf = (order: ExchangeOrder): Record<string, unknown> => (order.raw ?? {}) as Record<string, unknown>;

const toNum = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Relative-tolerance trigger-price match (protective orders against SL/TP config). */
export function matchesTriggerPrice(orderTrigger: number | null | undefined, target: number | null | undefined): boolean {
  if (orderTrigger == null || target == null || !(target > 0)) return false;
  const diff = Math.abs(orderTrigger - target) / target;
  return diff <= 0.005;
}

export interface ReconcileSnapshot {
  usersReconciled: number;
  entryOrdersAdopted: number;
  positionsAdopted: number;
  protectiveRefsBackfilled: number;
  reactivatedTerminalExecutions: number;
  untrackedExchangePositions: number;
  skippedUsers: number;
}

export interface LivePositionLike {
  symbol: string;
  quantity: number;
  side: string;
  entryPrice: number | null;
  positionId: string | null;
}

/**
 * Two-way reconciliation between local executions/positions and the live
 * CoinSwitch state. Direction is ALWAYS one-way for safety:
 *   - Missing local info is back-filled FROM the exchange (adopt).
 *   - Local info is NEVER removed because of an API failure or a temporary
 *     empty read.
 *
 * Covered scenarios (restart / VPS restart / orphan order / duplicate worker):
 *   - Entry order placed on the exchange but its ID never persisted (crash
 *     between place and persist) → matched by the deterministic client_order_id
 *     seed and adopted into the execution + a position row.
 *   - An execution locally marked CANCELLED/FAILED whose order/position is
 *     actually live on the exchange (timeout after the exchange accepted) →
 *     reactivated so the Position Manager keeps managing it.
 *   - Protective (SL/TP) orders placed but refs never saved → back-filled by
 *     matching reduce-only open orders to the stored trigger prices.
 *   - Position id / entry price / filled qty missing locally while the
 *     exchange shows a position → filled in from the exchange.
 *   - A genuinely untracked exchange position (no local execution at all) is
 *     NEVER closed and NEVER auto-protected — only alerted.
 */
export class ExchangeReconciler {
  constructor(
    private readonly client: CoinSwitchClientLike,
    private readonly execution: ExecutionStore = executionStore,
    private readonly positions: PositionStore = positionStore,
    private readonly config: PositionManagerConfig = {},
  ) {}

  /** Boot-time pass over every user with any active execution or position. */
  async reconcileAllActive(): Promise<ReconcileSnapshot> {
    const summary: ReconcileSnapshot = {
      usersReconciled: 0,
      entryOrdersAdopted: 0,
      positionsAdopted: 0,
      protectiveRefsBackfilled: 0,
      reactivatedTerminalExecutions: 0,
      untrackedExchangePositions: 0,
      skippedUsers: 0,
    };

    const [executions, positions] = await Promise.all([
      this.execution.getActiveExecutions().catch(() => []),
      this.positions.getActivePositions().catch(() => []),
    ]);
    const users = new Set<number>([...executions.map((e) => e.userId), ...positions.map((p) => p.userId)]);

    for (const user of users) {
      try {
        const outcome = await this.reconcileUser(
          user,
          executions.filter((e) => e.userId === user),
          positions.filter((p) => p.userId === user),
        );
        summary.usersReconciled += 1;
        summary.entryOrdersAdopted += outcome.entryOrdersAdopted;
        summary.positionsAdopted += outcome.positionsAdopted;
        summary.protectiveRefsBackfilled += outcome.protectiveRefsBackfilled;
        summary.reactivatedTerminalExecutions += outcome.reactivatedTerminalExecutions;
        summary.untrackedExchangePositions += outcome.untrackedExchangePositions;
      } catch (error) {
        console.error("[RECONCILER] reconcile failed for user", user, error);
        summary.skippedUsers += 1;
      }
    }

    return summary;
  }

  /** Targeted pass for a single execution (e.g. when its entry order id is missing during monitoring). */
  async reconcileForExecution(executionId: number): Promise<void> {
    const execution = await this.execution.getExecution(executionId).catch(() => null);
    if (!execution) return;
    const position = await this.positions.getPositionByExecutionId(executionId).catch(() => null);
    await this.reconcileUser(execution.userId, [execution], position ? [position] : []);
  }

  /**
   * Reconcile one user. A failed exchange read must NEVER be treated as empty
   * state — if the positions or open-orders read fails we simply skip the
   * parts that depend on it and keep the local state untouched.
   */
  private async reconcileUser(
    userId: number,
    executions: ExecutionRecord[],
    positions: PositionRecord[],
  ): Promise<ReconcileSnapshot> {
    const summary: ReconcileSnapshot = {
      usersReconciled: 0,
      entryOrdersAdopted: 0,
      positionsAdopted: 0,
      protectiveRefsBackfilled: 0,
      reactivatedTerminalExecutions: 0,
      untrackedExchangePositions: 0,
      skippedUsers: 0,
    };

    let openOrders: ExchangeOrder[] = [];
    let exchangePositions = new Map<string, LivePositionLike>();
    let ordersReadOk = false;
    let positionsReadOk = false;

    try {
      openOrders = await this.client.getOpenOrders(userId);
      ordersReadOk = true;
    } catch {
      openOrders = [];
    }
    try {
      const livePositions = await this.client.getPositions(userId);
      positionsReadOk = true;
      for (const p of livePositions) {
        const key = String(p.symbol ?? "").toLowerCase();
        if (key) exchangePositions.set(key, p);
      }
    } catch {
      exchangePositions = new Map();
    }

    const ordersByClientOrderId = new Map<string, ExchangeOrder>();
    const ordersById = new Map<string, ExchangeOrder>();
    for (const o of openOrders) {
      if (o.orderId) ordersById.set(o.orderId, o);
      if (o.clientOrderId) ordersByClientOrderId.set(o.clientOrderId, o);
      const rawId = rawOf(o).client_order_id ?? rawOf(o).order_id;
      if (rawId && !ordersByClientOrderId.has(String(rawId))) ordersByClientOrderId.set(String(rawId), o);
    }

    // 1) Adopt / reactivate executions from live state.
    const adopted = new Set<string>();
    for (const execution of executions) {
      await this.reconcileExecution(execution, positions, ordersByClientOrderId, ordersById, exchangePositions, positionsReadOk, summary, adopted);
    }

    // 2) Back-fill SL/TP refs that were never persisted for live positions.
    if (ordersReadOk) {
      for (const position of positions) {
        if (position.state === "CLOSED" || position.state === "ERROR") continue;
        summary.protectiveRefsBackfilled += await this.backfillProtectiveRefs(position, openOrders);
      }
    }

    // 3) Untracked exchange positions (no local execution can be matched).
    if (positionsReadOk) {
      for (const [, live] of exchangePositions) {
        if (!(live.quantity > 0) || !live.positionId) continue;
        if (adopted.has(live.positionId)) continue;
        const symbolMatchesExecution = executions.some(
          (e) => e.userId === userId && String(e.symbol ?? "").toLowerCase() === String(live.symbol ?? "").toLowerCase(),
        );
        // An execution exists for this symbol but could not be linked to this
        // exact position id — the ambiguous case; never close/alert as untracked.
        if (symbolMatchesExecution) continue;
        summary.untrackedExchangePositions += 1;
        console.warn(
          `[RECONCILER] untracked exchange position ${live.symbol} (id=${live.positionId}, qty=${live.quantity}) has no local execution — left untouched, NOT closed, only alerted.`,
        );
      }
    }

    return summary;
  }

  private async reconcileExecution(
    execution: ExecutionRecord,
    allPositions: PositionRecord[],
    ordersByClientOrderId: Map<string, ExchangeOrder>,
    ordersById: Map<string, ExchangeOrder>,
    exchangePositions: Map<string, LivePositionLike>,
    positionsReadOk: boolean,
    summary: ReconcileSnapshot,
    adopted: Set<string>,
  ): Promise<void> {
    const position = allPositions.find((p) => p.executionId === execution.id) ?? null;
    const symbolKey = String(execution.symbol ?? "").toLowerCase();

    const seed = clientOrderId(`${ENTRY_SEED_PREFIX}${execution.id}`);
    const liveOrder =
      ordersByClientOrderId.get(seed) ??
      (execution.entry.clientOrderId ? ordersByClientOrderId.get(execution.entry.clientOrderId) : null) ??
      (execution.entry.orderId ? ordersById.get(execution.entry.orderId) : null) ??
      null;

    const livePosition = positionsReadOk ? (exchangePositions.get(symbolKey) ?? null) : null;

    // ---- Terminal executions: reactivate ONLY with hard exchange evidence. ----
    if (TERMINAL_EXECUTION_STATES.has(execution.state)) {
      const hardEvidence = Boolean(liveOrder || (livePosition && livePosition.quantity > 0));
      if (!hardEvidence) return;
      if (execution.entry.orderId && !liveOrder && !livePosition) return;
      // Avoid double-adoption when the same exchange position is already bound
      // to a different, still-active execution.
      if (livePosition?.positionId && allPositions.some((p) => p.positionId === livePosition.positionId && p.executionId !== execution.id)) return;
      await this.activateFromExchange(execution, position, liveOrder, livePosition, summary, adopted, true);
      return;
    }

    if (execution.state !== "PENDING_ENTRY" && !ACTIVE_EXECUTION_STATES.has(execution.state)) return;

    // Missing entry ref & the exchange knows the order / has a position → adopt.
    if (liveOrder || (!execution.entry.orderId && livePosition && livePosition.quantity > 0)) {
      await this.adoptEntry(execution, position, liveOrder, livePosition, summary, adopted);
      return;
    }

    // Entry already recorded but the exchange position id / fill details are
    // not yet synced — fill them in so close accounting has real data.
    if (livePosition && livePosition.quantity > 0 && position) {
      await this.adoptPositionData(execution, position, livePosition, summary, adopted);
    }
  }

  /**
   * Wire a live exchange order/position back into an execution (either an
   * active one missing refs, or a terminal one being reactivated).
   */
  private async activateFromExchange(
    execution: ExecutionRecord,
    position: PositionRecord | null,
    liveOrder: ExchangeOrder | null,
    livePosition: LivePositionLike | null,
    summary: ReconcileSnapshot,
    adopted: Set<string>,
    wasTerminal: boolean,
  ): Promise<void> {
    if (liveOrder && !execution.entry.orderId) {
      await this.execution.updateEntryRef(execution.id, {
        orderId: liveOrder.orderId ?? null,
        clientOrderId: liveOrder.clientOrderId ?? null,
        status: liveOrder.status ?? null,
      }).catch(() => null);
      execution.entry.orderId = liveOrder.orderId;
      execution.entry.clientOrderId = liveOrder.clientOrderId;
      summary.entryOrdersAdopted += 1;
    }

    const pos = await this.ensurePosition(execution, position);
    if (!pos) return;

    const orderKind = classifyStatus(liveOrder?.status);
    if (liveOrder && (orderKind === "FILLED" || orderKind === "PARTIAL")) {
      const filled = toNum(rawOf(liveOrder).exec_quantity ?? rawOf(liveOrder).filled_quantity) ?? livePosition?.quantity ?? null;
      const entryPrice = toNum(rawOf(liveOrder).avg_execution_price ?? rawOf(liveOrder).avg_price) ?? livePosition?.entryPrice ?? null;
      await this.positions.updateEntry(pos.id, entryPrice ?? pos.entryPrice, filled ?? pos.filledQuantity, livePosition?.positionId ?? pos.positionId, liveOrder.orderId ?? pos.entryOrderId).catch(() => null);
      await this.persistFill(pos.id, execution.id, filled, execution.quantity, entryPrice);
      await this.execution.updateState(execution.id, orderKind === "PARTIAL" ? "PARTIALLY_FILLED" : "ENTRY_FILLED").catch(() => null);
      await this.positions.updateState(pos.id, "ENTRY_EXECUTED").catch(() => null);
      if (livePosition?.positionId) {
        await this.execution.updatePositionRef(execution.id, livePosition.positionId).catch(() => null);
        adopted.add(livePosition.positionId);
      }
    } else if (liveOrder && orderKind === "CANCELLED") {
      await this.positions.updateState(pos.id, "CLOSED").catch(() => null);
      await this.positions
        .recordCloseSummary({ position: pos, exitPrice: null, reason: "ENTRY_CANCELLED", realizedPnl: 0, fees: 0, entryPrice: null })
        .catch(() => null);
      await this.execution.updateState(execution.id, "CANCELLED", `entry order ${liveOrder.status} (reconciliation)`).catch(() => null);
      return;
    } else {
      // Resting / unknown — the order is still on the exchange; keep it open
      // and hand it to the Position Manager. NEVER cancel, never treat as filled.
      await this.positions.updateState(pos.id, "ENTRY_PENDING").catch(() => null);
      if (wasTerminal) await this.execution.updateState(execution.id, "MONITORING_ENTRY").catch(() => null);
    }

    if (livePosition && livePosition.quantity > 0) {
      await this.adoptPositionData(execution, pos, livePosition, summary, adopted);
    }

    if (wasTerminal && (liveOrder || livePosition)) {
      await this.saveEvent(
        pos,
        "RECOVERY_ORDER_REACTIVATED",
        `execution ${execution.id} was locally ${execution.state} but ${liveOrder ? `order ${liveOrder.orderId}` : `position ${livePosition?.positionId ?? livePosition?.symbol}`} is live on the exchange — re-activated so the Position Manager keeps managing it.`,
      );
      summary.reactivatedTerminalExecutions += 1;
    }
  }

  private async adoptEntry(
    execution: ExecutionRecord,
    position: PositionRecord | null,
    liveOrder: ExchangeOrder | null,
    livePosition: LivePositionLike | null,
    summary: ReconcileSnapshot,
    adopted: Set<string>,
  ): Promise<void> {
    if (liveOrder && !execution.entry.orderId) {
      await this.execution.updateEntryRef(execution.id, {
        orderId: liveOrder.orderId ?? null,
        clientOrderId: liveOrder.clientOrderId ?? null,
        status: liveOrder.status ?? null,
      }).catch(() => null);
      execution.entry.orderId = liveOrder.orderId;
      execution.entry.clientOrderId = liveOrder.clientOrderId;
      execution.entry.status = liveOrder.status ?? null;
      summary.entryOrdersAdopted += 1;
    }

    const pos = await this.ensurePosition(execution, position);
    if (!pos) return;

    await this.positions.updateEntry(pos.id, pos.entryPrice, pos.filledQuantity, pos.positionId, liveOrder?.orderId ?? pos.entryOrderId).catch(() => null);

    const orderKind = classifyStatus(liveOrder?.status);
    if (liveOrder && (orderKind === "FILLED" || orderKind === "PARTIAL")) {
      const filled = toNum(rawOf(liveOrder).exec_quantity ?? rawOf(liveOrder).filled_quantity) ?? livePosition?.quantity ?? null;
      const entryPrice = toNum(rawOf(liveOrder).avg_execution_price ?? rawOf(liveOrder).avg_price) ?? livePosition?.entryPrice ?? null;
      await this.persistFill(pos.id, execution.id, filled, execution.quantity, entryPrice);
      await this.execution.updateState(execution.id, orderKind === "PARTIAL" ? "PARTIALLY_FILLED" : "ENTRY_FILLED").catch(() => null);
      await this.positions.updateState(pos.id, "ENTRY_EXECUTED").catch(() => null);
    } else if (liveOrder && orderKind === "CANCELLED") {
      await this.positions.updateState(pos.id, "CLOSED").catch(() => null);
      await this.positions
        .recordCloseSummary({ position: pos, exitPrice: null, reason: "ENTRY_CANCELLED", realizedPnl: 0, fees: 0, entryPrice: null })
        .catch(() => null);
      await this.execution.updateState(execution.id, "CANCELLED", `entry order ${liveOrder.status} (reconciliation)`).catch(() => null);
      return;
    } else {
      await this.positions.updateState(pos.id, "ENTRY_PENDING").catch(() => null);
      if (execution.state === "PENDING_ENTRY") {
        await this.execution.updateState(execution.id, "MONITORING_ENTRY").catch(() => null);
      }
    }

    if (livePosition && livePosition.quantity > 0) {
      await this.adoptPositionData(execution, pos, livePosition, summary, adopted);
    }

    await this.saveEvent(
      pos,
      "RECOVERY_ENTRY_ORDER_RECOVERED",
      `entry order ${liveOrder?.orderId ?? "unknown"} recovered from the exchange into execution ${execution.id} (status ${liveOrder?.status ?? "unknown"})`,
    );
  }

  /** Fill in position_id / entry price / filled quantity from the live exchange position. */
  private async adoptPositionData(
    execution: ExecutionRecord,
    position: PositionRecord,
    livePosition: LivePositionLike,
    summary: ReconcileSnapshot,
    adopted: Set<string>,
  ): Promise<void> {
    const positionId = livePosition.positionId ?? position.positionId;
    if (positionId && !adopted.has(positionId)) adopted.add(positionId);
    if (livePosition.positionId) {
      await this.execution.updatePositionRef(execution.id, livePosition.positionId).catch(() => null);
    }
    await this.positions.updateEntry(
      position.id,
      livePosition.entryPrice ?? position.entryPrice,
      livePosition.quantity ?? position.filledQuantity,
      positionId,
      position.entryOrderId,
    ).catch(() => null);
    await this.persistFill(position.id, execution.id, livePosition.quantity, execution.quantity, livePosition.entryPrice);
    await this.positions.updateState(position.id, "ENTRY_EXECUTED").catch(() => null);
    if (execution.state === "PENDING_ENTRY" || execution.state === "MONITORING_ENTRY") {
      const isPartial = execution.quantity != null && livePosition.quantity != null && livePosition.quantity < execution.quantity;
      await this.execution.updateState(execution.id, isPartial ? "PARTIALLY_FILLED" : "ENTRY_FILLED").catch(() => null);
    }
    summary.positionsAdopted += 1;
    await this.saveEvent(
      position,
      "RECOVERY_POSITION_ADOPTED",
      `exchange position ${livePosition.positionId ?? livePosition.symbol} adopted into execution ${execution.id} (qty ${livePosition.quantity}, entry ${livePosition.entryPrice ?? "n/a"})`,
    );
  }

  private async persistFill(positionId: number, executionId: number, filled: number | null, planned: number | null, avgEntryPrice: number | null) {
    const remaining = filled != null && planned != null ? Math.max(0, planned - filled) : null;
    await this.positions.updateFillQuantities(positionId, filled, remaining).catch(() => null);
    await this.execution.updateFill(executionId, filled, remaining, avgEntryPrice).catch(() => null);
  }

  /** Create the position row if one does not exist yet for the execution. */
  private async ensurePosition(execution: ExecutionRecord, existing: PositionRecord | null): Promise<PositionRecord | null> {
    if (existing) return existing;
    try {
      const id = await this.positions.createPosition(execution, this.config);
      return await this.positions.getPosition(id);
    } catch {
      return null;
    }
  }

  /** Back-fill missing SL/TP refs for a position from reduce-only open orders matching the stored trigger prices. */
  private async backfillProtectiveRefs(position: PositionRecord, openOrders: ExchangeOrder[]): Promise<number> {
    const opposite = position.side === "BUY" ? "SELL" : "BUY";
    let backfilled = 0;

    for (const order of openOrders) {
      const raw = rawOf(order);
      const orderSide = String(raw.side ?? "").toUpperCase();
      if (orderSide !== opposite || !isReduceOnly(raw) || !order.orderId) continue;
      const orderType = String(raw.order_type ?? raw.type ?? "").toUpperCase();
      const trigger = toNum(raw.trigger_price ?? raw.triggerPrice);

      if (!position.stopLossOrderId && orderType.includes("STOP") && matchesTriggerPrice(trigger, position.stopLoss)) {
        await this.positions.updateProtection(position.id, order.orderId, position.takeProfitOrderId).catch(() => null);
        await this.execution.updateProtectiveRef(position.executionId, "sl", {
          orderId: order.orderId,
          clientOrderId: order.clientOrderId ?? null,
          status: order.status ?? null,
        }).catch(() => null);
        backfilled += 1;
      } else if (
        !position.takeProfitOrderId &&
        (orderType.includes("PROFIT") || orderType.includes("LIMIT")) &&
        matchesTriggerPrice(trigger, position.takeProfit)
      ) {
        await this.positions.updateProtection(position.id, position.stopLossOrderId, order.orderId).catch(() => null);
        await this.execution.updateProtectiveRef(position.executionId, "tp", {
          orderId: order.orderId,
          clientOrderId: order.clientOrderId ?? null,
          status: order.status ?? null,
        }).catch(() => null);
        backfilled += 1;
      }
    }
    if (backfilled > 0) {
      await this.saveEvent(
        position,
        "RECOVERY_PROTECTIVE_RECOVERED",
        `back-filled ${backfilled} protective order ref(s) from the exchange for position ${position.id}`,
      );
    }
    return backfilled;
  }

  private async saveEvent(position: PositionRecord, type: string, message: string) {
    await this.positions
      .saveEvent({
        userId: position.userId,
        botId: position.botId,
        executionId: position.executionId,
        positionId: position.id,
        type,
        message,
      })
      .catch(() => null);
  }
}

export const exchangeReconciler = new ExchangeReconciler(coinswitchClient);