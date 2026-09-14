import { coinswitchClient, CoinSwitchClient } from "./client";
import { executionStore, ExecutionStore } from "./store";
import { OrderLifecycleService } from "./services/order-lifecycle";
import { ProtectiveOrdersService } from "./services/protective-orders";
import { BotLifecycleService } from "@/automation/service/bot-lifecycle";
import type {
  BotStateService,
  ExecutionNotification,
  OrderExecutorInput,
  OrderExecutorOptions,
  OrderExecutorResult,
} from "./types";
import type { TradePlan } from "@/automation/planner/types";
import { evaluateLiquidationSafety } from "@/automation/risk/liquidation-safety";
import { dispatchTelegram } from "@/lib/telegram-dispatch";
import {
  telegramEntryOrder,
  telegramPositionOpened,
  telegramProtected,
  telegramOrderFailed,
} from "@/lib/telegram";

export function floorToStep(value: number, step: number, precision: number): number {
  if (step <= 0) return Number(value.toFixed(precision));
  const rounded = Math.floor(value / step) * step;
  return Number(rounded.toFixed(precision));
}

/**
 * Highest allocation (as a percentage of the available balance) that still
 * leaves the configured headroom + fee buffer untouched, so the order's margin
 * can never consume the entire free balance.
 */
export function maxSafeAllocationPct(available: number, headroom: number, feeBuffer: number): number {
  if (!(available > 0)) return 0;
  const override = (available * (1 - headroom) - feeBuffer) / available;
  return Math.max(0, override) * 100;
}

interface NormalizedEntry {
  ok: boolean;
  message: string;
  quantity?: number;
  plan?: TradePlan;
}

/**
 * Fit a computed entry order to the exchange's instrument rules (minimum
 * quantity, step size, price precision). Returns ok:false with a clear reason
 * when the computed size cannot be expressed as a valid order — otherwise the
 * exchange rejects it with a cryptic "Malformed request data".
 */
export function normalizeEntryOrder(
  instrument: Record<string, unknown> | null,
  input: OrderExecutorInput,
): NormalizedEntry {
  const symbol = input.plan.symbol ?? "";
  if (!instrument || typeof instrument !== "object") {
    return { ok: true, message: "ok", quantity: input.quantity, plan: input.plan };
  }

  const minQty = Number(instrument.min_base_quantity ?? NaN);
  const step = Number(instrument.base_quantity_step_size ?? instrument.lot_size ?? NaN);
  const precisionRaw = Number(instrument.quantity_precision ?? 0);
  const precision = precisionRaw > 0 ? precisionRaw : 0;
  const pricePrecision = Number(instrument.price_precision ?? 0);

  let quantity =
    Number.isFinite(step) && step > 0 ? floorToStep(input.quantity, step, precision) : input.quantity;

  // A risk-capped position can fall below the exchange minimum even though the
  // configured capital at this leverage could afford the minimum order. In that
  // case raise the size to the smallest step-aligned quantity >= minQty so the
  // bot can actually trade, but never exceed what the allocated capital allows.
  if (Number.isFinite(minQty) && minQty > 0 && quantity < minQty) {
    const price = Number(input.plan.limitPrice ?? input.plan.entryPrice ?? 0);
    const allocated = Number(input.allocatedCapital ?? NaN);
    const capComputable =
      Number.isFinite(allocated) && allocated > 0 &&
      input.leverage > 0 &&
      Number.isFinite(price) && price > 0;

    if (!capComputable) {
      return { ok: false, message: `Position size ${quantity} is below the exchange minimum (${minQty}) for ${symbol} — trade skipped.` };
    }

    const maxPosition = (allocated * input.leverage) / price;
    const raised = Number.isFinite(step) && step > 0 ? Math.ceil(minQty / step) * step : minQty;
    const raisedRounded = Number(raised.toFixed(8));

    if (raisedRounded > maxPosition) {
      return {
        ok: false,
        message: `Position size ${quantity} is below the exchange minimum (${minQty}) for ${symbol} and cannot be raised to ${raisedRounded} without exceeding the allocated capital — trade skipped.`,
      };
    }

    quantity = raisedRounded;
  }

  if (!(quantity > 0)) {
    return { ok: false, message: `Position size (${input.quantity}) rounds to zero for ${symbol} — trade skipped.` };
  }

  let plan = input.plan;
  if (
    plan.entryType === "LIMIT" &&
    plan.limitPrice != null &&
    Number.isFinite(pricePrecision) &&
    pricePrecision > 0
  ) {
    plan = { ...plan, limitPrice: Number(plan.limitPrice.toFixed(pricePrecision)) };
  }

  return { ok: true, message: "ok", quantity, plan };
}

