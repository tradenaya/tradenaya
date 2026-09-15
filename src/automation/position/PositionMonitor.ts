import { ExecutionStore } from "@/automation/executor/store";
import type { ExecutionNotification } from "@/automation/executor/types";
import type { CloseDetectionResult, PositionManagerConfig, PositionRecord, PositionSnapshot, PositionSyncSummary } from "./PositionManagerTypes";
import { PositionStateManager } from "./PositionStateManager";
import { PositionPnLCalculator } from "./PositionPnLCalculator";
import { ProtectionValidator } from "./ProtectionValidator";
import { TPMonitor } from "./TPMonitor";
import { SLMonitor } from "./SLMonitor";
import { TrailingStopManager } from "./TrailingStopManager";
import { PositionRecovery } from "./PositionRecovery";
import { PositionStore } from "./PositionStore";
import { ProtectiveOrdersService } from "@/automation/executor/services/protective-orders";
import { coinswitchClient, CoinSwitchClient, type ExchangeOrder, type ExchangePosition } from "@/automation/executor/client";
import { classifyStatus } from "@/automation/executor/order-status";
import { reconcileClose } from "./close-accounting";
import { BotLifecycleService } from "@/automation/service/bot-lifecycle";
import { executionStore } from "@/automation/executor/store";
import { confirmExternalClose, detectExecutedClose, detectLiquidation } from "./executed-close";
import { evaluateEntryValidity } from "./EntryValidity";
import { serverMarketDataService } from "@/automation/market/service";
import { normalizeInterval } from "@/automation/market/normalizer";
import { liveActivityHub } from "@/automation/scheduler/LiveActivityHub";
import { dispatchTelegram } from "@/lib/telegram-dispatch";
import {
  telegramTakeProfit,
  telegramStopLoss,
  telegramManualClose,
  telegramPositionClosed,
  telegramUnprotected,
} from "@/lib/telegram";

const ACTIVE_STATES = new Set(["WAITING_ENTRY", "ENTRY_PENDING", "ENTRY_EXECUTED", "PROTECTED", "TRAILING", "UNPROTECTED", "CLOSING"]);
const ENTRY_VISIBILITY_GRACE_MS = 10 * 60_000;
const ENTRY_VALIDITY_INTERVAL_MS = 60_000;

export class PositionMonitor {
  private readonly store: PositionStore;
  private readonly stateManager: PositionStateManager;
  private readonly pnl: PositionPnLCalculator;
  private readonly protection: ProtectionValidator;
  private readonly tpm: TPMonitor;
  private readonly slm: SLMonitor;
  private readonly trailing: TrailingStopManager;
  private readonly recovery: PositionRecovery;
  private readonly botState: BotLifecycleService;
  private readonly executionStore: ExecutionStore;
  private readonly config: PositionManagerConfig;
  private readonly protective: ProtectiveOrdersService;
  private readonly lastValidityCheck = new Map<number, number>();

  private timer: NodeJS.Timeout | null = null;
  private processing = new Set<number>();
  private running = false;

  constructor(
    private readonly client: CoinSwitchClient = coinswitchClient,
    config: PositionManagerConfig = {},
  ) {
    this.config = config;
    this.store = new PositionStore();
    this.executionStore = executionStore;
    this.stateManager = new PositionStateManager();
    this.pnl = new PositionPnLCalculator();
    this.protection = new ProtectionValidator();
    this.tpm = new TPMonitor(client);
    this.slm = new SLMonitor(client);
    this.protective = new ProtectiveOrdersService(client, this.executionStore);
    this.botState = new BotLifecycleService();
    this.trailing = new TrailingStopManager(client, this.store);
    this.recovery = new PositionRecovery(client, this.store, this.executionStore, this.protective, this.config);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.recovery.recoverAllActive();
    this.timer = setInterval(() => void this.tick().catch((e) => console.error("PositionMonitor tick error", e)), this.config.pollIntervalMs ?? 5000);
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Shutdown must NEVER close an open position or cancel SL/TP orders.
    // Exchange-side protective orders are independent of this server and remain
    // active on CoinSwitch after this process exits.
  }

  /**
   * Revives the monitor if it was never started (e.g. the module was hot
   * reloaded in dev and instrumentation.register() did not re-run). This keeps
   * position management active after a restart so active positions keep being
   * reconciled instead of being assumed finished.
   */
  async ensureStarted(): Promise<void> {
    if (!this.running) await this.start();
  }

