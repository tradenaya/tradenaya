import { describe, it, expect } from "vitest";
import {
  evaluateLiquidationSafety,
  estimateLiquidationPrice,
  validateStopLossBoundary,
  maxSafeLeverageFromStopDistance,
  maxSafeLeverageForStop,
  resolveSafeLeverage,
  leverageConstraintsOfInstrument,
  maintenanceMarginPctOfInstrument,
  leverageStepOfInstrument,
  LEVERAGE_STEP_DEFAULT,
  SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT,
} from "@/automation/risk/liquidation-safety";

describe("estimateLiquidationPrice", () => {
  it("places a LONG liquidation boundary below the entry", () => {
    // 1/(29x) = 3.448% — maintenance 0.65%: boundary = 1 - 0.03448 + 0.0065
    const boundary = estimateLiquidationPrice("BUY", 3.399, 29, 0.65);
    expect(boundary).toBeCloseTo(3.399 * (1 - 1 / 29 + 0.0065), 6);
    expect(boundary).toBeLessThan(3.399);
    expect(boundary).toBeCloseTo(3.3039, 3);
  });

  it("places a SHORT liquidation boundary above the entry", () => {
    const boundary = estimateLiquidationPrice("SELL", 100, 10, 0.65);
    expect(boundary).toBeCloseTo(100 * (1 + 0.1 - 0.0065), 6);
    expect(boundary).toBeGreaterThan(100);
  });

  it("returns null for invalid inputs", () => {
    expect(estimateLiquidationPrice("BUY", 0, 10, 0.65)).toBeNull();
    expect(estimateLiquidationPrice("BUY", 100, 0, 0.65)).toBeNull();
    expect(estimateLiquidationPrice("BUY", -5, 10, 0.65)).toBeNull();
  });
});

describe("evaluateLiquidationSafety", () => {
  // Regression for the NEARUSDT incident: a 29x LONG stopped at 2.9 would have
  // been liquidated long before the SL could fill — the entire failure came from
  // placing a stop BEYOND the liquidation price. It MUST be rejected here.
  it("REJECTS the NEARUSDT-style 29x stop beyond the liquidation boundary", () => {
    const result = evaluateLiquidationSafety({
      side: "BUY",
      entryPrice: 3.399,
      stopLoss: 2.9,
      leverage: 29,
    });
    expect(result.determinable).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/liquidation/i);
  });

  it("allows a stop that is safely reachable before liquidation", () => {
    const result = evaluateLiquidationSafety({
      side: "BUY",
      entryPrice: 3.399,
      stopLoss: 3.05,
      leverage: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.boundary).not.toBeNull();
  });

  it("allows a SHORT stop safely below the liquidation boundary", () => {
    const result = evaluateLiquidationSafety({
      side: "SELL",
      entryPrice: 100,
      stopLoss: 108,
      leverage: 10,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a SHORT stop beyond the liquidation boundary", () => {
    const result = evaluateLiquidationSafety({
      side: "SELL",
      entryPrice: 100,
      stopLoss: 110,
      leverage: 10,
    });
    expect(result.ok).toBe(false);
  });

  it("prefers the exchange liquidation price when provided", () => {
    // Estimated boundary ≈ 79.3, so SL 80 looks safe — but the real liquidation
    // price is 85 and 80 is already on the wrong side of it.
    const result = evaluateLiquidationSafety({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 80,
      leverage: 5,
      realLiquidationPrice: 85,
    });
    expect(result.boundarySource).toBe("EXCHANGE");
    expect(result.ok).toBe(false);
  });

  it("fails SAFE (rejects) when the boundary cannot be determined", () => {
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: null, stopLoss: 2, leverage: 5 }).determinable).toBe(false);
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: 10, stopLoss: null, leverage: 5 }).determinable).toBe(false);
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: 10, stopLoss: 2, leverage: 0 }).determinable).toBe(false);
  });

  it("rejects an SL on the wrong side of the entry as indeterminate", () => {
    const result = evaluateLiquidationSafety({
      side: "BUY",
      entryPrice: 10,
      stopLoss: 12,
      leverage: 5,
    });
    expect(result.determinable).toBe(false);
    expect(result.reason).toMatch(/not below/i);
  });

  it("is UNCONDITIONAL — there is no configuration to disable or weaken it (same input always yields the same verdict)", () => {
    // The function signature accepts only trade inputs; the maintainance-margin
    // and safety-buffer are trusted system constants. The mandatory invariant
    // must hold for the same trade parameters regardless of any settings.
    const result = evaluateLiquidationSafety({
      side: "BUY",
      entryPrice: 3.399,
      stopLoss: 2.9,
      leverage: 29,
    });
    expect(result.ok).toBe(false);
  });

  it("always enforces the system safety buffer against the fixed 0.65% maintenance margin", () => {
    // System constants: boundary = entry*(1 - 1/lev + 0.0065), buffer = 0.3%.
    // With entry 100, lev 10 → boundary ≈ 90.65, min-safe SL ≈ 90.95.
    const result = evaluateLiquidationSafety({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 90.94,
      leverage: 10,
    });
    expect(result.minSafeStopLoss).not.toBeNull();
    expect(result.maxSafeStopLoss).toBeNull();
    // 90.94 sits just inside the 0.3% cushion → rejected; the boundary itself
    // proves the constants are applied (not user-tunable).
    expect(result.ok).toBe(false);
    expect(result.minSafeStopLoss).toBeCloseTo(90.65 + 100 * (0.3 / 100), 6);
  });

  it("pre-entry guard still uses the ESTIMATED fallback when no exchange liquidation price is available yet", () => {
    const result = evaluateLiquidationSafety({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 95,
      leverage: 10,
    });
    expect(result.boundarySource).toBe("ESTIMATED");
    expect(result.determinable).toBe(true);
    expect(result.ok).toBe(true);
  });
});

