import { describe, expect, it } from "vitest";
import type { AutomationConfig } from "@/automation/types";
import { leverageFromInstrument, resolveLeverage } from "./coin-auto-selector";
import type { CoinOpportunity } from "@/automation/opportunity/scanner";

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
    }
  });

  it("respects the exchange minimum leverage", () => {
    const lev = resolveLeverage(config({ leverageMode: "auto" }), {
      min_leverage: "5",
      max_leverage: "100",
    });
    expect(lev).toBeGreaterThanOrEqual(5);
  });

  it("never picks unnecessarily tiny leverage when the coin supports higher", () => {
    const lev = resolveLeverage(
      config({ leverageMode: "auto" }),
      { min_leverage: "1", max_leverage: "100" },
      opportunity({ atrPct: 0.3, confidence: 0.8, factors: { ...opportunity().factors, volatility: 0.2 } }),
    );
    expect(lev).toBeGreaterThan(20);
  });

  it("reduces leverage on high volatility setups", () => {
    const calm = resolveLeverage(
      config({ leverageMode: "auto" }),
      { min_leverage: "1", max_leverage: "100" },
      opportunity({ atrPct: 0.3, confidence: 0.7 }),
    );
    const wild = resolveLeverage(
      config({ leverageMode: "auto" }),
      { min_leverage: "1", max_leverage: "100" },
      opportunity({ atrPct: 3.0, confidence: 0.7 }),
    );
    expect(wild).toBeLessThan(calm);
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