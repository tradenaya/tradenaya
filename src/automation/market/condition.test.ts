import { describe, it, expect } from "vitest";
import { assessCoinCondition, combineConditions, type CoinCondition } from "./condition";
import type { MarketCandle } from "@/automation/types";

/** Build candles from a list of closes; `range` is each candle's high-low as a fraction of price. */
function candles(closes: number[], range: (i: number) => number = () => 0.004): MarketCandle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const half = (close * range(i)) / 2;
    return { timestamp: i * 3_600_000, open, high: Math.max(open, close) + half, low: Math.min(open, close) - half, close, volume: 1, timeframe: "1h" };
  });
}

const N = 150;
const steadyUp = Array.from({ length: N }, (_, i) => 100 * (1 + 0.002 * i));
const sideways = Array.from({ length: N }, (_, i) => 100 + (i % 2 ? 0.3 : -0.3));

describe("market condition — one coin", () => {
  it("steady trend with normal swings → PREDICTABLE, direction UP", () => {
    const c = assessCoinCondition("BTCUSDT", candles(steadyUp))!;
    expect(c.level).toBe("PREDICTABLE");
    expect(c.direction).toBe("UP");
    expect(c.reasons.join(" ")).toMatch(/Clear uptrend/);
  });

  it("steady downtrend → PREDICTABLE, direction DOWN", () => {
    const c = assessCoinCondition("BTCUSDT", candles([...steadyUp].reverse()))!;
    expect(c.level).toBe("PREDICTABLE");
    expect(c.direction).toBe("DOWN");
  });

  it("sideways chop → NORMAL (no clear direction)", () => {
    const c = assessCoinCondition("ETHUSDT", candles(sideways))!;
    expect(c.level).toBe("NORMAL");
    expect(c.direction).toBe("SIDEWAYS");
    expect(c.reasons.join(" ")).toMatch(/No clear direction|not clear/);
  });

  it("swings suddenly much bigger than usual → VOLATILE", () => {
    const c = assessCoinCondition("SOLUSDT", candles(steadyUp, (i) => (i >= N - 20 ? 0.03 : 0.004)))!;
    expect(c.level).toBe("VOLATILE");
    expect(c.swingRatio).toBeGreaterThanOrEqual(1.5);
    expect(c.reasons[0]).toMatch(/bigger than usual/);
  });

  it("one huge candle in the last few → VOLATILE even in a trend", () => {
    const c = assessCoinCondition("XRPUSDT", candles(steadyUp, (i) => (i === N - 2 ? 0.05 : 0.004)))!;
    expect(c.level).toBe("VOLATILE");
    expect(c.reasons.join(" ")).toMatch(/sudden big candle/);
  });

  it("not enough history → no verdict", () => {
    expect(assessCoinCondition("BTCUSDT", candles(steadyUp.slice(0, 30)))).toBeNull();
  });
});

describe("market condition — several coins", () => {
  const coin = (level: CoinCondition["level"]) => ({ level }) as CoinCondition;

  it("mostly predictable and none volatile → PREDICTABLE, Risky can be considered", () => {
    const r = combineConditions([coin("PREDICTABLE"), coin("PREDICTABLE"), coin("NORMAL")]);
    expect(r.level).toBe("PREDICTABLE");
    expect(r.recommended).toBe("RISKY");
  });

  it("a third volatile → VOLATILE, Safe", () => {
    const r = combineConditions([coin("VOLATILE"), coin("PREDICTABLE"), coin("PREDICTABLE")]);
    expect(r.level).toBe("VOLATILE");
    expect(r.recommended).toBe("SAFE");
  });

  it("one volatile out of six blocks PREDICTABLE", () => {
    const r = combineConditions([coin("VOLATILE"), ...Array.from({ length: 5 }, () => coin("PREDICTABLE"))]);
    expect(r.level).toBe("NORMAL");
    expect(r.recommended).toBe("SAFE");
  });

  it("no data → Safe", () => {
    expect(combineConditions([]).recommended).toBe("SAFE");
  });
});
