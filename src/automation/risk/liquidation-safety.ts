/**
 * Liquidation-safe stop-loss validation — MANDATORY system safety rule.
 *
 * BEFORE an entry order is submitted the system must guarantee the planned SL
 * is safely reachable before the exchange would liquidate the position:
 *
 *   LONG:  SL must be safely ABOVE the liquidation price.
 *   SHORT: SL must be safely BELOW the liquidation price.
 *
 * This guard is NOT a user-configurable bot setting. The maintenance-margin
 * assumption and the safety buffer are trusted system-level constants in this
 * module. There is no "off" switch and no API path that can weaken them: the
 * validation ALWAYS runs for every real entry order.
 *
 * Where the exchange provides an authoritative liquidation price (e.g. a live
 * position returned by /futures/positions), that value is preferred. Before
 * entry no such value exists, so the liquidation boundary is ESTIMATED from the
 * standard isolated-margin mechanics — entry price, leverage and a conservative
 * maintenance-margin assumption:
 *
 *   LONG liq  ≈ entry · (1 − 1/leverage + maintenanceMargin)
 *   SHORT liq ≈ entry · (1 + 1/leverage − maintenanceMargin)
 *
 * The estimate is deliberately NOT treated as exchange truth. A safety buffer
 * is added on top, and if the boundary cannot be determined at all the
 * validation FAILS SAFE (trade rejected) instead of guessing.
 */

/**
 * Maintenance-margin rate assumed for the boundary estimate, as a % of
 * position notional. Calibrated slightly ABOVE the observed CoinSwitch
 * behavior (the NEARUSDT 29x liquidation implied ~0.63%) so the estimate stays
 * conservative: a larger assumed maintenance margin puts the estimated boundary
 * closer to the entry price, tightening the allowed stop distance.
 *
 * Trusted system constant — intentionally not exposed to any configuration.
 */
export const SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT = 0.65;

/** Extra cushion between the SL and the liquidation boundary, as a % of entry price. Trusted system constant. */
export const SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT = 0.3;

export type LiquidationBoundarySource = "NONE" | "EXCHANGE" | "ESTIMATED";

export interface LiquidationSafetyInput {
  side: "BUY" | "SELL";
  entryPrice: number | null;
  stopLoss: number | null;
  leverage: number | null;
  /** Authoritative liquidation price from the exchange, when available. */
  realLiquidationPrice?: number | null;
}

