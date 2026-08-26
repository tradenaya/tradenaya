import { describe, expect, it } from "vitest";
import type { MarketCandle } from "@/automation/types";
import { resampleCandles, resampleByLabel } from "./candle-resampler";

const M5 = 5 * 60_000;
const BUCKET = 15 * 60_000;
// Grid-aligned base: a multiple of the 15m bucket so all expectations are exact.
const BASE = Math.floor(1_700_000_000_000 / BUCKET) * BUCKET;

function candle(openTime: number, open = 100, high = 101, low = 99, close = 100.5, volume = 1000): MarketCandle {
  return { timestamp: openTime, open, high, low, close, volume, timeframe: "5" };
}

describe("candle-resampler", () => {
  it("buckets candles onto the target grid and aggregates OHLCV", () => {
    const candles = [
      candle(BASE, 100, 102, 98, 101, 1000),
      candle(BASE + M5, 101, 103, 99, 102, 2000),
      candle(BASE + 2 * M5, 102, 104, 100, 103, 3000),
      candle(BASE + 3 * M5, 103, 105, 101, 104, 4000), // starts the next bucket -> dropped
    ];

    const result = resampleCandles(candles, 15, 5);

    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(BASE);
    expect(result[0].open).toBe(100);
    expect(result[0].high).toBe(104);
    expect(result[0].low).toBe(98);
    expect(result[0].close).toBe(103);
    expect(result[0].volume).toBe(6000);
  });

  it("drops a partially-formed final bucket (no look-ahead)", () => {
    const full = [candle(BASE), candle(BASE + M5), candle(BASE + 2 * M5)]; // exactly completes a bucket
    expect(resampleCandles(full, 15, 5)).toHaveLength(1);

    // Two of three source candles: the bucket window never closed.
    const partial = resampleCandles(full.slice(0, 2), 15, 5);
    expect(partial).toHaveLength(0);

    // Ending on a bucket boundary (last candle closes at the bucket end) is complete.
    const boundary = [
      candle(BASE),
      candle(BASE + M5),
      candle(BASE + 2 * M5),
      candle(BASE + 3 * M5),
      candle(BASE + 4 * M5),
      candle(BASE + 5 * M5),
    ];
    expect(resampleCandles(boundary, 15, 5)).toHaveLength(2);
  });

  it("is consistent across growing slices (prefix property)", () => {
    const candles: MarketCandle[] = Array.from({ length: 60 }, (_, i) =>
      candle(BASE + i * M5, 100 + i, 101 + i, 99 + i, 100.5 + i),
    );

    const full = resampleCandles(candles, 15, 5);
    expect(full).toHaveLength(20);

    // 57 candles complete 19 buckets; the 20th is incomplete and dropped.
    const exact = resampleCandles(candles.slice(0, 57), 15, 5);
    expect(exact).toHaveLength(19);
    expect(exact).toEqual(full.slice(0, 19));

    // 56 candles leave the 19th bucket half-filled; only 18 survive.
    const partial = resampleCandles(candles.slice(0, 56), 15, 5);
    expect(partial).toHaveLength(18);
    expect(partial).toEqual(full.slice(0, 18));
  });

  it("returns the input candles unchanged when target equals source", () => {
    const candles = [candle(BASE)];
    expect(resampleCandles(candles, 5, 5)).toEqual(candles);
  });

  it("rejects invalid target/source combinations", () => {
    const candles = [candle(BASE)];
    expect(resampleCandles(candles, 5, 15)).toEqual([]); // target < source
    expect(resampleCandles(candles, 7, 5)).toEqual([]); // not an integer multiple
    expect(resampleCandles(candles, 0, 5)).toEqual([]); // degenerate

    // A valid non-trivial multiple: 10m from 5m, with a completed 10m bucket.
    const ten = [candle(BASE, 100, 102, 98, 101, 1000), candle(BASE + M5, 101, 103, 99, 102, 2000)];
    const result = resampleCandles(ten, 10, 5);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(BASE);
    expect(result[0].close).toBe(102);
    expect(result[0].volume).toBe(3000);
  });

  it("handles label-based resampling", () => {
    const candles = [candle(BASE), candle(BASE + M5), candle(BASE + 2 * M5)];
    const result = resampleByLabel(candles, "15m", "5m");
    expect(result).toHaveLength(1);
    expect(result![0].timeframe).toBe("15");

    expect(resampleByLabel(candles, "1h", "7m")).toEqual([]); // 60 is not a multiple of 7
    expect(resampleByLabel(candles, "bogus", "5m")).toBeNull(); // unknown label
  });
});
