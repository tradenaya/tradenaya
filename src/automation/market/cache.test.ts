import { describe, it, expect, vi } from "vitest";
import { MarketDataCache } from "./cache";
import type { MarketTicker, MarketCandle } from "./types";

const ticker = (overrides: Partial<MarketTicker> = {}): MarketTicker => ({
  symbol: "BTCUSDT",
  lastPrice: 100,
  bidPrice: 99,
  askPrice: 101,
  high24h: null,
  low24h: null,
  openPrice: null,
  volume24h: null,
  quoteVolume24h: null,
  changePct24h: null,
  markPrice: null,
  indexPrice: null,
  fundingRate: null,
  openInterest: null,
  exchangeTimestamp: null,
  receivedAt: 0,
  source: "rest",
  ...overrides,
});

const candle = (timestamp: number, close: number, volume = 1): MarketCandle => ({
  timestamp,
  open: 1,
  high: close + 1,
  low: close - 1,
  close,
  volume,
  timeframe: "5",
});

describe("MarketDataCache", () => {
  it("tracks ticker freshness by age", () => {
    const cache = new MarketDataCache({ now: () => 0 });
    expect(cache.freshnessOf("BTCUSDT")).toBe("UNAVAILABLE");

    cache.setTicker("BTCUSDT", ticker({ receivedAt: 0 }));
    expect(cache.freshnessOf("BTCUSDT")).toBe("FRESH");

    const cache2 = new MarketDataCache({ now: () => 30_000 });
    cache2.setTicker("BTCUSDT", ticker({ receivedAt: 0 }));
    expect(cache2.freshnessOf("BTCUSDT")).toBe("STALE");

    const cache3 = new MarketDataCache({ now: () => 120_000 });
    cache3.setTicker("BTCUSDT", ticker({ receivedAt: 0 }));
    expect(cache3.freshnessOf("BTCUSDT")).toBe("UNAVAILABLE");
  });

  it("dedupes and bounds candles per interval", () => {
    const cache = new MarketDataCache();
    const candles = [candle(1000, 10), candle(1000, 11), candle(2000, 12), candle(3000, 13)];
    cache.setCandles("BTCUSDT", "5", candles, 2);
    const stored = cache.getCandles("BTCUSDT", "5");
    expect(stored).toHaveLength(2);
    expect(stored[0].timestamp).toBe(2000);
    expect(stored[1].timestamp).toBe(3000);
    // dedupe kept the higher close
    expect(cache.getCandles("BTCUSDT", "5")[0].close).toBe(12);
  });

  it("upserts a live candle without wiping cached history", () => {
    const cache = new MarketDataCache();
    const history = [candle(1000, 10), candle(2000, 12), candle(3000, 13)];
    cache.setCandles("BTCUSDT", "5", history);
    // a live WS update for the in-progress candle must not clobber history
    cache.upsertCandles("BTCUSDT", "5", [candle(3000, 14, 5)]);
    const stored = cache.getCandles("BTCUSDT", "5");
    expect(stored.map((c) => c.timestamp)).toEqual([1000, 2000, 3000]);
    expect(stored[2].close).toBe(14);
  });

  it("upsert appends new candles and stays bounded", () => {
    const cache = new MarketDataCache();
    cache.setCandles("BTCUSDT", "5", [candle(1000, 10)], 2);
    cache.upsertCandles("BTCUSDT", "5", [candle(2000, 11)], 2);
    cache.upsertCandles("BTCUSDT", "5", [candle(3000, 12)], 2);
    expect(cache.getCandles("BTCUSDT", "5").map((c) => c.timestamp)).toEqual([2000, 3000]);
  });

  it("computes candle freshness from the latest close time", () => {
    const cache = new MarketDataCache({ now: () => 1000 });
    cache.setCandles("BTCUSDT", "5", [candle(1000 - 5 * 60_000, 10)]);
    expect(cache.candleFreshness("BTCUSDT", "5")).toBe("FRESH");

    const cache2 = new MarketDataCache({ now: () => 1000 + 30 * 60_000 });
    cache2.setCandles("BTCUSDT", "5", [candle(1000, 10)]);
    expect(cache2.candleFreshness("BTCUSDT", "5")).toBe("STALE");

    expect(cache.candleFreshness("BTCUSDT", "999")).toBe("UNAVAILABLE");
  });

  it("reference-counts consumers", () => {
    const cache = new MarketDataCache();
    cache.addConsumer("BTCUSDT", "a");
    cache.addConsumer("BTCUSDT", "b");
    expect(cache.consumerCount("BTCUSDT")).toBe(2);
    expect(cache.removeConsumer("BTCUSDT", "a")).toBe(false);
    expect(cache.consumerCount("BTCUSDT")).toBe(1);
    expect(cache.removeConsumer("BTCUSDT", "b")).toBe(true);
    expect(cache.getSubscription("BTCUSDT")).toBeNull();
  });

  it("supports fake timers for scheduling", () => {
    const now = vi.fn(() => 0);
    const cache = new MarketDataCache({ now });
    cache.setTicker("BTCUSDT", ticker({ receivedAt: 0 }));
    now.mockReturnValue(11_000);
    expect(cache.freshnessOf("BTCUSDT")).toBe("STALE");
  });
});
