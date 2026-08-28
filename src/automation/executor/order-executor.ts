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

    // Preflight margin guard: verify the order's required exchange margin is
    // covered by the account's *available* (free, unlocked) balance. Without
    // this, the exchange silently rejects with a cryptic "Insufficient balance"
    // that becomes a confusing bot.lastError, even though the user sees USDT in
    // their wallet (some of which can be locked in open orders/positions).
    const preflight = await this.checkFreeMargin(input, normalized);
    if (!preflight.ok) {
      await this.notify("ENTRY_CANCELLED", input, -1, preflight.message);
      return {
        success: false,
        executionId: null,
        state: "CANCELLED",
        entryOrderId: null,
        slOrderId: null,
        tpOrderId: null,
        filledQuantity: null,
        protectiveStatus: "NONE",
        requiresEmergencyProtection: false,
        message: preflight.message,
      };
    }

    const executionId = await this.store.createExecution({
      botId: input.botId,
      userId: input.userId,
      symbol: input.plan.symbol ?? "",
      side: (input.plan.side ?? input.plan.action) as "BUY" | "SELL",
      executionKey: this.buildKey(input),
      limitPrice: normalized.plan?.limitPrice ?? input.plan.limitPrice,
      stopLoss: input.plan.stopLoss,
      takeProfit: input.plan.takeProfit,
      quantity: normalized.ok && normalized.quantity !== undefined ? normalized.quantity : input.quantity,
      leverage: input.leverage,
      expiresAt: input.plan.expiryTime,
    });

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

      const { filled, filledQuantity } = await this.lifecycle.pollEntryUntilFilled(executionId, input.userId, orderId);

      if (!filled) {
        await this.notify("ENTRY_CANCELLED", input, executionId, "Entry order was not filled and has been cancelled");
        return this.result(executionId, "CANCELLED", null, "NONE", false, "Entry order was not filled and has been cancelled");
      }

      await this.notify("ENTRY_FILLED", input, executionId, `Entry filled for ${input.plan.symbol ?? ""}`);

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
          return this.result(executionId, "ENTRY_FILLED", filledQuantity, "PLACED", false, "Entry filled, protective orders placed after retry");
        }
        await this.store.updateState(executionId, "UNPROTECTED", "Protective orders failed");
        await this.notify("UNPROTECTED", input, executionId, `Entry filled but protective orders FAILED for ${input.plan.symbol ?? ""}. Position is UNPROTECTED`);
        return this.result(executionId, "UNPROTECTED", filledQuantity, protectiveStatus, true, "Entry filled but protective orders failed");
      }

      await this.store.updateState(executionId, "ENTRY_FILLED");
      await this.notify("PROTECTED", input, executionId, `Protective orders placed for ${input.plan.symbol ?? ""}`);

      return this.result(executionId, "ENTRY_FILLED", filledQuantity, protectiveStatus, false, `Entry filled, protective orders ${protectiveStatus}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.updateState(executionId, "FAILED", message);
      await this.notify("ENTRY_FAILED", input, executionId, `Execution failed: ${message}`);
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
      console.log("[preflight] margin check", rawLog);
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

  private async result(
    executionId: number,
    state: OrderExecutorResult["state"],
    filledQuantity: number | null,
    protectiveStatus: OrderExecutorResult["protectiveStatus"],
    requiresEmergencyProtection: boolean,
    message: string,
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
      protectiveStatus,
      requiresEmergencyProtection,
      message,
    };
  }
}

export const orderExecutor = new OrderExecutorService();
