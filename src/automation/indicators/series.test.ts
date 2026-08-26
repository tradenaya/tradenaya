import { describe, expect, it } from "vitest";
import {
  adxSeries,
  atrSeries,
  bollingerSeries,
  emaSeries,
  lastValue,
  macdSeries,
  rocSeries,
  rsiSeries,
  smaSeries,
  supertrendSeries,
  vwapSeries,
} from "./series";
import type { MarketCandle } from "@/automation/types";

describe("indicator series", () => {
  it("computes SMA with the correct alignment", () => {
    const out = smaSeries([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([null, null, 2, 3, 4]);
  });

  it("EMA stays between the price and its own previous value on an uptrend", () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i);
    const ema = emaSeries(closes, 20);
    const latest = lastValue(ema)!;
    expect(latest).toBeGreaterThan(100);
    expect(latest).toBeLessThan(199);
  });

  it("RSI is 100 on a monotonic uptrend and 0 on a monotonic downtrend", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(lastValue(rsiSeries(up, 14))).toBe(100);

    const down = Array.from({ length: 30 }, (_, i) => 300 - i);
    expect(lastValue(rsiSeries(down, 14))).toBe(0);
  });

  it("RSI is 50 on a flat series", () => {
    const flat = Array.from({ length: 30 }, () => 100);
    expect(lastValue(rsiSeries(flat, 14))).toBe(50);
  });

  it("ATR is zero on constant candles and positive on volatile candles", () => {
    const constant = Array.from({ length: 30 }, () => ({ high: 100, low: 100, close: 100 }));
    const out = atrSeries(constant.map((c) => c.high), constant.map((c) => c.low), constant.map((c) => c.close), 14);
    expect(lastValue(out)).toBe(0);

    const volatile = constant.map((c, i) => ({ high: 100 + i * 0.5, low: 100 - i * 0.5, close: 100 }));
    const out2 = atrSeries(volatile.map((c) => c.high), volatile.map((c) => c.low), volatile.map((c) => c.close), 14);
    expect(lastValue(out2)!).toBeGreaterThan(0);
  });

  it("MACD is positive in an uptrend and its histogram has values", () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 0.5);
    const macd = macdSeries(closes);
    expect(lastValue(macd.macd)!).toBeGreaterThan(0);
    expect(lastValue(macd.signal)).not.toBeNull();
    expect(lastValue(macd.histogram)).not.toBeNull();
  });

  it("ADX is higher in a strong trend than in a range", () => {
    const trendCloses = Array.from({ length: 100 }, (_, i) => 100 + i * 0.3);
    const trend = adxSeries(
      trendCloses.map((c) => c + 1),
      trendCloses.map((c) => c - 1),
      trendCloses,
      14,
    );
    const rangeCloses = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 3) * 2);
    const range = adxSeries(
      rangeCloses.map((c) => c + 1),
      rangeCloses.map((c) => c - 1),
      rangeCloses,
      14,
    );
    expect(lastValue(trend)!).toBeGreaterThan(lastValue(range)!);
  });

  it("Bollinger bands are ordered upper >= middle >= lower", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 3);
    const { upper, middle, lower } = bollingerSeries(closes, 20, 2);
    const u = lastValue(upper)!;
    const m = lastValue(middle)!;
    const l = lastValue(lower)!;
    expect(u).toBeGreaterThanOrEqual(m);
    expect(m).toBeGreaterThanOrEqual(l);
  });

  it("ROC is a percentage change", () => {
    const out = rocSeries([100, 110], 1);
    expect(out).toEqual([null, 10]);
  });

  it("VWAP lies inside the price range of the window", () => {
    const candles: MarketCandle[] = Array.from({ length: 30 }, (_, i) => ({
      timestamp: i * 60_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1000 + i,
      timeframe: "1",
    }));
    const vwap = lastValue(vwapSeries(candles, 20))!;
    expect(vwap).toBeGreaterThan(99);
    expect(vwap).toBeLessThan(101);
  });

  it("Supertrend direction is +1 in an uptrend and -1 in a downtrend", () => {
    const upCloses = Array.from({ length: 60 }, (_, i) => 100 + i * 0.2);
    const up = supertrendSeries(upCloses.map((c) => c + 1), upCloses.map((c) => c - 1), upCloses, 10, 3);
    expect(lastValue(up.direction)).toBe(1);

    const downCloses = Array.from({ length: 60 }, (_, i) => 120 - i * 0.2);
    const down = supertrendSeries(downCloses.map((c) => c + 1), downCloses.map((c) => c - 1), downCloses, 10, 3);
    expect(lastValue(down.direction)).toBe(-1);
  });
});