  /**
   * Manual exchange→DB reconciliation sweep, exposed to the "Sync Exchange"
   * button / API endpoint. Waits for the monitor loop to be up, then runs the
   * exact same recovery pass as the boot-time sweep and returns what changed.
   * Idempotent: an already-consistent position is verified and left untouched.
   */
  async syncFromExchange(): Promise<PositionSyncSummary> {
    await this.ensureStarted();
    return await this.recovery.recoverAllActive();
  }

  async tick(): Promise<void> {
    if (!this.running && this.timer === null) return;
    await this.recovery.syncNewExecutions();
    const positions = await this.store.getActivePositions();
    for (const position of positions) {
      if (this.processing.has(position.id)) continue;
      this.processing.add(position.id);
      void this.process(position).finally(() => this.processing.delete(position.id));
    }

    // A persistence failure can leave a live tracked position in ERROR. Re-run
    // exchange→DB reconciliation on those positions every cycle so they never
    // permanently fall outside the recovery window and self-heal without a
    // restart.
    const recoverable = await this.store.getRecoverablePositions();
    for (const position of recoverable) {
      if (position.state !== "ERROR" || this.processing.has(position.id)) continue;
      this.processing.add(position.id);
      void this.recovery.reconcile(position).catch(() => null).finally(() => this.processing.delete(position.id));
    }
  }