describe("validateStopLossBoundary", () => {
  it("uses the authoritative exchange liquidation price as the PRIMARY boundary", () => {
    const result = validateStopLossBoundary({
      side: "BUY",
      stopLoss: 95,
      liquidationPrice: 90,
      entryPrice: 100,
    });
    expect(result.determinable).toBe(true);
    expect(result.boundarySource).toBe("EXCHANGE");
    expect(result.boundary).toBe(90);
  });

  it("gives the authoritative liquidation price priority over the estimator", () => {
    // Estimated boundary ≈ 79.3 at 5x, so SL 80 looks safe vs the estimate,
    // but the exchange says the real liquidation price is 85 and 80 is on the
    // wrong side of it.
    const result = validateStopLossBoundary({
      side: "BUY",
      stopLoss: 80,
      liquidationPrice: 85,
      entryPrice: 100,
    });
    expect(result.boundarySource).toBe("EXCHANGE");
    expect(result.boundary).toBe(85);
    expect(result.ok).toBe(false);
  });

  it("accepts a LONG SL safely above the authoritative boundary + buffer", () => {
    const result = validateStopLossBoundary({
      side: "BUY",
      stopLoss: 95,
      liquidationPrice: 90,
      entryPrice: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.minSafeStopLoss).toBeCloseTo(90 + 100 * (0.3 / 100), 6);
    expect(result.maxSafeStopLoss).toBeNull();
  });

  it("rejects a LONG SL at or below the authoritative boundary", () => {
    const result = validateStopLossBoundary({
      side: "BUY",
      stopLoss: 90.2,
      liquidationPrice: 90,
      entryPrice: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.boundary).toBe(90);
  });

  it("accepts a SHORT SL safely below the authoritative boundary", () => {
    const result = validateStopLossBoundary({
      side: "SELL",
      stopLoss: 108,
      liquidationPrice: 110,
      entryPrice: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.maxSafeStopLoss).toBeCloseTo(110 - 100 * (0.3 / 100), 6);
    expect(result.minSafeStopLoss).toBeNull();
  });

  it("rejects a SHORT SL at or above the authoritative boundary", () => {
    const result = validateStopLossBoundary({
      side: "SELL",
      stopLoss: 111,
      liquidationPrice: 110,
      entryPrice: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.boundary).toBe(110);
  });

  it("does not invent a liquidation price when the exchange value is unavailable", () => {
    const result = validateStopLossBoundary({
      side: "BUY",
      stopLoss: 95,
      liquidationPrice: null,
      entryPrice: 100,
    });
    expect(result.determinable).toBe(false);
    expect(result.boundary).toBeNull();
    expect(result.boundarySource).toBe("NONE");
    expect(result.reason).toMatch(/unavailable/i);
  });

  it("rejects invalid direction or missing stop loss", () => {
    expect(
      validateStopLossBoundary({ side: "BUY", stopLoss: null, liquidationPrice: 90, entryPrice: 100 }).determinable,
    ).toBe(false);
    expect(
      validateStopLossBoundary({ side: "LONG" as unknown as "BUY", stopLoss: 95, liquidationPrice: 90, entryPrice: 100 }).determinable,
    ).toBe(false);
  });

  it("uses the boundary as the buffer base when entry price is absent", () => {
    const result = validateStopLossBoundary({
      side: "BUY",
      stopLoss: 95,
      liquidationPrice: 90,
    });
    expect(result.ok).toBe(true);
    // bufferBase = real = 90 → buffer = 90 * 0.003 = 0.27; minSafe = 90.27.
    expect(result.minSafeStopLoss).toBeCloseTo(90.27, 6);
  });
});

describe("maxSafeLeverageFromStopDistance", () => {
  it("is the floor of 1 / (stopDistance + maint margin + safety buffer)", () => {
    // stop 5% + maint 0.65% + buffer 0.3% = 5.95% → 1/0.0595 = 16.8 → 16.
    expect(maxSafeLeverageFromStopDistance(0.05)).toBe(16);
    // stop 1% → 1/0.0195 = 51.28 → 51.
    expect(maxSafeLeverageFromStopDistance(0.01)).toBe(51);
  });

  it("honors a per-symbol maintenance margin when provided", () => {
    // stop 5% + maint 0.4% + buffer 0.3% = 5.7% → 1/0.057 = 17.54 → 17.
    expect(maxSafeLeverageFromStopDistance(0.05, 0.4)).toBe(17);
    expect(maxSafeLeverageFromStopDistance(0.05, SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT)).toBe(16);
  });

  it("returns null for a non-positive stop distance", () => {
    expect(maxSafeLeverageFromStopDistance(0)).toBeNull();
    expect(maxSafeLeverageFromStopDistance(-1)).toBeNull();
  });
});

describe("maxSafeLeverageForStop", () => {
  it("computes the safe ceiling from the REAL planned entry + SL", () => {
    // 5% stop → 16x. This is the executor's authoritative post-plan ceiling.
    expect(maxSafeLeverageForStop({ side: "BUY", entryPrice: 100, stopLoss: 95 })).toBe(16);
  });

  it("prefers the per-symbol maintenance margin", () => {
    expect(maxSafeLeverageForStop({ side: "BUY", entryPrice: 100, stopLoss: 95, maintenanceMarginPct: 0.4 })).toBe(17);
  });

  it("returns null when the boundary cannot be determined (fail safe)", () => {
    expect(maxSafeLeverageForStop({ side: "BUY", entryPrice: null, stopLoss: 95 })).toBeNull();
    expect(maxSafeLeverageForStop({ side: "BUY", entryPrice: 100, stopLoss: null })).toBeNull();
    // SL on the wrong side of the entry for a LONG.
    expect(maxSafeLeverageForStop({ side: "BUY", entryPrice: 100, stopLoss: 105 })).toBeNull();
    expect(maxSafeLeverageForStop({ side: "SELL", entryPrice: 100, stopLoss: 95 })).toBeNull();
  });
});

describe("resolveSafeLeverage", () => {
  // Requested 65x with a 5% stop: the safe ceiling is 16.8→16x. The resolver
  // must prefer a valid lower leverage over silently cancelling.
  it("downshifts from an unsafe requested leverage to a safe lower one", () => {
    const result = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 95,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.leverage).toBe(16);
    expect(result.maxSafeLeverage).toBe(16);
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: 100, stopLoss: 95, leverage: result.leverage! }).ok).toBe(true);
  });

  it("rounds a fractional safe ceiling DOWN to a valid step, never up", () => {
    // Safe ceiling 16.8x with step 1 → 16 (never 17). With step 5 → 15.
    const step1 = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 95,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
    });
    expect(step1.leverage).toBe(16);

    const step5 = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 95,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 5,
    });
    // floor(16/5)×5 = 15 — rounded DOWN to the exchange step, never up.
    expect(step5.leverage).toBe(15);
    expect(step5.leverage! % 5).toBe(0);
  });

  it("never raises leverage above the requested/configured value", () => {
    // The safe ceiling (51x for a 1% stop) exceeds the 20x request — the
    // configured 20x must be preserved, never increased.
    const result = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 99,
      requestedLeverage: 20,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.leverage).toBe(20);
    expect(result.maxSafeLeverage).toBe(51);
    expect(evaluateLiquidationSafety({ side: "BUY", entryPrice: 100, stopLoss: 99, leverage: 20 }).ok).toBe(true);
  });

  it("rejects when only a leverage below the exchange minimum would be safe", () => {
    // 5% stop → safe 16x, but the exchange minimum is 20x: no valid leverage
    // exists, so the resolver must reject (never raise into an unsafe range).
    const result = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 95,
      requestedLeverage: 65,
      minLeverage: 20,
      maxLeverage: 100,
      leverageStep: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.leverage).toBeNull();
    expect(result.maxSafeLeverage).toBe(16);
  });

  it("rejects when the boundary cannot be determined (fail safe)", () => {
    const result = resolveSafeLeverage({
      side: "BUY",
      entryPrice: null,
      stopLoss: 95,
      requestedLeverage: 65,
    });
    expect(result.ok).toBe(false);
    expect(result.leverage).toBeNull();
  });

  it("rejects an invalid/zero requested leverage", () => {
    const result = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 95,
      requestedLeverage: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.leverage).toBeNull();
  });

  it("uses the per-symbol maintenance margin when available (higher ceiling)", () => {
    const withMaint = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 95,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
      maintenanceMarginPct: 0.4,
    });
    expect(withMaint.leverage).toBe(17);
    const fallback = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 95,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
      maintenanceMarginPct: SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT,
    });
    expect(fallback.leverage).toBe(16);
  });

  it("keeps the liquidation gate effective at the exact safe boundary (re-check still decides)", () => {
    // stop 5.3% lands exactly on 1/16 − 0.65% − 0.3%: the resolver's ceiling
    // is still 16x, but the mandatory gate at 16x has ZERO margin → must fail
    // (the executor's final re-check is what blocks this knife-edge case).
    const resolved = resolveSafeLeverage({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 94.7,
      requestedLeverage: 65,
      minLeverage: 1,
      maxLeverage: 100,
      leverageStep: 1,
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.leverage).toBe(16);
    const gate = evaluateLiquidationSafety({ side: "BUY", entryPrice: 100, stopLoss: 94.7, leverage: resolved.leverage! });
    expect(gate.ok).toBe(false);
  });
});