export interface LiquidationSafetyResult {
  ok: boolean;
  /** False when the boundary could not be determined — callers MUST fail safe. */
  determinable: boolean;
  /** The liquidation boundary actually used for the check (in price units). */
  boundary: number | null;
  boundarySource: LiquidationBoundarySource;
  /** |entry − SL| / entry. */
  stopDistanceFraction: number | null;
  /** LONG: the lowest SL price that is still safely above the boundary. */
  minSafeStopLoss: number | null;
  /** SHORT: the highest SL price that is still safely below the boundary. */
  maxSafeStopLoss: number | null;
  reason: string;
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

/** Estimate the liquidation price for an isolated leveraged position. */
export function estimateLiquidationPrice(
  side: "BUY" | "SELL",
  entryPrice: number,
  leverage: number,
  maintenanceMarginPct: number = SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT,
): number | null {
  if (!(entryPrice > 0) || !(leverage > 0)) return null;
  const m = Math.max(0, Number(maintenanceMarginPct) || 0) / 100;
  const inverse = 1 / leverage;
  const upper = String(side).toUpperCase() === "SELL";
  return round(upper ? entryPrice * (1 + inverse - m) : entryPrice * (1 - inverse + m));
}

const failSafe = (reason: string): LiquidationSafetyResult => ({
  ok: false,
  determinable: false,
  boundary: null,
  boundarySource: "NONE",
  stopDistanceFraction: null,
  minSafeStopLoss: null,
  maxSafeStopLoss: null,
  reason,
});

/**
 * Verify that the planned SL is safely reachable before the liquidation price.
 * UNCONDITIONAL — always executes with the trusted system constants; an input
 * can never disable it or weaken the buffer.
 *
 * The core invariant (identical for LONG and SHORT):
 *   |entry − SL| / entry  must be strictly less than
 *   (1/leverage) − maintenanceMargin − safetyBuffer
 *
 * ANY failure to determine the boundary — missing entry price, missing SL,
 * missing/zero leverage, or a failed estimate — rejects the trade rather than
 * guessing.
 */
export interface StopLossBoundaryInput {
  side: "BUY" | "SELL";
  /** Candidate / active stop-loss price to validate. */
  stopLoss: number | null;
  /**
   * Authoritative liquidation price from a LIVE exchange position. This is the
   * PRIMARY boundary for the check. When unavailable the result is
   * indeterminate (determinable = false): a liquidation price is NEVER invented
   * and no maintenance-margin percentage is derived from margin values.
   */
  liquidationPrice?: number | null;
  /**
   * Entry price — used ONLY as the base of the safety buffer so the post-entry
   * check stays consistent with the pre-entry system. Falls back to the
   * boundary itself when absent.
   */
  entryPrice?: number | null;
}

/**
 * Validate a stop-loss that will be applied to a LIVE position against the
 * exchange-authoritative liquidation price.
 *
 * Unlike the pre-entry gate (`evaluateLiquidationSafety`) this validator does
 * NOT check the stop relative to the ENTRY price — once a position is open the
 * SL may legally have travelled across the entry (a trailing LONG stop sits
 * above the entry, a trailing SHORT stop sits below it). It only enforces the
 * mandatory liquidation invariant using the exchange's OWN liquidation price:
 *
 *   LONG:  SL must stay safely ABOVE the liquidation price + safety buffer
 *   SHORT: SL must stay safely BELOW the liquidation price − safety buffer
 *
 * The authoritative exchange liquidation price is never replaced by an
 * estimate, and no fake maintenance-margin percentage is derived. When the
 * exchange liquidation price is temporarily unavailable the check is
 * indeterminate (determinable = false) so the caller preserves its existing
 * safe fallback and must not invent a price, classify the position as
 * liquidated, or close it.
 */
export function validateStopLossBoundary(input: StopLossBoundaryInput): LiquidationSafetyResult {
  const sideUp = String(input.side).toUpperCase();
  if (sideUp !== "BUY" && sideUp !== "SELL") {
    return failSafe(`Trade direction ${input.side} is invalid — cannot determine the liquidation boundary.`);
  }

  const stopLoss = Number(input.stopLoss);
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
    return failSafe("Cannot validate the stop loss: it is missing or not a positive number.");
  }

  const real = Number(input.liquidationPrice);
  if (!Number.isFinite(real) || real <= 0) {
    return failSafe(
      "Authoritative exchange liquidation price is unavailable for this live position and will NOT be estimated or invented — the caller keeps its existing safe fallback.",
    );
  }

  const entry = Number(input.entryPrice);
  const bufferBase = Number.isFinite(entry) && entry > 0 ? entry : real;
  const bufferPrice = bufferBase * (SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT / 100);

  const minSafeStopLoss = sideUp === "BUY" ? round(real + bufferPrice) : null;
  const maxSafeStopLoss = sideUp === "SELL" ? round(real - bufferPrice) : null;

  const marginOfSafety =
    sideUp === "BUY" ? stopLoss - (real + bufferPrice) : (real - bufferPrice) - stopLoss;
  const safe = marginOfSafety > 1e-12;

  return {
    ok: safe,
    determinable: true,
    boundary: real,
    boundarySource: "EXCHANGE",
    stopDistanceFraction: bufferBase > 0 ? round(Math.abs(bufferBase - stopLoss) / bufferBase) : null,
    minSafeStopLoss,
    maxSafeStopLoss,
    reason: safe
      ? `Stop Loss (${stopLoss}) stays safely ${sideUp === "BUY" ? "above" : "below"} the exchange liquidation price (${real}) with the system safety buffer.`
      : `Stop Loss (${stopLoss}) is BEYOND the exchange liquidation price (${real}) — the stop could never fill before liquidation. Rejecting.`,
  };
}

