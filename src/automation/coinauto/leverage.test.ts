import { describe, expect, it } from "vitest";
import type { AutomationConfig } from "@/automation/types";
import {
  LEVERAGE_UNSAFE,
  leverageFromInstrument,
  leverageStepOf,
  liquidationSafeMaxLeverage,
  maintenanceMarginPctOf,
  resolveLeverage,
} from "./leverage";
import type { CoinOpportunity } from "@/automation/opportunity/scanner";
import { evaluateLiquidationSafety } from "@/automation/risk/liquidation-safety";

function config(overrides: Partial<AutomationConfig> = {}): AutomationConfig {
  return {
    symbol: "AUTO",
    timeframe: "1h",
    leverage: 5,
    autoSelect: true,
    leverageMode: "auto",
    leveragePercent: 50,
    capital: 100,
    capitalMode: "fixed",
    maxRiskPerTrade: 1,
    dailyLossLimit: 5,
    enableTrailingStop: false,
    ...overrides,
  };
}

function opportunity(overrides: Partial<CoinOpportunity> = {}): CoinOpportunity {
  return {
    symbol: "BTCUSDT",
    timeframe: "1h",
    price: 100,
    signal: "BUY",
    side: "LONG",
    confidence: 0.7,
    score: 70,
    trend: "UP",
    regime: "UP",
    factors: {
      regime: 0.5,
      trend: 0.6,
      structure: 0.7,
      momentum: 0.6,
      participation: 0.5,
      volatility: 0.3,
      entryLocation: 0.7,
      riskReward: 0.8,
      flow: 0.5,
    },
    vetoes: [],
    reasons: [],
    reasonsText: "",
    atrPct: 0.5,
    rsi: 55,
    adx: 25,
    volumeRatio: 1.2,
    netScore: 0.6,
    longNetScore: 0.7,
    shortNetScore: 0.3,
    tradable: true,
    ...overrides,
  };
}

/**
 * Pre-fix AUTO resolver oracle (regression reference): the old code returned
 * max(round(maxLeverage × riskRatio × volAdjustment × confidenceBoost), 25%-of-max floor).
 * We reproduce it here ONLY to prove the new resolver caps leverage that the
 * old formula used to produce (65x / 62x production scenarios).
 */
function oldAutoLeverage(max: number, opp: { atrPct: number; confidence: number; volatility: number }): number {
  const atrPct = Math.max(0, opp.atrPct);
  let riskRatio;
  if (atrPct >= 2) riskRatio = 0.25;
  else if (atrPct >= 1.2) riskRatio = 0.4;
  else if (atrPct >= 0.6) riskRatio = 0.6;
  else riskRatio = 0.8;
  const clampRound = (value: number, min: number, max: number) => Math.min(Math.max(Math.round(value), min), max);
  const volAdjustment = 1 - clampRound(opp.volatility, 0, 1) * 0.35;
  const confidenceBoost = 1 + clampRound(opp.confidence, 0, 1) * 0.25;
  const effective = max * riskRatio * volAdjustment * confidenceBoost;
  const flatValue = clampRound(effective, 1, max);
  const floor = max >= 4 ? Math.max(1, Math.round(max * 0.25)) : 1;
  return Math.max(flatValue, floor);
}