describe("instrument leverage helpers", () => {
  it("parses min/max/step from the instrument and falls back to safe defaults", () => {
    expect(leverageConstraintsOfInstrument({ min_leverage: "2", max_leverage: "50", leverage_step: "5" })).toEqual({
      minLeverage: 2,
      maxLeverage: 50,
      leverageStep: 5,
    });
    expect(leverageConstraintsOfInstrument(null)).toEqual({ minLeverage: 1, maxLeverage: null, leverageStep: LEVERAGE_STEP_DEFAULT });
    expect(leverageConstraintsOfInstrument({ min_leverage: "0", max_leverage: "0" })).toEqual({ minLeverage: 1, maxLeverage: null, leverageStep: 1 });
  });

  it("prefers the per-symbol maintenance margin and falls back to the system constant", () => {
    expect(maintenanceMarginPctOfInstrument({ maint_margin_rate: "0.4" })).toBe(0.4);
    expect(maintenanceMarginPctOfInstrument({ maint_margin_rate: "0" })).toBe(SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT);
    expect(maintenanceMarginPctOfInstrument(null)).toBe(SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT);
  });

  it("reads the leverage step or defaults to 1", () => {
    expect(leverageStepOfInstrument({ leverage_step: "3" })).toBe(3);
    expect(leverageStepOfInstrument(null)).toBe(1);
    expect(leverageStepOfInstrument({ leverage_step: "0.5" })).toBe(1);
  });
});