export function evaluateLiquidationSafety(input: LiquidationSafetyInput): LiquidationSafetyResult {
  const sideUp = String(input.side).toUpperCase();

  if (sideUp !== "BUY" && sideUp !== "SELL") {
    return failSafe(`Trade direction ${input.side} is invalid — cannot determine the liquidation boundary.`);
  }

  const entry = Number(input.entryPrice);
  const stopLoss = Number(input.stopLoss);
  const leverage = Number(input.leverage);

  if (!Number.isFinite(entry) || entry <= 0) {
    return failSafe("Cannot determine the liquidation boundary: entry price is missing — trade rejected (fail safe).");
  }
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
    return failSafe("Cannot determine the liquidation boundary: stop loss is missing — trade rejected (fail safe).");
  }
  if (!Number.isFinite(leverage) || leverage <= 0) {
    return failSafe("Cannot determine the liquidation boundary: leverage is missing or zero — trade rejected (fail safe).");
  }

  // Direction sanity — the SL must be on the losing side of the entry.
  if (sideUp === "BUY" && stopLoss >= entry) {
    return failSafe("Stop loss is not below the entry price for a LONG trade.");
  }
  if (sideUp === "SELL" && stopLoss <= entry) {
    return failSafe("Stop loss is not above the entry price for a SHORT trade.");
  }

  // Preferred: the exchange's own liquidation price when the caller has one.
  let boundary: number | null = null;
  let boundarySource: LiquidationBoundarySource = "NONE";
  const real = Number(input.realLiquidationPrice);
  if (Number.isFinite(real) && real > 0) {
    boundary = real;
    boundarySource = "EXCHANGE";
  } else {
    boundary = estimateLiquidationPrice(sideUp as "BUY" | "SELL", entry, leverage);
    boundarySource = "ESTIMATED";
  }

  if (boundary == null) {
    return failSafe("Cannot determine the liquidation boundary — trade rejected (fail safe).");
  }

  const stopDistanceFraction = Math.abs(entry - stopLoss) / entry;
  const bufferPrice = entry * (SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT / 100);
  const minSafeStopLoss = sideUp === "BUY" ? round(boundary + bufferPrice) : null;
  const maxSafeStopLoss = sideUp === "SELL" ? round(boundary - bufferPrice) : null;

  // For a LONG the SL must sit ABOVE boundary + buffer; SHORT SL must sit BELOW boundary − buffer.
  const marginOfSafety =
    sideUp === "BUY" ? stopLoss - (boundary + bufferPrice) : (boundary - bufferPrice) - stopLoss;
  const safe = marginOfSafety > 1e-12;

  const boundaryLabel = boundarySource === "EXCHANGE" ? `${boundary} (exchange)` : `${boundary} (estimated)`;

  return {
    ok: safe,
    determinable: true,
    boundary,
    boundarySource,
    stopDistanceFraction: round(stopDistanceFraction),
    minSafeStopLoss,
    maxSafeStopLoss,
    reason: safe
      ? `Stop Loss (${stopLoss}) is safely reachable before the liquidation price (~${boundaryLabel}) at ${leverage}x leverage (stop distance ${(stopDistanceFraction * 100).toFixed(2)}%).`
      : `Stop Loss would be beyond the liquidation price (~${boundaryLabel}) at the selected ${leverage}x leverage — the stop (${stopLoss}) cannot be reached before liquidation. Rejecting the trade.`,
  };
}

/**
 * THE single authoritative formula for the maximum liquidation-safe leverage
 * for a given stop distance, maintenance-margin rate and safety buffer.
 *
 * The mandatory gate invariant is |entry − SL| / entry < 1/leverage − mm − buffer,
 * i.e. leverage < 1 / (stopDistanceFraction + mm + buffer). The largest safe
 * whole leverage is the floor of that bound. This helper backs BOTH:
 *   - the AUTO resolver's conservative cap (auto-best-selector.ts), which must
 *     assume the widest stop the planner may place; and
 *   - the executor's post-plan downshift (order-executor.ts), which uses the
 *     REAL planned entry + SL.
 *
 * Keeping the bound in ONE place means the two callers can never disagree.
 */
