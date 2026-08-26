import { describe, expect, it } from "vitest";
import type { MarketCandle } from "@/automation/types";
import { scanCandles } from "./scanner";

const INTERVAL_MS = 5 * 60_000;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Drift + a 3-candle pullback every 30 candles gives realistic swing structure. */
function buildCandles(
  count: number,
  drift: number,
  seed: number,
  noise = 0.0012,
  pullback = 0.005,
  baseVolume = 1000,
): MarketCandle[] {
  const rand = mulberry32(seed);
  const candles: MarketCandle[] = [];
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const inPullback = i % 30 >= 27;
    const move = drift + (inPullback ? (drift > 0 ? -pullback : pullback) : 0);
    const close = open * (1 + move + (rand() - 0.5) * noise);
    candles.push({
      timestamp: 1_700_000_000_000 + i * INTERVAL_MS,
      open,
      high: Math.max(open, close) * (1 + rand() * 0.0004),
      low: Math.min(open, close) * (1 - rand() * 0.0004),
      close,
      volume: baseVolume * (1 + (rand() - 0.5) * 0.2),
      timeframe: "5",
    });
    price = close;
  }
  return candles;
}

describe("scanCandles", () => {
  it("scores an uptrending coin far higher than a sideways one", () => {
    const up = scanCandles("BTCUSDT", "5m", buildCandles(320, 0.0018, 7));
    const flat = scanCandles("BTCUSDT", "5m", buildCandles(320, 0, 21, 0.0004, 0));

    expect(up).not.toBeNull();
    expect(flat).not.toBeNull();
    expect(up!.tradable).toBe(true);
    expect(up!.signal).toBe("BUY");
    expect(up!.side).toBe("LONG");
    expect(up!.trend).toBe("UP");
    expect(up!.score).toBeGreaterThan(flat!.score);
    expect(up!.score).toBeGreaterThanOrEqual(40);
    expect(up!.score).toBeLessThanOrEqual(100);
  });

  it("scores a downtrending coin with a SHORT bias", () => {
    const down = scanCandles("ETHUSDT", "5m", buildCandles(320, -0.0018, 11));
    expect(down!.signal).toBe("SELL");
    expect(down!.side).toBe("SHORT");
    expect(down!.trend).toBe("DOWN");
  });

  it("reports WAIT without a side on sideways data", () => {
    const flat = scanCandles("BTCUSDT", "5m", buildCandles(320, 0, 21, 0.0004, 0));
    expect(flat!.signal).toBe("WAIT");
    expect(flat!.side).toBeNull();
  });

  it("boosts the score of a liquid coin but volume is not the whole story", () => {
    const candles = buildCandles(320, 0.0018, 7);
    const quiet = scanCandles("BTCUSDT", "5m", candles, { quoteVolume24h: 5_000_000 });
    const liquid = scanCandles("BTCUSDT", "5m", candles, { quoteVolume24h: 500_000_000 });
    expect(liquid!.score).toBeGreaterThan(quiet!.score);
    // Participation is capped at 15% of the score — an illiquid but trending
    // coin must still be rankable.
    expect(quiet!.factors.trend).toBeGreaterThan(0);
  });

  it("is deterministic for identical input", () => {
    const candles = buildCandles(320, 0.0018, 7);
    const a = scanCandles("BTCUSDT", "5m", candles);
    const b = scanCandles("BTCUSDT", "5m", candles);
    expect(a).toEqual(b);
  });

  it("handles insufficient data gracefully", () => {
    const result = scanCandles("BTCUSDT", "5m", buildCandles(10, 0.001, 1));
    expect(result!.tradable).toBe(false);
    expect(result!.score).toBe(0);
    expect(result!.signal).toBe("WAIT");
  });
});