/**
 * Reserve a small buffer on top of the raw margin to cover maker/taker fees
 * and CoinSwitch's minimum-notional rounding, so the preflight guard does not
 * pass only for the exchange to reject at placement.
 */
export const MARGIN_FEE_BUFFER = 0.01;

/**
 * Fraction of the free (available) balance that must be left untouched when
 * placing an order. At 100% allocation the required margin equals the whole
 * available balance, leaving zero headroom, so even a few cents of fees or
 * rounding makes the exchange reject with "Insufficient balance". Enforcing
 * this keeps a deterministic clear pre-trade block instead of a cryptic
 * exchange rejection. This is why 75% allocation "works" but 100% fails.
 */
export const MARGIN_HEADROOM = 0.02;

export class OrderExecutorService {
  private readonly client: CoinSwitchClient;
  private readonly store: ExecutionStore;
  private readonly botState: BotStateService;
  private readonly lifecycle: OrderLifecycleService;
  private readonly protective: ProtectiveOrdersService;
  private readonly emergencyRetries: number;

  constructor(options: OrderExecutorOptions = {}) {
    this.emergencyRetries = options.emergencyRetries ?? 2;
    this.client = options.client ?? coinswitchClient;
    this.store = options.store ?? executionStore;
    this.botState = options.botState ?? new BotLifecycleService();
    this.lifecycle = new OrderLifecycleService(this.client, this.store, this.botState, options);
    this.protective = new ProtectiveOrdersService(this.client, this.store);
  }