export function maxSafeLeverageFromStopDistance(
  stopDistanceFraction: number,
  maintenanceMarginPct: number = SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT,
  safetyBufferPct: number = SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT,
): number | null {
  const stop = Math.max(0, Number(stopDistanceFraction) || 0);
  if (!(stop > 0)) return null;
  const mm = Math.max(0, Number(maintenanceMarginPct) || 0) / 100;
  const buffer = Math.max(0, Number(safetyBufferPct) || 0) / 100;
  const denominator = stop + mm + buffer;
  if (!(denominator > 0)) return null;
  return Math.floor(1 / denominator);
}

export interface MaxSafeStopLeverageInput {
  side: "BUY" | "SELL";
  entryPrice: number | null;
  stopLoss: number | null;
  /** Per-symbol maintenance-margin rate (as % of notional) when known, else the trusted system fallback. */
  maintenanceMarginPct?: number | null;
  /** System safety buffer (as % of entry price). Defaults to SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT. */
  safetyBufferPct?: number | null;
}

/**
 * Maximum liquidation-safe leverage for a REAL planned entry + SL. Unlike the
 * AUTO resolver (which must be conservative about a future stop), this uses the
 * actual stop distance of the plan that is about to be submitted. Returns null
 * when the boundary cannot be determined (fail safe).
 */
export function maxSafeLeverageForStop(input: MaxSafeStopLeverageInput): number | null {
  const sideUp = String(input.side).toUpperCase();
  if (sideUp !== "BUY" && sideUp !== "SELL") return null;
  const entry = Number(input.entryPrice);
  const stop = Number(input.stopLoss);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop) || stop <= 0) return null;
  // Direction sanity mirrors evaluateLiquidationSafety.
  if (sideUp === "BUY" && stop >= entry) return null;
  if (sideUp === "SELL" && stop <= entry) return null;
  const stopDistanceFraction = Math.abs(entry - stop) / entry;
  return maxSafeLeverageFromStopDistance(
    stopDistanceFraction,
    input.maintenanceMarginPct ?? SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT,
    input.safetyBufferPct ?? SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT,
  );
}

/** Default leverage increment assumed when the exchange does not publish one. */
export const LEVERAGE_STEP_DEFAULT = 1;

/** Valid leverage increment for a symbol; the exchange enforces multiples of it. */
export function leverageStepOfInstrument(instrument: Record<string, unknown> | null): number {
  const step = Number(instrument?.leverage_step);
  return Number.isFinite(step) && step >= 1 ? Math.floor(step) : LEVERAGE_STEP_DEFAULT;
}

/** Per-symbol maintenance-margin rate (as a percent of notional) when the exchange publishes it, otherwise the trusted system fallback. */
export function maintenanceMarginPctOfInstrument(instrument: Record<string, unknown> | null): number {
  const m = Number(instrument?.maint_margin_rate);
  if (Number.isFinite(m) && m > 0) return m;
  return SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT;
}

export interface InstrumentLeverageConstraints {
  minLeverage: number;
  maxLeverage: number | null;
  leverageStep: number;
}

/** Normalized exchange leverage constraints (min / max / step) for a symbol. */
export function leverageConstraintsOfInstrument(instrument: Record<string, unknown> | null): InstrumentLeverageConstraints {
  const min = Number(instrument?.min_leverage);
  const max = Number(instrument?.max_leverage);
  return {
    minLeverage: Number.isFinite(min) && min >= 1 ? Math.floor(min) : 1,
    maxLeverage: Number.isFinite(max) && max >= 1 ? Math.floor(max) : null,
    leverageStep: leverageStepOfInstrument(instrument),
  };
}

