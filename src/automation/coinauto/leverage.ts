import type { AutomationConfig } from "@/automation/types";
import type { CoinOpportunity } from "@/automation/opportunity/scanner";
import {
  SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT,
  SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT,
} from "@/automation/risk/liquidation-safety";

export interface InstrumentLeverageRules {
  minLeverage: number;
  maxLeverage: number;
}

export type InstrumentInfo = Record<string, unknown>;

/**
 * Sentinel returned by `resolveLeverage` when NO leverage for the coin is
 * liquidation-safe (the safe maximum is below the exchange minimum). Callers
 * must treat this as "reject / WAIT" and never clamp leverage upward into an
 * unsafe range.
 */
export const LEVERAGE_UNSAFE = 0;

/** Extract a valid leverage number for a symbol from its instrument rules. */
export function leverageFromInstrument(
  instrument: InstrumentInfo | null,
  fallback = 1,
): InstrumentLeverageRules {
  const minL = Number(instrument?.min_leverage);
  const maxL = Number(instrument?.max_leverage);
  return {
    minLeverage: Number.isFinite(minL) && minL >= 1 ? Math.floor(minL) : 1,
    maxLeverage: Number.isFinite(maxL) && maxL >= 1 ? Math.floor(maxL) : Math.max(fallback, 1),
  };
}

/** Valid leverage increment for a symbol; the exchange enforces multiples of it. */
export function leverageStepOf(instrument: InstrumentInfo | null): number {
  const step = Number(instrument?.leverage_step);
  return Number.isFinite(step) && step >= 1 ? Math.floor(step) : 1;
}

/**
 * Per-symbol maintenance-margin rate (as a percent of notional) when the
 * exchange publishes it, otherwise the trusted system fallback constant from
 * the liquidation-safety module. Reuses the SAME constant the planner/executor
 * pre-entry gate uses so the leverage cap and the gate cannot disagree.
 */
export function maintenanceMarginPctOf(instrument: InstrumentInfo | null): number {
  const m = Number(instrument?.maint_margin_rate);
  if (Number.isFinite(m) && m > 0) return m;
  return SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT;
}

/**
 * Worst-case stop distance (fraction of price) the planner can legally place.
 *
 * The planner (`DefaultStopLossPlanner`) clamps its stop between
 * [minDistance, maxDistance] where
 *   minDistance = max(atr*1.35, price*minStopDistancePct*1.01)
 *   maxDistance = max(price*maxStopDistancePct, minDistance)
 *
 * To guarantee the selected leverage is compatible with ANY planner SL we must
 * be conservative and assume the WIDEST stop the planner may produce; a wider
 * stop needs lower leverage to stay liquidation-safe.
 */
export function conservativeStopDistanceFraction(
  config: AutomationConfig,
  atrPct: number,
): number {
  const minStopDistancePct = Number(config.minStopDistancePct);
  const maxStopDistancePct = Number(config.maxStopDistancePct);
  const minStop =
    Number.isFinite(minStopDistancePct) && minStopDistancePct > 0 ? minStopDistancePct : 0.008;
  const maxStop =
    Number.isFinite(maxStopDistancePct) && maxStopDistancePct > 0 ? maxStopDistancePct : 0.05;
  const atrStop = (Math.max(0, atrPct) / 100) * 1.35;
  return Math.max(maxStop, atrStop, minStop * 1.01);
}

/**
 * Liquidation-safe leverage ceiling for AUTO selection. Rooted in the SAME
 * invariant enforced by the planner/executor liquidation-safety gate:
 *
 *   stopDistanceFraction + maintenanceMarginFraction + safetyBufferFraction < 1 / leverage
 *
 * so the largest safe integer leverage is
 *
 *   floor(1 / (stopDistanceFraction + maintenanceMarginFraction + safetyBufferFraction))
 *
 * This is an EARLIER optimization/cap for the auto-leverage resolver, NOT a
 * replacement for the planner/executor gates (those still run unconditionally).
 */
export function liquidationSafeMaxLeverage(
  config: AutomationConfig,
  opportunity: Pick<CoinOpportunity, "atrPct"> | null,
  maintenanceMarginPct: number,
): number | null {
  const atrPct = Number.isFinite(opportunity?.atrPct as number | undefined)
    ? Math.max(0, Number(opportunity?.atrPct) || 0)
    : 0;
  const stopDistanceFraction = conservativeStopDistanceFraction(config, atrPct);
  const maintenanceMarginFraction = maintenanceMarginPct / 100;
  const safetyBufferFraction = SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT / 100;
  const denominator = stopDistanceFraction + maintenanceMarginFraction + safetyBufferFraction;
  if (!(denominator > 0)) return null;
  return Math.floor(1 / denominator);
}

