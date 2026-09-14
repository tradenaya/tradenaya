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