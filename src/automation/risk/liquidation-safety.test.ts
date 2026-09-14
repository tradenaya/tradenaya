import { describe, it, expect } from "vitest";
import { evaluateLiquidationSafety, estimateLiquidationPrice, validateStopLossBoundary } from "@/automation/risk/liquidation-safety";

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