export interface ResolveSafeLeverageInput {
  side: "BUY" | "SELL";
  entryPrice: number | null;
  stopLoss: number | null;
  /** The configured/resolved leverage — treated as a CEILING, never to be exceeded. */
  requestedLeverage: number;
  /** Preferred source: the instrument's maint_margin_rate; falls back to the system constant. */
  maintenanceMarginPct?: number | null;
  safetyBufferPct?: number | null;
  minLeverage?: number | null;
  maxLeverage?: number | null;
  leverageStep?: number | null;
}

export interface ResolveSafeLeverageResult {
  ok: boolean;
  /** Final chosen leverage (≤ requested, ≤ safe max, step-rounded DOWN, ≥ exchange min), or null. */
  leverage: number | null;
  /** The mathematical safe ceiling before min/max/step normalization. */
  maxSafeLeverage: number | null;
  reason: string;
}

/**
 * Resolve the highest leverage that is liquidation-safe for the REAL planned
 * stop while honoring every exchange constraint:
 *   - never above the requested/configured leverage (ceiling, never a floor);
 *   - never above the exchange max;
 *   - never above the liquidation-safe maximum for the actual stop;
 *   - always rounded DOWN to a valid exchange step (never up);
 *   - never below the exchange minimum — if the step-rounded candidate sits
 *     below the minimum, no valid leverage exists (fail safe).
 */
export function resolveSafeLeverage(input: ResolveSafeLeverageInput): ResolveSafeLeverageResult {
  const requested = Number(input.requestedLeverage);
  if (!Number.isFinite(requested) || requested <= 0) {
    return { ok: false, leverage: null, maxSafeLeverage: null, reason: "Requested leverage is missing or invalid." };
  }

  const maxSafe = maxSafeLeverageForStop({
    side: input.side,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    maintenanceMarginPct: input.maintenanceMarginPct ?? SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT,
    safetyBufferPct: input.safetyBufferPct ?? SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT,
  });
  if (maxSafe == null) {
    return {
      ok: false,
      leverage: null,
      maxSafeLeverage: null,
      reason: "Cannot determine the liquidation-safe leverage for the planned stop.",
    };
  }
  if (!(maxSafe >= 1)) {
    return {
      ok: false,
      leverage: null,
      maxSafeLeverage: maxSafe,
      reason: `No liquidation-safe leverage exists for the planned stop (safe maximum ${maxSafe}x).`,
    };
  }

  const minLeverage = Number.isFinite(Number(input.minLeverage)) && Number(input.minLeverage)! >= 1 ? Math.floor(Number(input.minLeverage)) : 1;
  const maxLeverage = Number.isFinite(Number(input.maxLeverage)) && Number(input.maxLeverage)! >= 1 ? Math.floor(Number(input.maxLeverage)) : null;
  const step = Number.isFinite(Number(input.leverageStep)) && Number(input.leverageStep)! >= 1 ? Math.floor(Number(input.leverageStep)) : LEVERAGE_STEP_DEFAULT;

  const ceiling = maxLeverage != null ? Math.min(requested, maxLeverage, maxSafe) : Math.min(requested, maxSafe);

  // Always round DOWN to a valid exchange step; never round up.
  let candidate = Math.floor(ceiling / step) * step;
  if (candidate < minLeverage) {
    // The step-rounded candidate sits below the exchange minimum. Bumping it up
    // to the minimum could exceed the safe ceiling — only allowed when it stays
    // within every bound; otherwise the trade is rejected.
    candidate = minLeverage;
  }

  const overSafe = candidate > maxSafe;
  const overRequested = candidate > requested;
  const overMax = maxLeverage != null && candidate > maxLeverage;
  if (candidate <= 0 || overSafe || overRequested || overMax) {
    return {
      ok: false,
      leverage: null,
      maxSafeLeverage: maxSafe,
      reason: `No liquidation-safe leverage at or above the ${minLeverage}x exchange minimum can make the planned stop safe (safe maximum ${maxSafe}x).`,
    };
  }

  return {
    ok: true,
    leverage: candidate,
    maxSafeLeverage: maxSafe,
    reason: `Liquidation-safe leverage resolved to ${candidate}x (safe maximum ${maxSafe}x).`,
  };
}