describe("resolveLeverage — manual percentage mapping", () => {
  it("50% of 100x → 50x", () => {
    const lev = resolveLeverage(config({ leverageMode: "manual", leveragePercent: 50 }), {
      min_leverage: "1",
      max_leverage: "100",
    });
    expect(lev).toBe(50);
  });

  it("50% of 50x → 25x", () => {
    const lev = resolveLeverage(config({ leverageMode: "manual", leveragePercent: 50 }), {
      min_leverage: "1",
      max_leverage: "50",
    });
    expect(lev).toBe(25);
  });

  it("50% of 30x → 15x", () => {
    const lev = resolveLeverage(config({ leverageMode: "manual", leveragePercent: 50 }), {
      min_leverage: "1",
      max_leverage: "30",
    });
    expect(lev).toBe(15);
  });

  it("language: the same 50% preference stays consistent as coins change max leverage", () => {
    const pct = 50;
    const maxes = [100, 75, 50, 30, 20, 10];
    const expected = maxes.map((m) => Math.round((m * pct) / 100));
    maxes.forEach((m, i) => {
      const lev = resolveLeverage(config({ leverageMode: "manual", leveragePercent: pct }), {
        min_leverage: "1",
        max_leverage: String(m),
      });
      expect(lev).toBe(expected[i]);
    });
  });

  it("100% maps to the max leverage, 1% never below minimum", () => {
    const img = { min_leverage: "2", max_leverage: "100" };
    expect(resolveLeverage(config({ leverageMode: "manual", leveragePercent: 100 }), img)).toBe(100);
    expect(resolveLeverage(config({ leverageMode: "manual", leveragePercent: 1 }), img)).toBe(2);
  });

  it("a manual percent higher than the coin supports clamps to the exchange max", () => {
    // 80% of a 30x max = 24x, still in range; test an oversized max impossible
    // value clamps instead of exceeding the exchange cap.
    const img = { min_leverage: "1", max_leverage: "30" };
    const lev = resolveLeverage(config({ leverageMode: "manual", leveragePercent: 500 }), img);
    expect(lev).toBeLessThanOrEqual(30);
    expect(lev).toBe(30);
  });

  it("returns the exchange min when no manual % is configured", () => {
    const img = { min_leverage: "3", max_leverage: "100" };
    expect(resolveLeverage(config({ leverageMode: "manual", leveragePercent: 0 }), img)).toBe(3);
  });
});

describe("resolveLeverage — AUTO mode safety", () => {
  it("never exceeds the exchange maximum leverage", () => {
    const maxes = [5, 10, 20, 30, 50, 100];
    for (const max of maxes) {
      const lev = resolveLeverage(config({ leverageMode: "auto" }), {
        min_leverage: "1",
        max_leverage: String(max),
      });
      expect(lev).toBeGreaterThanOrEqual(1);
      expect(lev).toBeLessThanOrEqual(max);
      expect(lev).not.toBe(LEVERAGE_UNSAFE);
    }
  });

  it("respects the exchange minimum leverage", () => {
    const lev = resolveLeverage(config({ leverageMode: "auto" }), {
      min_leverage: "5",
      max_leverage: "100",
    });
    expect(lev).toBeGreaterThanOrEqual(5);
    expect(lev).not.toBe(LEVERAGE_UNSAFE);
  });

  it("never picks unnecessarily tiny leverage when the coin supports higher safe leverage", () => {
    // 1% max stop distance → generous liquidation-safe ceiling (51x), so the
    // ~25%-of-max preference can still choose a meaningful value.
    const lev = resolveLeverage(
      config({ leverageMode: "auto", minStopDistancePct: 0.005, maxStopDistancePct: 0.01 }),
      { min_leverage: "1", max_leverage: "100" },
      opportunity({ atrPct: 0.3, confidence: 0.8, factors: { ...opportunity().factors, volatility: 0.2 } }),
    );
    expect(lev).toBeGreaterThan(20);
  });

  it("reduces leverage on high volatility setups", () => {
    const cfg = config({ leverageMode: "auto", minStopDistancePct: 0.005, maxStopDistancePct: 0.01 });
    const calm = resolveLeverage(
      cfg,
      { min_leverage: "1", max_leverage: "100" },
      opportunity({ atrPct: 0.3, confidence: 0.7 }),
    );
    const wild = resolveLeverage(
      cfg,
      { min_leverage: "1", max_leverage: "100" },
      opportunity({ atrPct: 3.0, confidence: 0.7 }),
    );
    expect(wild).toBeLessThan(calm);
  });
});

