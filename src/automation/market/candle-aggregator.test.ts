import { describe, it, expect } from "vitest";
import { CandleAggregator } from "./candle-aggregator";

describe("CandleAggregator", () => {
  const base = 1_700_000_000_000;

  it("folds trades into one in-progress candle", () => {
    const agg = new CandleAggregator();
    const bucket = Math.floor(base / 300_000) * 300_000;
    expect(agg.fold({ symbol: "BTCUSDT", price: 100, size: 1, time: bucket }, 5)).toBeNull();
    expect(agg.fold({ symbol: "BTCUSDT", price: 110, size: 2, time: bucket + 10_000 }, 5)).toBeNull();
    expect(agg.fold({ symbol: "BTCUSDT", price: 95, size: 3, time: bucket + 20_000 }, 5)).toBeNull();

    const current = agg.peek("BTCUSDT", 5)!;
    expect(current.open).toBe(100);
    expect(current.high).toBe(110);
    expect(current.low).toBe(95);
    expect(current.close).toBe(95);
    expect(current.volume).toBe(6);
  });

  it("returns the closed candle when a new period starts", () => {
    const agg = new CandleAggregator();
    const bucket = Math.floor(base / 300_000) * 300_000;
    agg.fold({ symbol: "BTCUSDT", price: 100, size: 1, time: bucket }, 5);

    const closed = agg.fold({ symbol: "BTCUSDT", price: 200, size: 1, time: bucket + 300_000 }, 5);
    expect(closed).not.toBeNull();
    expect(closed!.close).toBe(100);

    const current = agg.peek("BTCUSDT", 5)!;
    expect(current.open).toBe(200);
  });

  it("keeps symbols and intervals isolated", () => {
    const agg = new CandleAggregator();
    agg.fold({ symbol: "BTCUSDT", price: 100, size: 1, time: base }, 5);
    agg.fold({ symbol: "ETHUSDT", price: 200, size: 1, time: base }, 5);
    agg.fold({ symbol: "BTCUSDT", price: 100, size: 1, time: base }, 15);
    expect(agg.peek("BTCUSDT", 5)).not.toBeNull();
    expect(agg.peek("ETHUSDT", 5)).not.toBeNull();
    expect(agg.peek("BTCUSDT", 15)).not.toBeNull();
    agg.clear("BTCUSDT");
    expect(agg.peek("BTCUSDT", 5)).toBeNull();
    expect(agg.peek("BTCUSDT", 15)).toBeNull();
    expect(agg.peek("ETHUSDT", 5)).not.toBeNull();
  });
});