  private async process(position: PositionRecord): Promise<void> {
    if (!ACTIVE_STATES.has(position.state)) return;

    try {
      const snapshot = await this.buildSnapshot(position);
      const pnl = await this.pnl.compute(snapshot);
      await this.store.updatePrices(position.id, snapshot.currentPrice, pnl.unrealizedPnl);

      if (snapshot.position.state === "ENTRY_PENDING") {
        await this.handleEntryPending(snapshot);
        return;
      }

      if (snapshot.position.state === "WAITING_ENTRY") {
        await this.stateManager.transition(position.id, "WAITING_ENTRY", "ENTRY_PENDING");
        return;
      }

      await this.handleOpenPosition(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.stateManager.markError(position.id, message);
      await this.store.saveEvent({
        userId: position.userId,
        botId: position.botId,
        executionId: position.executionId,
        positionId: position.id,
        type: "MONITOR_ERROR",
        message,
      });
    }
  }

  private async buildSnapshot(position: PositionRecord): Promise<PositionSnapshot> {
    const [exchangeRead, ordersRead, price] = await Promise.all([
      this.client.getPositions(position.userId, position.symbol)
        .then((data) => ({ ok: true as const, data }))
        .catch(() => ({ ok: false as const, data: [] as ExchangePosition[] })),
      this.client.getOpenOrders(position.userId, position.symbol)
        .then((data) => ({ ok: true as const, data }))
        .catch(() => ({ ok: false as const, data: [] as ExchangeOrder[] })),
      this.client.getCurrentPrice(position.userId, position.symbol).catch(() => null),
    ]);

    const positionsReadFailed = !exchangeRead.ok;
    const openOrdersReadFailed = !ordersRead.ok;
    const live = positionsReadFailed
      ? null
      : exchangeRead.data.find((p) => p.symbol.toLowerCase() === position.symbol.toLowerCase()) ?? null;

    const execution = await this.executionStore.getExecution(position.executionId).catch(() => null);
    if (execution) {
      const slOrderId = execution.stopLossOrder.orderId;
      const tpOrderId = execution.takeProfitOrder.orderId;
      const entryOrderId = execution.entry.orderId;
      if ((slOrderId && slOrderId !== position.stopLossOrderId) || (tpOrderId && tpOrderId !== position.takeProfitOrderId) || (entryOrderId && entryOrderId !== position.entryOrderId)) {
        await this.store.updateEntry(
          position.id,
          position.entryPrice,
          position.filledQuantity,
          position.positionId,
          entryOrderId ?? position.entryOrderId,
        );
        await this.store.updateProtection(position.id, slOrderId ?? position.stopLossOrderId, tpOrderId ?? position.takeProfitOrderId);
        position.entryOrderId = entryOrderId ?? position.entryOrderId;
        position.stopLossOrderId = slOrderId ?? position.stopLossOrderId;
        position.takeProfitOrderId = tpOrderId ?? position.takeProfitOrderId;
      }
    }

    // Keep the entry price/fill synced from the exchange position so realized
    // PnL at close is always computable even if the close happens in the gap
    // between polls (exchange position may already be gone by then).
    if (live) {
      await this.store.updateEntry(
        position.id,
        live.entryPrice ?? position.entryPrice,
        live.quantity ?? position.filledQuantity,
        live.positionId ?? position.positionId,
        position.entryOrderId,
      );
      if (live.entryPrice) position.entryPrice = live.entryPrice;
      if (live.quantity != null) position.filledQuantity = live.quantity;
      if (live.positionId) position.positionId = live.positionId;
    }

    return { position, currentPrice: price, exchangePosition: live, openOrders: ordersRead.data, positionsReadFailed, openOrdersReadFailed };
  }

  private async handleEntryPending(snapshot: PositionSnapshot): Promise<void> {
    const { position } = snapshot;
    const orderId = position.entryOrderId;
    if (!orderId) {
      await this.log(position, "WAITING_ENTRY", "entry order not yet submitted; staying in ENTRY_PENDING");
      return;
    }

    const execution = await this.executionStore.getExecution(position.executionId).catch(() => null);
    const order = await this.client.getOrderStatus(position.userId, orderId).catch(() => null);
    const status = order?.status ?? "";
    const kind = classifyStatus(order?.status);
    const open = kind === "OPEN" || kind === "UNKNOWN";

    if (kind === "FILLED") {
      // Full fill — the order is done and the position is open for the full quantity.
      const entryPrice = snapshot.exchangePosition?.entryPrice ?? order?.raw?.avg_execution_price ?? order?.raw?.avg_price ?? null;
      const filledQuantity = this.filledQuantityFromOrder(order, snapshot);
      await this.store.updateEntry(position.id, entryPrice, filledQuantity ?? snapshot.exchangePosition?.quantity ?? null, snapshot.exchangePosition?.positionId ?? null, orderId);
      // Full fill → no resting remainder; persist the split + avg fill price.
      await this.store.updateFillQuantities(position.id, filledQuantity ?? snapshot.exchangePosition?.quantity ?? null, 0);
      if (filledQuantity != null) await this.executionStore.updateFill(position.executionId, filledQuantity, 0, entryPrice);
      await this.executionStore.updateState(position.executionId, "ENTRY_FILLED");
      await this.stateManager.transition(position.id, "ENTRY_PENDING", "ENTRY_EXECUTED");
      await this.log(position, "ENTRY_EXECUTED", `entry order ${orderId} filled (${filledQuantity ?? "n/a"})`);
    } else if (kind === "PARTIAL") {
      // Partial fill: a position exists for the filled portion while the
      // remainder keeps resting. Track the ACTUAL filled quantity and the
      // remaining quantity instead of treating the order as fully filled; the
      // remainder continues to be monitored to fill/expiry (handleOpenPosition).
      const filledQuantity = this.filledQuantityFromOrder(order, snapshot);
      const quantity = execution?.quantity ?? position.quantity ?? snapshot.exchangePosition?.quantity ?? null;
      const remainingQuantity = filledQuantity != null && quantity != null ? Math.max(0, quantity - filledQuantity) : null;
      const entryPrice = snapshot.exchangePosition?.entryPrice ?? order?.raw?.avg_execution_price ?? order?.raw?.avg_price ?? null;
      await this.store.updateEntry(position.id, entryPrice, filledQuantity ?? snapshot.exchangePosition?.quantity ?? null, snapshot.exchangePosition?.positionId ?? null, orderId);
      await this.store.updateFillQuantities(position.id, filledQuantity ?? snapshot.exchangePosition?.quantity ?? null, remainingQuantity);
      if (filledQuantity != null) await this.executionStore.updateFill(position.executionId, filledQuantity, remainingQuantity, entryPrice);
      await this.executionStore.updateState(position.executionId, "PARTIALLY_FILLED");
      await this.stateManager.transition(position.id, "ENTRY_PENDING", "ENTRY_EXECUTED");
      await this.log(position, "PARTIAL_EXECUTION", `entry order ${orderId} partially filled: ${filledQuantity ?? "n/a"}${remainingQuantity != null ? ` (${remainingQuantity} remaining — remainder stays resting until fill or expiry)` : ""}`);
    } else if (kind === "CANCELLED") {
      await this.closeUnfilledEntry(position, `entry order ${status}`);
    } else if (open) {
      // Configured expiry first (deterministic, orderExpiryMinutes persisted as
      // expires_at); only then the existing adaptive EntryValidity rules.
      if (this.restingEntryExpired(position, execution)) {
        const cancelled = await this.client.cancelOrder(position.userId, orderId).catch(() => false);
        if (cancelled) {
          await this.closeUnfilledEntry(position, "entry order expired (configured orderExpiryMinutes elapsed)");
          liveActivityHub.publish({
            botId: position.botId,
            userId: position.userId,
            symbol: position.symbol,
            phase: "lifecycle",
            message: `Resting entry expired after the configured orderExpiryMinutes and was cancelled. Re-planning on next cycle.`,
          });
        } else {
          await this.log(position, "ENTRY_EXPIRY", `cancel failed on expiry — will re-check on the next validity cycle`);
        }
        return;
      }

      const reason = await this.entryInvalidReason(position, snapshot.currentPrice);
      if (!reason) return;
      const cancelled = await this.client.cancelOrder(position.userId, orderId).catch(() => false);
      if (cancelled) {
        await this.closeUnfilledEntry(position, reason);
        liveActivityHub.publish({
          botId: position.botId,
          userId: position.userId,
          symbol: position.symbol,
          phase: "lifecycle",
          message: `Resting entry cancelled — ${reason}. Re-planning on next cycle.`,
        });
      } else {
        await this.log(position, "ENTRY_EXPIRY", `cancel failed — ${reason}; will re-check on the next validity cycle`);
      }
    }
  }

  /**
   * Cancel a still-resting ENTRY order remainder once its configured expiry
   * (orderExpiryMinutes → expires_at) is reached. This covers partial fills:
   * the position for the filled portion is already being managed, but the
   * unfilled remainder must not sit on the exchange forever — it is cancelled
   * exactly at the configured expiry like any other resting LIMIT entry.
   */
  private async expireRestingEntryRemainder(snapshot: PositionSnapshot): Promise<void> {
    const { position } = snapshot;
    const orderId = position.entryOrderId;
    if (!orderId) return;

    const execution = await this.executionStore.getExecution(position.executionId).catch(() => null);
    if (!execution?.expiresAt || Date.now() < execution.expiresAt) return;

    const order = await this.client.getOrderStatus(position.userId, orderId).catch(() => null);
    const kind = classifyStatus(order?.status);
    if (kind === "FILLED" || kind === "CANCELLED") return;

    const cancelled = await this.client.cancelOrder(position.userId, orderId).catch(() => false);
    if (cancelled) {
      await this.log(position, "ENTRY_EXPIRY", `entry order remainder expired after the configured orderExpiryMinutes and was cancelled (remaining ${this.remainingQuantity(position, execution) ?? "n/a"})`);
    } else {
      await this.log(position, "ENTRY_EXPIRY", `expiry cancel failed for entry order remainder ${orderId}; will retry`);
    }
  }

  /** Total order quantity minus the actual filled quantity, when both are known. */
  private remainingQuantity(position: PositionRecord, execution: import("@/automation/executor/types").ExecutionRecord | null): number | null {
    const quantity = execution?.quantity ?? position.quantity ?? null;
    const filled = position.filledQuantity ?? null;
    return quantity != null && filled != null ? Math.max(0, quantity - filled) : null;
  }

  /** Actual executed quantity reported by the exchange for the entry order. */
  private filledQuantityFromOrder(order: { raw?: unknown } | null, snapshot: PositionSnapshot): number | null {
    const raw = (order?.raw ?? {}) as Record<string, unknown>;
    const value = raw.exec_quantity ?? raw.filled_quantity ?? raw.executed_quantity;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    return snapshot.exchangePosition?.quantity ?? null;
  }

  private restingEntryExpired(position: PositionRecord, execution: import("@/automation/executor/types").ExecutionRecord | null): boolean {
    if (!execution?.expiresAt) return false;
    return Date.now() >= execution.expiresAt;
  }

  /**
   * Re-validates a resting entry against live market conditions every
   * ENTRY_VALIDITY_INTERVAL_MS. Null when the entry should keep resting;
   * otherwise the reason it must be cancelled.
   */
  private async entryInvalidReason(position: PositionRecord, marketPrice: number | null): Promise<string | null> {
    const now = Date.now();
    const last = this.lastValidityCheck.get(position.id) ?? 0;
    if (now - last < ENTRY_VALIDITY_INTERVAL_MS) return null;
    this.lastValidityCheck.set(position.id, now);

    const execution = await this.executionStore.getExecution(position.executionId).catch(() => null);
    const limitPrice = execution?.limitPrice ?? null;

    const bot = await this.botState.getBotById(position.botId).catch(() => null);
    let timeframe = 5;
    let driftAtr: number | undefined;
    let maxCandles: number | undefined;
    let hardCapCandles: number | undefined;
    let regimeTolerancePct: number | undefined;
    if (bot?.configJson) {
      try {
        const parsed = JSON.parse(bot.configJson) as Record<string, unknown>;
        const minutes = normalizeInterval((parsed.timeframe ?? "5m") as string | number);
        if (minutes != null && minutes > 0) timeframe = minutes;
        driftAtr = parsed.driftAtr != null ? Number(parsed.driftAtr) : undefined;
        maxCandles = parsed.maxCandles != null ? Number(parsed.maxCandles) : undefined;
        hardCapCandles = parsed.hardCapCandles != null ? Number(parsed.hardCapCandles) : undefined;
        regimeTolerancePct = parsed.regimeTolerancePct != null ? Number(parsed.regimeTolerancePct) : undefined;
      } catch {
        // keep the 5m default / undefined
      }
    }

    const candles = await serverMarketDataService
      .getCandles(position.userId, position.symbol, String(timeframe), { limit: 120 })
      .catch(() => []);
    if (candles.length === 0) return null;

    const htfMinutes = Math.min(Math.max(timeframe * 3, 15), 240);
    const higherTimeframeCandles = htfMinutes === timeframe
      ? undefined
      : await serverMarketDataService
          .getCandles(position.userId, position.symbol, String(htfMinutes), { limit: 120 })
          .catch(() => []);

    const resolvedPrice = marketPrice ?? candles[candles.length - 1]?.close ?? null;
    if (resolvedPrice == null) return null;

    const result = evaluateEntryValidity({
      side: position.side,
      limitPrice,
      stopLoss: position.stopLoss,
      marketPrice: resolvedPrice,
      ageMs: now - new Date(position.createdAt).getTime(),
      timeframeMinutes: timeframe,
      candles,
      higherTimeframeCandles: higherTimeframeCandles && higherTimeframeCandles.length > 0 ? higherTimeframeCandles : undefined,
      driftAtr: driftAtr,
      maxCandles: maxCandles,
      hardCapCandles: hardCapCandles,
      regimeTolerancePct: regimeTolerancePct,
    });
    if (result.keep) return null;
    await this.log(position, "ENTRY_CANCELLED", result.reason ?? "entry invalidated by live market conditions");
    return result.reason ?? "entry invalidated";
  }

  private async closeUnfilledEntry(position: PositionRecord, detail: string): Promise<void> {
    await this.stateManager.transition(position.id, "ENTRY_PENDING", "CLOSED", detail);
    await this.store.recordCloseSummary({
      position,
      exitPrice: null,
      reason: "ENTRY_CANCELLED",
      realizedPnl: 0,
      fees: 0,
      entryPrice: null,
    });
    await this.executionStore.updateState(position.executionId, "CANCELLED", detail);
    await this.releaseBot(position);
  }

  private async handleOpenPosition(snapshot: PositionSnapshot): Promise<void> {
    const { position } = snapshot;

    await this.expireRestingEntryRemainder(snapshot);

    if (position.state === "CLOSING") {
      const current = await this.store.getPosition(position.id);
      if (current && current.state === "CLOSING") {
        const close: CloseDetectionResult = {
          shouldClose: true,
          reason: current.exitReason ?? "MANUAL_CLOSE",
          exitPrice: current.exitPrice ?? snapshot.currentPrice ?? null,
          detail: "resuming close after restart",
        };
        await this.finalizeClose(snapshot, close);
      }
      return;
    }

    const protection = await this.protection.validate(snapshot);
    const hasLivePosition = Boolean(snapshot.exchangePosition);

    await this.detectPartialExecution(snapshot);

    if (!hasLivePosition && snapshot.positionsReadFailed) {
      await this.log(position, "POSITION_READ_FAILED", "exchange position read failed — cannot confirm the position is gone; keeping it open and will retry");
      return;
    }

    if (!hasLivePosition && position.state === "ENTRY_EXECUTED") {
      // The entry filled but the position is not (yet) visible on the exchange.
      // If a protective order already executed we can close out immediately;
      // otherwise wait up to a grace window so we never close a position that
      // is just slow to appear.
      const closing = await detectExecutedClose(this.client, position.userId, position);
      if (closing) {
        await this.finalizeClose(snapshot, {
          shouldClose: true,
          reason: closing.reason,
          exitPrice: closing.price ?? snapshot.currentPrice ?? null,
          detail: `protective order executed: ${closing.reason}`,
        });
        return;
      }
      const ageMs = Date.now() - new Date(position.createdAt).getTime();
      if (ageMs > ENTRY_VISIBILITY_GRACE_MS) {
        // Only finalize once we can CONFIRM the position really closed (ledger
        // realized P&L or a terminal protective order). Never fabricate a
        // MANUAL_CLOSE for a position that might still be open / slow to read.
        const confirmed = await confirmExternalClose(this.client, position.userId, position);
        if (confirmed.confirmed) {
          await this.finalizeClose(snapshot, {
            shouldClose: true,
            reason: confirmed.reason ?? "MANUAL_CLOSE",
            exitPrice: confirmed.price ?? snapshot.currentPrice ?? null,
            detail: "entry executed but position never appeared on exchange (close confirmed)",
          });
          return;
        }
        await this.log(position, "WAITING_POSITION", "entry executed but position not visible; close unconfirmed — keeping open and retrying");
        return;
      }
      await this.log(position, "WAITING_POSITION", "entry executed but position not yet visible on exchange");
      return;
    }

    if (!hasLivePosition) {
      await this.handleManualClose(snapshot);
      return;
    }

    if (!protection.valid) {
      if (snapshot.openOrdersReadFailed) {
        await this.log(position, "ORDERS_READ_FAILED", "open orders read failed — cannot verify protection; skipping re-protection until reads succeed");
        return;
      }
      const wasProtected = position.state === "PROTECTED" || position.state === "TRAILING" || position.state === "ENTRY_EXECUTED";
      if (wasProtected && (await this.stateManager.transition(position.id, position.state, "UNPROTECTED", protection.issues.join("; ")))) {
        await this.log(position, "UNPROTECTED", `position unprotected: ${protection.issues.join("; ")}`);
        await this.notify(position, "POSITION_UNPROTECTED", `position ${position.symbol} is UNPROTECTED: ${protection.issues.join("; ")}`);
        void dispatchTelegram(`exec:${position.executionId}:unprotected`, "POSITION_UNPROTECTED", telegramUnprotected({
          symbol: position.symbol,
          reason: protection.issues.join("; "),
        }));
      }

      await this.log(position, "UNPROTECTED", `protection missing: ${protection.issues.join("; ")}`);
      const recovered = await this.recovery.emergencyProtect(position.executionId);
      if (recovered) {
        const fresh = await this.store.getPosition(position.id);
        const from = fresh?.state ?? "UNPROTECTED";
        await this.stateManager.transition(position.id, from, "PROTECTED");
        await this.log(position, "PROTECTED", "emergency protection placed");
      } else {
        await this.log(position, "EMERGENCY_FAILED", "emergency protection failed");
      }
      return;
    }

    const fresh = await this.store.getPosition(position.id);
    if (!fresh) return;
    position.state = fresh.state;

    if (position.state === "UNPROTECTED" || position.state === "ENTRY_EXECUTED") {
      await this.stateManager.transition(position.id, position.state, "PROTECTED");
      position.state = "PROTECTED";
    }

    const close = await this.detectClose(snapshot);
    if (close.shouldClose) {
      await this.finalizeClose(snapshot, close);
      return;
    }

    await this.syncTrailing(snapshot);
  }

  private async detectPartialExecution(snapshot: PositionSnapshot): Promise<void> {
    const { position, exchangePosition } = snapshot;
    if (!exchangePosition) return;

    const expected = position.filledQuantity ?? position.quantity;
    if (!expected) return;
    const actual = exchangePosition.quantity;
    if (actual < expected) {
      await this.log(
        position,
        "PARTIAL_EXECUTION",
        `position partially filled: expected ${expected}, got ${actual}`,
      );
    }
  }

  private async detectClose(snapshot: PositionSnapshot): Promise<CloseDetectionResult> {
    const tp = await this.tpm.check(snapshot);
    if (tp.shouldClose) return tp;
    const sl = await this.slm.check(snapshot);
    return sl;
  }

  private async handleManualClose(snapshot: PositionSnapshot): Promise<void> {
    const { position } = snapshot;

    const tp = await this.tpm.check(snapshot);
    if (tp.shouldClose) {
      await this.finalizeClose(snapshot, tp);
      return;
    }
    const sl = await this.slm.check(snapshot);
    if (sl.shouldClose) {
      await this.finalizeClose(snapshot, sl);
      return;
    }

    // The read succeeded (positionsReadFailed was checked by the caller) and
    // returned no live position, but neither SL nor TP reports as filled. This
    // is a strong indication the position was closed externally (manual close
    // or liquidation). Confirm via the transaction ledger / protective status
    // before booking the close so we never falsely close a position that is
    // merely slow or undergoing a transient exchange read issue.
    const confirmed = await confirmExternalClose(this.client, position.userId, position);
    if (!confirmed.confirmed) {
      await this.log(position, "POSITION_READ_FAILED", "position not returned by exchange but close could not be confirmed — keeping open and retrying");
      return;
    }

    let reason: CloseDetectionResult["reason"] = confirmed.reason ?? "MANUAL_CLOSE";
    let exitPrice: number | null = confirmed.price ?? snapshot.currentPrice ?? snapshot.exchangePosition?.markPrice ?? null;
    let closeDetail = "position closed externally on exchange";
    let closedAtMs: number | null = confirmed.closedAtMs;

    // Liquidation forensic check: an unclassified close whose live price has
    // already traded past the estimated liquidation boundary (or whose realized
    // P&L wiped the full margin) was an exchange LIQUIDATION, not a manual
    // close. Book it honestly so analytics reflect the true failure mode (an SL
    // beyond the liquidation boundary is the classic "placeholder stop" that can
    // never execute and silently drains the account as price blows through it).
    if (reason === "MANUAL_CLOSE") {
      const liq = await detectLiquidation(this.client, position.userId, position, snapshot.currentPrice);
      if (liq.suspected) {
        reason = "LIQUIDATION";
        exitPrice = exitPrice ?? liq.boundary;
        closeDetail = `price traded beyond the liquidation boundary (~${liq.boundary ?? "unknown"}) — position was liquidated on the exchange`;
        closedAtMs = closedAtMs ?? liq.closedAtMs;
        await this.log(position, "POSITION_LIQUIDATED", `${position.symbol} was liquidated on the exchange: ${liq.reasoning}`);
      }
    }

    await this.stateManager.transition(position.id, position.state, "CLOSING", closeDetail);
    const close: CloseDetectionResult = {
      shouldClose: true,
      reason,
      exitPrice,
      detail: closeDetail,
    };
    await this.finalizeClose(snapshot, close, closedAtMs != null ? new Date(closedAtMs).toISOString() : undefined);
  }

  private async finalizeClose(snapshot: PositionSnapshot, close: CloseDetectionResult, closedAt?: string): Promise<void> {
    const { position } = snapshot;
    const current = await this.store.getPosition(position.id);
    if (!current || current.state === "CLOSED") return;

    if (current.state !== "CLOSING") {
      await this.stateManager.transition(current.id, current.state, "CLOSING", close.detail);
    }

    await this.cancelOppositeProtection(current, close.reason);

    const exitPrice = close.exitPrice ?? snapshot.currentPrice ?? current.currentPrice ?? null;
    const pnl = exitPrice
      ? await this.pnl.computeRealized(snapshot, exitPrice)
      : await this.pnl.compute(snapshot);

    // Reconcile true costs (gross profit, entry+exit commission, funding) so the
    // reported net P&L ties to the wallet instead of a price-only estimate.
    const accounting = await reconcileClose(
      this.client,
      current.userId,
      current,
      pnl.entryPrice,
      exitPrice,
    ).catch(() => ({
      grossProfit: pnl.realizedPnl ?? 0,
      commission: pnl.fees ?? 0,
      fundingFee: 0,
      realizedPnl: pnl.realizedPnl ?? 0,
      estimated: true,
    }));

    await this.store.markClose(current.id, exitPrice ?? 0, close.reason, accounting.realizedPnl, accounting.commission, closedAt);
    await this.store.recordCloseSummary({
      position: current,
      exitPrice,
      reason: close.reason,
      realizedPnl: accounting.realizedPnl,
      fees: accounting.commission,
      grossProfit: accounting.grossProfit,
      commission: accounting.commission,
      fundingFee: accounting.fundingFee,
      entryPrice: pnl.entryPrice,
    });

    await this.executionStore.updateState(current.executionId, "CLOSED");

    await this.log(current, "POSITION_CLOSED", `${current.symbol} closed via ${close.reason} at ${exitPrice ?? "n/a"} pnl=${pnl.realizedPnl ?? 0}`);

    const typeMap: Record<string, ExecutionNotification["type"]> = {
      TAKE_PROFIT: "POSITION_TAKE_PROFIT",
      STOP_LOSS: "POSITION_STOP_LOSS",
      MANUAL_CLOSE: "POSITION_MANUAL_CLOSE",
      ENTRY_CANCELLED: "ENTRY_CANCELLED",
    };
    await this.notify(current, typeMap[close.reason] ?? "POSITION_CLOSED", `${current.symbol} closed via ${close.reason} at ${exitPrice ?? "n/a"} pnl=${pnl.realizedPnl ?? 0}`);

    // Telegram: use the existing reconciled accounting (gross profit, entry+exit
    // commission, funding, net P&L) so the message matches what the app reports.
    const qtyClose = current.filledQuantity ?? current.quantity ?? 0;
    const margin =
      pnl.entryPrice && qtyClose && current.leverage ? (pnl.entryPrice * qtyClose) / current.leverage : 0;
    const roi = margin > 0 && accounting.realizedPnl != null ? (accounting.realizedPnl / margin) * 100 : null;
    const closePayload = {
      symbol: current.symbol,
      side: current.side,
      entry: pnl.entryPrice,
      exit: exitPrice,
      gross: accounting.grossProfit,
      commission: accounting.commission,
      net: accounting.realizedPnl,
      roi,
      reason: close.reason,
    };
    const dedupeKey = `exec:${current.executionId}:close`;
    if (close.reason === "TAKE_PROFIT") {
      void dispatchTelegram(dedupeKey, "POSITION_TAKE_PROFIT", telegramTakeProfit(closePayload));
    } else if (close.reason === "STOP_LOSS") {
      void dispatchTelegram(dedupeKey, "POSITION_STOP_LOSS", telegramStopLoss({
        symbol: current.symbol,
        side: current.side,
        entry: pnl.entryPrice,
        exit: exitPrice,
        pnl: accounting.realizedPnl,
        roi,
      }));
    } else if (close.reason === "MANUAL_CLOSE") {
      void dispatchTelegram(dedupeKey, "POSITION_MANUAL_CLOSE", telegramManualClose({
        symbol: current.symbol,
        side: current.side,
        entry: pnl.entryPrice,
        exit: exitPrice,
        pnl: accounting.realizedPnl,
        roi,
      }));
    } else {
      void dispatchTelegram(dedupeKey, "POSITION_CLOSED", telegramPositionClosed(closePayload));
    }

    await this.releaseBot(current);
  }

  private async cancelOppositeProtection(position: PositionRecord, reason: string): Promise<void> {
    const cancelIds: string[] = [];
    if (reason === "TAKE_PROFIT" && position.stopLossOrderId) cancelIds.push(position.stopLossOrderId);
    if (reason === "STOP_LOSS" && position.takeProfitOrderId) cancelIds.push(position.takeProfitOrderId);
    if (reason === "MANUAL_CLOSE" || reason === "LIQUIDATION") {
      if (position.stopLossOrderId) cancelIds.push(position.stopLossOrderId);
      if (position.takeProfitOrderId) cancelIds.push(position.takeProfitOrderId);
    }
    for (const id of cancelIds) {
      await this.client.cancelOrder(position.userId, id).catch(() => null);
    }
  }

  private async syncTrailing(snapshot: PositionSnapshot): Promise<void> {
    const { position } = snapshot;
    if (!position.trailingEnabled) return;
    if (position.state !== "PROTECTED" && position.state !== "TRAILING") return;

    const result = await this.trailing.update(snapshot);
    if (result.moved) {
      await this.log(position, "TRAILING_MOVED", `stop loss moved to ${result.newStopLoss}`);
      if (position.state === "PROTECTED") {
        await this.stateManager.transition(position.id, "PROTECTED", "TRAILING");
      }
    }
  }

  private async releaseBot(position: PositionRecord): Promise<void> {
    await this.botState.updateBotStatus(position.botId, "RUNNING", null).catch(() => null);
    await this.botState.updateBotHeartbeat(position.botId, null, new Date().toISOString()).catch(() => null);
  }

  private async log(position: PositionRecord, type: string, message: string): Promise<void> {
    await this.store.saveEvent({
      userId: position.userId,
      botId: position.botId,
      executionId: position.executionId,
      positionId: position.id,
      type,
      message,
    });
  }

  private async notify(position: PositionRecord, type: ExecutionNotification["type"], message: string): Promise<void> {
    await this.executionStore.saveNotification({
      type,
      botId: position.botId,
      userId: position.userId,
      symbol: position.symbol,
      executionId: position.executionId,
      message,
    }).catch((e) => console.error("PositionMonitor notify failed", e));
  }
}

export const positionMonitor = new PositionMonitor();