  async execute(input: OrderExecutorInput): Promise<OrderExecutorResult> {
    const symbol = input.plan.symbol ?? "";
    if (symbol) {
      // CoinSwitch requires leverage to be configured per contract before the
      // first order on a symbol — otherwise order placement fails with
      // "subaccount association not found". This call is idempotent.
      await this.client.setLeverage(input.userId, symbol, input.leverage);
    }

    const instrument = await this.client.getInstrumentInfo(input.userId, input.plan.symbol ?? "").catch(() => null);
    const normalized = normalizeEntryOrder(instrument, input);

    // Liquidation-safety gate: re-verify at the point of no return. Once the
    // entry order is on the book the stop-loss path cannot be changed, so a
    // stop that sits beyond the liquidation boundary MUST block the entry here
    // (after liquidation the placeholder but live SL keeps draining the account).
    // This is MANDATORY and unconditional: ANY !ok verdict — including a boundary
    // that cannot be determined — rejects the trade (fail safe), with no
    // configuration able to disable or weaken the check.
    const liq = evaluateLiquidationSafety({
      side: (input.plan.side ?? input.plan.action) as "BUY" | "SELL",
      entryPrice: normalized.plan?.limitPrice ?? input.plan.limitPrice,
      stopLoss: input.plan.stopLoss,
      leverage: input.leverage,
    });
    if (!liq.ok) {
      const message = `Order blocked by the liquidation-safety gate: ${liq.reason}`;
      await this.notify("ENTRY_CANCELLED", input, 0, message);
      return {
        success: false,
        executionId: null,
        state: "CANCELLED",
        entryOrderId: null,
        slOrderId: null,
        tpOrderId: null,
        filledQuantity: null,
        remainingQuantity: null,
        protectiveStatus: "NONE",
        requiresEmergencyProtection: false,
        message,
      };
    }

    // Preflight margin guard: verify the order's required exchange margin is
    // covered by the account's *available* (free, unlocked) balance. Without
    // this, the exchange silently rejects with a cryptic "Insufficient balance"
    // that becomes a confusing bot.lastError, even though the user sees USDT in
    // their wallet (some of which can be locked in open orders/positions).
    const preflight = await this.checkFreeMargin(input, normalized);
    if (!preflight.ok) {
      await this.notify("ENTRY_CANCELLED", input, 0, preflight.message);
      return {
        success: false,
        executionId: null,
        state: "CANCELLED",
        entryOrderId: null,
        slOrderId: null,
        tpOrderId: null,
        filledQuantity: null,
        remainingQuantity: null,
        protectiveStatus: "NONE",
        requiresEmergencyProtection: false,
        message: preflight.message,
      };
    }

    const executionKey = this.buildKey(input);

    // Idempotency fast-path: if a LIVE execution already exists for this exact
    // fingerprint (same user/bot/symbol/side/price), never create a competing
    // one. A retry, a duplicate worker, or an overlap across a restart must
    // return the existing in-flight entry's state instead of submitting again.
    const existingActive = await this.store.getActiveByExecutionKey(executionKey).catch(() => null);
    if (existingActive) {
      return this.result(
        existingActive.id,
        existingActive.state,
        existingActive.filledQuantity,
        existingActive.protectiveStatus,
        false,
        `Duplicate entry prevented — an identical entry for ${input.plan.symbol ?? ""} is already in flight (execution ${existingActive.id}).`,
        existingActive.remainingQuantity,
      );
    }

    const executionId = await this.store.createExecution({
      botId: input.botId,
      userId: input.userId,
      symbol: input.plan.symbol ?? "",
      side: (input.plan.side ?? input.plan.action) as "BUY" | "SELL",
      executionKey,
      limitPrice: normalized.plan?.limitPrice ?? input.plan.limitPrice,
      stopLoss: input.plan.stopLoss,
      takeProfit: input.plan.takeProfit,
      quantity: normalized.ok && normalized.quantity !== undefined ? normalized.quantity : input.quantity,
      leverage: input.leverage,
      expiresAt: input.plan.expiryTime,
    });

    // Atomic claim on the fingerprint BEFORE any order placement. Exactly one
    // worker wins; a losing worker cancels its own execution row and never
    // touches the exchange — guaranteeing concurrent workers cannot submit the
    // same order simultaneously even if the fast-path check raced.
    const claim = await this.store
      .claimSubmission({ userId: input.userId, botId: input.botId, executionKey, executionId })
      .catch(() => null);
    if (!claim || !claim.ok) {
      const message = claim?.holderExecutionId
        ? `Duplicate entry prevented — an identical entry is already being placed by execution ${claim.holderExecutionId}.`
        : "Duplicate entry prevented — an identical entry is already in flight.";
      await this.store.updateState(executionId, "CANCELLED", message);
      await this.notify("ENTRY_CANCELLED", input, executionId, message);
      return this.result(executionId, "CANCELLED", null, "NONE", false, message);
    }

    try {
      if (!normalized.ok || normalized.quantity === undefined || !normalized.plan) {
        await this.store.updateState(executionId, "CANCELLED", normalized.message);
        await this.notify("ENTRY_CANCELLED", input, executionId, normalized.message);
        return this.result(executionId, "CANCELLED", null, "NONE", false, normalized.message);
      }

      const orderId = await this.lifecycle.submitEntry(executionId, input.userId, input.botId, normalized.plan, normalized.quantity);
      await this.notify(
        "ENTRY_SUBMITTED",
        input,
        executionId,
        normalized.message === "ok"
          ? `Entry order submitted for ${input.plan.symbol ?? ""}`
          : normalized.message,
      );
      void dispatchTelegram(`exec:${executionId}:entry`, "ENTRY_SUBMITTED", telegramEntryOrder({
        symbol: input.plan.symbol,
        side: input.plan.side ?? input.plan.action,
        type: input.plan.entryType === "LIMIT" && input.plan.limitPrice ? "LIMIT" : "MARKET",
        entryPrice: normalized.plan?.limitPrice ?? input.plan.limitPrice,
        quantity: normalized.quantity,
        leverage: input.leverage,
      }));

      const poll = await this.lifecycle.pollEntryUntilFilled(
        executionId,
        input.userId,
        orderId,
        { quantity: normalized.ok && normalized.quantity !== undefined ? normalized.quantity : input.quantity },
      );

      // Exchange reported a terminal outcome (cancelled / rejected / expired).
      if (poll.terminal) {
        await this.notify("ENTRY_CANCELLED", input, executionId, `Entry order ${poll.terminal}`);
        return this.result(executionId, "CANCELLED", null, "NONE", false, `Entry order ${poll.terminal}`, poll.remainingQuantity);
      }

      // The order is still resting on the exchange (not yet filled, possibly
      // partially filled). Never cancel it here just because the short inline
      // polling window ended — the server-side PositionMonitor keeps watching
      // it until it fills, invalidates, is explicitly cancelled, or reaches the
      // configured orderExpiryMinutes (persisted as expires_at).
      if (poll.resting) {
        const message =
          poll.filledQuantity != null
            ? `Entry partially filled (${poll.filledQuantity}${poll.remainingQuantity != null ? `, ${poll.remainingQuantity} remaining` : ""}); remainder resting on the exchange — monitored server-side until fill or expiry`
            : `Entry order resting for ${input.plan.symbol ?? ""} — monitored server-side until fill, invalidation, cancellation or expiry`;
        await this.notify("ENTRY_SUBMITTED", input, executionId, message);
        return this.result(executionId, "MONITORING_ENTRY", poll.filledQuantity, "NONE", false, message, poll.remainingQuantity);
      }

      // Fully filled.
      await this.notify("ENTRY_FILLED", input, executionId, `Entry filled for ${input.plan.symbol ?? ""}`);
      const filledQuantity = poll.filledQuantity ?? normalized.quantity;
      const openedQty = filledQuantity ?? normalized.quantity;
      void dispatchTelegram(`exec:${executionId}:position_open`, "POSITION_OPENED", telegramPositionOpened({
        symbol: input.plan.symbol,
        side: input.plan.side ?? input.plan.action,
        entry: normalized.plan?.limitPrice ?? input.plan.limitPrice ?? input.plan.entryPrice,
        quantity: openedQty,
        leverage: input.leverage,
        margin: input.plan.limitPrice && openedQty ? (openedQty * input.plan.limitPrice) / input.leverage : undefined,
      }));

      const execution = await this.store.getExecution(executionId);
      if (!execution) {
        throw new Error("Execution record not found after entry fill");
      }

      const { status: protectiveStatus } = await this.protective.placeProtection(execution, filledQuantity);

      if (protectiveStatus === "FAILED" || protectiveStatus === "NONE") {
        const recovered = await this.emergencyProtect(executionId);
        if (recovered) {
          await this.store.updateState(executionId, "ENTRY_FILLED");
          await this.notify("PROTECTED", input, executionId, "Protective orders placed after retry");
          const trailingAfterRecovery = await this.readTrailingEnabled(input.botId);
          void dispatchTelegram(`exec:${executionId}:protected`, "PROTECTED", telegramProtected({
            symbol: input.plan.symbol,
            sl: input.plan.stopLoss,
            tp: input.plan.takeProfit,
            trailing: trailingAfterRecovery,
          }));
          return this.result(executionId, "ENTRY_FILLED", filledQuantity, "PLACED", false, "Entry filled, protective orders placed after retry");
        }
        await this.store.updateState(executionId, "UNPROTECTED", "Protective orders failed");
        await this.notify("UNPROTECTED", input, executionId, `Entry filled but protective orders FAILED for ${input.plan.symbol ?? ""}. Position is UNPROTECTED`);
        return this.result(executionId, "UNPROTECTED", filledQuantity, protectiveStatus, true, "Entry filled but protective orders failed");
      }

      await this.store.updateState(executionId, "ENTRY_FILLED");
      await this.notify("PROTECTED", input, executionId, `Protective orders placed for ${input.plan.symbol ?? ""}`);
      const trailingEnabled = await this.readTrailingEnabled(input.botId);
      void dispatchTelegram(`exec:${executionId}:protected`, "PROTECTED", telegramProtected({
        symbol: input.plan.symbol,
        sl: input.plan.stopLoss,
        tp: input.plan.takeProfit,
        trailing: trailingEnabled,
      }));

      return this.result(executionId, "ENTRY_FILLED", filledQuantity, protectiveStatus, false, `Entry filled, protective orders ${protectiveStatus}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.updateState(executionId, "FAILED", message);
      await this.notify("ENTRY_FAILED", input, executionId, `Execution failed: ${message}`);
      void dispatchTelegram(`exec:${executionId}:failed`, "ENTRY_FAILED", telegramOrderFailed({
        symbol: input.plan.symbol,
        orderType: input.plan.entryType === "LIMIT" && input.plan.limitPrice ? "LIMIT" : "MARKET",
        reason: message,
      }));
      return this.result(executionId, "FAILED", null, "NONE", false, message);
    }
  }

  /**
   * Verify the account's *available* balance can cover the exchange margin the
   * order will require (notional / leverage). Returns ok:false with an
   * actionable message when it cannot.
   */
  private async checkFreeMargin(
    input: OrderExecutorInput,
    normalized: NormalizedEntry,
  ): Promise<{ ok: boolean; message: string }> {
    if (!input.leverage || input.leverage <= 0) {
      return { ok: false, message: "Cannot verify order margin: leverage must be greater than zero." };
    }
    if (!normalized.ok || normalized.quantity === undefined || !normalized.plan) {
      return { ok: false, message: normalized.message };
    }

    const price =
      normalized.plan.limitPrice ??
      input.plan.limitPrice ??
      input.plan.entryPrice ??
      null;
    if (price == null || !(price > 0)) {
      // A market entry has no fixed execution price, so we cannot size margin
      // up front — skip the preflight and let the exchange decide.
      return { ok: true, message: "ok" };
    }

    const notional = normalized.quantity * price;
    const requiredMargin = notional / input.leverage + MARGIN_FEE_BUFFER;

    const available = await this.client.getWalletBalance(input.userId).catch(() => null);

    const symbol = input.plan.symbol ?? "";
    // Leave a safety fraction of the free balance untouched. Required margin may
    // otherwise equal the whole available balance at high allocation, so any fee
    // or rounding overage makes the exchange reject with a cryptic
    // "Insufficient balance". Enforcing headroom turns that into a clear,
    // deterministic pre-trade block.
    const headroom = MARGIN_HEADROOM;
    const spendable = available != null && Number.isFinite(available) ? available * (1 - headroom) : NaN;
    const rawLog = {
      event: "preflight-margin",
      symbol,
      side: input.plan.side ?? input.plan.action,
      quantity: normalized.quantity,
      price,
      leverage: input.leverage,
      notional: Number(notional.toFixed(4)),
      requiredMargin: Number(requiredMargin.toFixed(4)),
      feeBuffer: MARGIN_FEE_BUFFER,
      headroomPct: headroom * 100,
      available,
      spendableAtHeadroom: Number.isFinite(spendable) ? Number(spendable.toFixed(4)) : null,
      wouldNeedFullNotionalAt1x: Number(notional.toFixed(4)),
    };
    // If the exchange rejects while we see a full available balance, the most
    // likely cause is that it reserves more margin than notional/leverage
    // (fees + rounding, or a higher margin rate than configured). Log the real
    // numbers so it can be confirmed from the server log.
    if (available != null && Number.isFinite(available) && requiredMargin <= spendable + 1e-9) {
      console.warn("[preflight] margin looks affordable within headroom, but the exchange may still reject —", rawLog);
    } else {
    }

    // If we cannot read the live balance (e.g. a transient API failure), do not
    // block the trade here — let the exchange decide, and the clearer
    // error-mapping in the cycle layer will explain any rejection.
    if (available == null || !Number.isFinite(available)) {
      return { ok: true, message: "ok" };
    }

    // Tolerate exact-equality/floating-point at the headroom boundary.
    const EXCESS_TOLERANCE = 1e-9;

    if (requiredMargin > spendable + EXCESS_TOLERANCE) {
      return {
        ok: false,
        message:
          `Cannot open ${symbol} safely: this order needs ~${requiredMargin.toFixed(4)} USDT in margin ` +
          `(${normalized.quantity} @ ${price}, 1/${input.leverage}x, fees included) but leaving a ${(headroom * 100).toFixed(0)}% headroom ` +
          `only ${spendable.toFixed(4)} USDT of your ${available.toFixed(4)} USDT free balance is usable. ` +
          `Reduce your capital allocation (e.g. to ~${maxSafeAllocationPct(available, headroom, MARGIN_FEE_BUFFER).toFixed(0)}%) or lower leverage so the order no longer consumes the whole available balance.`,
      };
    }

    return { ok: true, message: "ok" };
  }

  private async emergencyProtect(executionId: number): Promise<boolean> {
    for (let i = 0; i < this.emergencyRetries; i++) {
      const execution = await this.store.getExecution(executionId);
      if (!execution) return false;
      const { status } = await this.protective.placeProtection(execution, execution.filledQuantity);
      if (status !== "FAILED" && status !== "NONE") return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  private buildKey(input: OrderExecutorInput): string {
    return `${input.userId}:${input.botId}:${input.plan.symbol ?? ""}:${input.plan.side ?? input.plan.action}:${input.plan.limitPrice ?? "MKT"}`;
  }

  private async notify(type: ExecutionNotification["type"], input: OrderExecutorInput, executionId: number, message: string) {
    await this.store.saveNotification({
      type,
      botId: input.botId,
      userId: input.userId,
      symbol: input.plan.symbol ?? "",
      executionId,
      message,
    });
  }

  /** Read the bot's saved trailing-stop config for the PROTECTED message. Best-effort. */
  private async readTrailingEnabled(botId: number): Promise<boolean> {
    const svc = this.botState as unknown as { getBotById?: (id: number) => Promise<{ configJson?: string | null } | null> };
    try {
      const bot = svc?.getBotById ? await svc.getBotById(botId) : null;
      if (!bot?.configJson) return false;
      const parsed = JSON.parse(bot.configJson) as { enableTrailingStop?: boolean };
      return Boolean(parsed.enableTrailingStop);
    } catch {
      return false;
    }
  }

  private async result(
    executionId: number,
    state: OrderExecutorResult["state"],
    filledQuantity: number | null,
    protectiveStatus: OrderExecutorResult["protectiveStatus"],
    requiresEmergencyProtection: boolean,
    message: string,
    remainingQuantity: number | null = null,
  ): Promise<OrderExecutorResult> {
    const execution = await this.store.getExecution(executionId);
    return {
      success: state === "ENTRY_FILLED",
      executionId,
      state,
      entryOrderId: execution?.entry.orderId ?? null,
      slOrderId: execution?.stopLossOrder.orderId ?? null,
      tpOrderId: execution?.takeProfitOrder.orderId ?? null,
      filledQuantity: filledQuantity ?? execution?.filledQuantity ?? null,
      remainingQuantity: remainingQuantity ?? null,
      protectiveStatus,
      requiresEmergencyProtection,
      message,
    };
  }
}

export const orderExecutor = new OrderExecutorService();