/**
 * Resolve the effective leverage for a coin+config.
 *
 * MANUAL mode: selectedLeverage = maxLeverage × leveragePercent / 100,
 * rounded and clamped to the exchange's valid [min, max] range.
 *
 * AUTO mode: a volatility/risk-scaled fraction of the coin's max leverage,
 * then capped by the liquidation-safe ceiling for the coin+stop distance.
 * The scaling is deterministic: it uses the strategy-lite info available at
 * selection time (opportunity volatility, trend strength, confidence, ATR)
 * plus the existing per-trade risk limit, and NEVER exceeds the exchange cap.
 *
 * The liquidation cap mirrors the mandatory planner/executor gate: it assumes
 * the widest stop the planner may place and uses the per-symbol maintenance
 * margin (or the trusted system fallback) plus the safety buffer. Leverage is
 * always rounded DOWN to a valid exchange step, never up. When even the
 * exchange minimum leverage would be unsafe, `LEVERAGE_UNSAFE` is returned and
 * the caller MUST reject/WAIT the trade.
 */
export function resolveLeverage(
  config: AutomationConfig,
  instrument: InstrumentInfo | null,
  opportunity: Pick<
    CoinOpportunity,
    "atrPct" | "confidence" | "trend" | "factors" | "score"
  > | null = null,
): number {
  const { minLeverage, maxLeverage } = leverageFromInstrument(instrument, config.leverage);

  // Manual percentage mapping — the user's preference travels with the coin.
  if (config.leverageMode === "manual") {
    const pct = Number(config.leveragePercent) || 0;
    if (pct <= 0) return clampLeverage(minLeverage, minLeverage, maxLeverage);
    const raw = maxLeverage * (pct / 100);
    return clampLeverage(Math.round(raw), minLeverage, maxLeverage);
  }

  // AUTO — pick a sensible fraction of max leverage for this coin given the
  // current setup. Base ratio starts high for liquid, low-vol coins and
  // shrinks as risk rises, but never drops below a floor that still lets the
  // bot trade meaningfully.
  const atrPct = Number.isFinite(opportunity?.atrPct as number | undefined)
    ? Math.max(0, Number(opportunity?.atrPct) || 0)
    : 0;
  const confidence = Number(opportunity?.confidence) || 0;
  const volFactor = opportunity?.factors?.volatility ?? 0;

  // Higher hourly ATR → more cautious leverage. 2%+ ATR is risky; <0.6% is calm.
  let riskRatio;
  if (atrPct >= 2) riskRatio = 0.25;
  else if (atrPct >= 1.2) riskRatio = 0.4;
  else if (atrPct >= 0.6) riskRatio = 0.6;
  else riskRatio = 0.8;

  // Scale down further when the local volatility factor is already elevated.
  const volAdjustment = 1 - clampLeverage(volFactor, 0, 1) * 0.35;
  // Confidence adds modest upside (strong setups can afford the higher side).
  const confidenceBoost = 1 + clampLeverage(confidence, 0, 1) * 0.25;

  const effective = maxLeverage * riskRatio * volAdjustment * confidenceBoost;

  // "Never choose unnecessarily tiny leverage when the coin supports a
  // reasonable higher one" — enforce a ~25% of max floor when max ≥ 4x.
  // This floor is a preference, NOT a hard bound: it can never lift leverage
  // above the liquidation-safe ceiling.
  const floor = maxLeverage >= 4 ? Math.max(minLeverage, Math.round(maxLeverage * 0.25)) : minLeverage;
  const desired = Math.max(effective, floor);

  // Liquidation-aware ceiling for THIS coin + stop distance, using the same
  // constants as the planner/executor liquidation-safety gate.
  const maintenanceMarginPct = maintenanceMarginPctOf(instrument);
  const maxSafe = liquidationSafeMaxLeverage(config, opportunity, maintenanceMarginPct);

  if (maxSafe == null || maxSafe < minLeverage) {
    // Even the exchange's minimum leverage is not liquidation-safe → the coin
    // cannot be traded at any valid leverage right now. Reject/WAIT rather
    // than clamping upward into an unsafe range.
    return LEVERAGE_UNSAFE;
  }

  const step = leverageStepOf(instrument);
  const capped = Math.min(Math.min(desired, maxLeverage), maxSafe);
  // Always round DOWN to a valid exchange step, never up.
  const stepped = Math.floor(capped / step) * step;
  // Honour the exchange minimum (already verified ≤ maxSafe above).
  const resolved = Math.max(stepped, minLeverage);
  if (resolved > maxSafe) return LEVERAGE_UNSAFE;
  return resolved;
}

function clampLeverage(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}