describe("resolveLeverage — AUTO liquidation-aware cap", () => {
  it("normal AUTO behavior respects the liquidation-safe ceiling", () => {
    // atr 0.5% → riskRatio 0.8, vol→0.35 drop, conf→+25%: effective = 100x·0.8·1.25 = 100.
    // Conservative stop (maxStopDistancePct 3%) + 0.65% maint + 0.3% buffer →
    // maxSafe = floor(1/0.0395) = 25. Result must be 25, never the raw 100x.
    const lev = resolveLeverage(
      config({ leverageMode: "auto", maxStopDistancePct: 0.03 }),
      { min_leverage: "1", max_leverage: "100" },
      opportunity({ atrPct: 0.5, confidence: 0.7, factors: { ...opportunity().factors, volatility: 0.3 } }),
    );
    expect(lev).toBe(25);
    expect(lev).toBeLessThanOrEqual(liquidationSafeMaxLeverage(config({ maxStopDistancePct: 0.03 }), opportunity({ atrPct: 0.5 }), maintenanceMarginPctOf(null))!);
  });

  it("caps block a previously-computed high AUTO leverage (liquidation-aware cap)", () => {
    const img = { min_leverage: "1", max_leverage: "100" };
    // effective = 100x·0.8·1.25 = 100 (raw); default 5% stop → maxSafe 16.
    const lev = resolveLeverage(
      config({ leverageMode: "auto" }),
      img,
      opportunity({ atrPct: 0.3, confidence: 0.9, factors: { ...opportunity().factors, volatility: 0 } }),
    );
    expect(lev).toBe(16);
    expect(lev).toBeLessThanOrEqual(16);
  });

  it("the 25%-of-max floor cannot force leverage above the liquidation-safe maximum", () => {
    // min 10x, max 100x → floor = 25; but the 5% conservative stop allows only
    // 16x. The floor must NOT win — leverage stays 16 (≤ maxSafe).
    const img = { min_leverage: "10", max_leverage: "100" };
    const lev = resolveLeverage(config({ leverageMode: "auto" }), img);
    expect(lev).toBe(16);
    expect(lev).toBeLessThan(25);
    expect(lev).toBeLessThanOrEqual(liquidationSafeMaxLeverage(config({}), null, maintenanceMarginPctOf(img))!);
  });

  it("safe maximum below the exchange minimum → reject/WAIT (LEVERAGE_UNSAFE)", () => {
    // min 20x > maxSafe 16x (5% stop) → no valid liquidation-safe leverage.
    const img = { min_leverage: "20", max_leverage: "100" };
    expect(resolveLeverage(config({ leverageMode: "auto" }), img)).toBe(LEVERAGE_UNSAFE);
    // MAXIMUM "100x" is irrelevant — something platform-legal but unsafe must fail.
    expect(resolveLeverage(config({ leverageMode: "auto" }), { min_leverage: "20", max_leverage: "25" })).toBe(LEVERAGE_UNSAFE);
  });

  it("leverage-step rounding always rounds DOWN to a valid exchange step", () => {
    // effective = 77·0.6 = 46.2; step 5 → 45 (never rounded up to 50).
    const img = { min_leverage: "1", max_leverage: "77", leverage_step: "5" };
    const lev = resolveLeverage(
      config({ leverageMode: "auto", maxStopDistancePct: 0.005 }),
      img,
      opportunity({ atrPct: 0.7, confidence: 0, factors: { ...opportunity().factors, volatility: 0 } }),
    );
    expect(lev).toBe(45);
    expect(lev).toBeLessThan(46.2);
    expect(lev % leverageStepOf(img)).toBe(0);
  });

  it("uses the per-symbol maintenance margin when available", () => {
    const withMaint = { min_leverage: "1", max_leverage: "100", maint_margin_rate: "0.4" };
    const withoutMaint = { min_leverage: "1", max_leverage: "100" };
    const opp = opportunity({ atrPct: 0.3, confidence: 1, factors: { ...opportunity().factors, volatility: 0 } });
    const levWithMaint = resolveLeverage(config({ leverageMode: "auto" }), withMaint, opp);
    const levFallback = resolveLeverage(config({ leverageMode: "auto" }), withoutMaint, opp);
    // With maint 0.4%: floor(1/0.057) = 17. Fallback 0.65%: floor(1/0.0595) = 16.
    expect(maintenanceMarginPctOf(withMaint)).toBe(0.4);
    expect(maintenanceMarginPctOf(withoutMaint)).toBe(0.65);
    expect(levWithMaint).toBe(17);
    expect(levFallback).toBe(16);
  });

  it("missing maintenance margin keeps the conservative system fallback", () => {
    const img = { min_leverage: "1", max_leverage: "100" };
    const opp = opportunity({ atrPct: 0.3, confidence: 1, factors: { ...opportunity().factors, volatility: 0 } });
    expect(maintenanceMarginPctOf(img)).toBe(0.65);
    expect(liquidationSafeMaxLeverage(config({}), opp, maintenanceMarginPctOf(img))).toBe(16);
    expect(resolveLeverage(config({ leverageMode: "auto" }), img, opp)).toBe(16);
  });

  it("BTCUSDT 65x production scenario now resolves to a liquidation-safe leverage", () => {
    // Pre-fix formula produced exactly 65x for this setup (max 100, atr 0.5%,
    // conf 0.9, vol 0.6): 100·0.8·(1−0.35)·1.25 = 65.
    const img = { min_leverage: "1", max_leverage: "100", leverage_step: "1" };
    const opp = opportunity({ atrPct: 0.5, confidence: 0.9, factors: { ...opportunity().factors, volatility: 0.6 } });
    const old = oldAutoLeverage(100, { atrPct: 0.5, confidence: 0.9, volatility: 0.6 });
    expect(old).toBe(65);
    const lev = resolveLeverage(config({ leverageMode: "auto" }), img, opp);
    expect(lev).toBeLessThan(old);
    expect(lev).toBe(16); // 5% conservative stop + fallback 0.65% maint + 0.3% buffer
    expect(lev).toBeLessThanOrEqual(liquidationSafeMaxLeverage(config({}), opp, maintenanceMarginPctOf(img))!);
  });

  it("SPCXUSDT 62x production scenario now resolves to a liquidation-safe leverage", () => {
    // Per-symbol maint margin 0.70%. Pre-fix formula produced 62x for max 62x.
    const img = { min_leverage: "1", max_leverage: "62", leverage_step: "1", maint_margin_rate: "0.7" };
    const opp = opportunity({ atrPct: 0.5, confidence: 0.9, factors: { ...opportunity().factors, volatility: 0 } });
    const old = oldAutoLeverage(62, { atrPct: 0.5, confidence: 0.9, volatility: 0 });
    expect(old).toBe(62);
    const lev = resolveLeverage(config({ leverageMode: "auto" }), img, opp);
    expect(lev).toBeLessThan(old);
    // 5% stop + maint 0.70% + buffer 0.3% → floor(1/0.06) = 16.
    expect(maintenanceMarginPctOf(img)).toBe(0.7);
    expect(lev).toBe(16);
  });

  it("a genuinely unsafe SL is still rejected by the planner/executor liquidation gate", () => {
    const entry = 100;
    const stopLoss = 96; // 5% stop below entry
    // At the OLD 65x the gate must reject (SL beyond the liquidation boundary).
    const unsafe = evaluateLiquidationSafety({ side: "BUY", entryPrice: entry, stopLoss, leverage: 65 });
    expect(unsafe.ok).toBe(false);
    // At the NEW 16x the same SL is safely reachable before liquidation.
    const safe = evaluateLiquidationSafety({ side: "BUY", entryPrice: entry, stopLoss, leverage: 16 });
    expect(safe.ok).toBe(true);
    // And a boundary that is genuinely too wide is STILL rejected at 16x too.
    const stillUnsafe = evaluateLiquidationSafety({ side: "BUY", entryPrice: entry, stopLoss: 92.5, leverage: 16 });
    expect(stillUnsafe.ok).toBe(false);
  });
});

describe("leverageFromInstrument", () => {
  it("parses min/max and falls back to the caller's leverage when absent", () => {
    expect(leverageFromInstrument({ min_leverage: "2", max_leverage: "75" })).toEqual({
      minLeverage: 2,
      maxLeverage: 75,
    });
    expect(leverageFromInstrument(null)).toEqual({ minLeverage: 1, maxLeverage: 1 });
    expect(leverageFromInstrument({}, 10)).toEqual({ minLeverage: 1, maxLeverage: 10 });
  });
});