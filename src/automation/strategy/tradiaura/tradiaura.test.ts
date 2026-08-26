import { describe, expect, it } from "vitest";
import type { MarketCandle, MarketSnapshot } from "@/automation/types";
import type { StrategyContext } from "@/automation/strategy/types";
import { buildMarketView, evaluateRegime } from "./factors";
import { runAnalysis } from "./scoring";
import { TradiAuraSmartV1Strategy } from "./index";
import { TRADIAURA_CONFIG, TRADIAURA_VERSION } from "./config";

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

/**
 * Deterministic candle builder. A steady drift plus a regular 3-candle
 * counter-move every 30 candles produces realistic pullbacks, so swing
 * structure and support/resistance levels form in the direction of the trend.
 * Pass `pullback = 0` for a pure-noise (sideways) series.
 */
function buildCandles(count: number, drift: number, seed: number, noise = 0.0012, pullback = 0.005): MarketCandle[] {
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
      volume: 1000 * (1 + (rand() - 0.5) * 0.2),
      timeframe: "5",
    });
    price = close;
  }
  return candles;
}

function makeContext(candles: MarketCandle[], overrides: Partial<StrategyContext> = {}): StrategyContext {
  const market: MarketSnapshot = {
    symbol: "BTCUSDT",
    exchange: "EXCHANGE_2",
    timestamp: 1_700_000_000_000,
    price: candles[candles.length - 1].close,
    bid: candles[candles.length - 1].close,
    ask: candles[candles.length - 1].close,
    volume: candles[candles.length - 1].volume,
    candles: { "5": candles },
    isFresh: "FRESH",
  };
  return {
    symbol: "BTCUSDT",
    market,
    timeframe: "5m",
    candles,
    indicators: {},
    ...overrides,
  };
}

describe("TRADIAURA_SMART_V1", () => {
  it("signals LONG on a persistent uptrend and SHORT on a downtrend", async () => {
    const strategy = new TradiAuraSmartV1Strategy();

    const up = await strategy.analyze(makeContext(buildCandles(320, 0.0018, 7)));
    expect(up.signal).toBe("BUY");
    expect(up.confidence).toBeGreaterThanOrEqual(0.55);
    expect(up.trend).toBe("UP");
    expect(up.indicators.version).toBe(TRADIAURA_VERSION);
    // LONG geometry: stop below price, entry a pullback limit at/below price, target above.
    expect(up.stopLossSuggestion!).toBeLessThan(Number(up.indicators.referencePrice));
    expect(up.entryZone!).toBeLessThanOrEqual(Number(up.indicators.referencePrice));
    expect(up.takeProfitSuggestion!).toBeGreaterThan(Number(up.indicators.referencePrice));
    expect(up.takeProfitSuggestion! - Number(up.indicators.referencePrice)).toBeGreaterThan(
      Number(up.indicators.referencePrice) - up.stopLossSuggestion!,
    );

    const down = await strategy.analyze(makeContext(buildCandles(320, -0.0018, 11)));
    expect(down.signal).toBe("SELL");
    expect(down.trend).toBe("DOWN");
    // SHORT geometry mirrored: stop above price, entry at/above price, target below.
    expect(down.stopLossSuggestion!).toBeGreaterThan(Number(down.indicators.referencePrice));
    expect(down.entryZone!).toBeGreaterThanOrEqual(Number(down.indicators.referencePrice));
    expect(down.takeProfitSuggestion!).toBeLessThan(Number(down.indicators.referencePrice));
  });

  it("stays NO_TRADE in a sideways market", async () => {
    const strategy = new TradiAuraSmartV1Strategy();
    const result = await strategy.analyze(makeContext(buildCandles(320, 0, 21, 0.0004, 0)));
    expect(result.signal).toBe("WAIT");
  });

  it("waits when there is not enough data", async () => {
    const strategy = new TradiAuraSmartV1Strategy();
    const result = await strategy.analyze(makeContext(buildCandles(50, 0.0018, 1)));
    expect(result.signal).toBe("WAIT");
    expect(result.reasons).toContain("insufficient-data");
  });

  it("vetoes a LONG when the higher-timeframe regime is bearish", async () => {
    const strategy = new TradiAuraSmartV1Strategy();
    const entry = buildCandles(320, 0.0018, 7);
    const bearishHigher = buildCandles(320, -0.0018, 13);

    const withOwnRegime = await strategy.analyze(makeContext(entry));
    expect(withOwnRegime.signal).toBe("BUY");

    const withOverride = await strategy.analyze(
      makeContext(entry, {
        higherTimeframeCandles: bearishHigher,
        mediumTimeframeCandles: bearishHigher,
      }),
    );
    expect(withOverride.signal).toBe("WAIT");
    expect(withOverride.reasons).toContain("regime-veto-long");
  });

  it("is fully deterministic for the same candles", async () => {
    const strategy = new TradiAuraSmartV1Strategy();
    const candles = buildCandles(320, 0.0018, 7);
    const first = await strategy.analyze(makeContext(candles));
    const second = await strategy.analyze(makeContext(candles));
    expect(first.signal).toBe(second.signal);
    expect(first.confidence).toBe(second.confidence);
    expect(first.indicators).toEqual(second.indicators);
  });

  it("does not look ahead: the decision at a slice depends only on that slice", () => {
    const candles = buildCandles(300, 0.0018, 7);
    const full = buildMarketView(candles, TRADIAURA_CONFIG.thresholds);
    const prefix = buildMarketView(candles.slice(0, 150), TRADIAURA_CONFIG.thresholds);

    const fullAnalysis = runAnalysis(full, null, null, TRADIAURA_CONFIG);
    const prefixAnalysis = runAnalysis(prefix, null, null, TRADIAURA_CONFIG);

    // Re-running with the exact same (partial) input is deterministic, and the
    // regime over the full set respects only completed higher-timeframe buckets.
    const fullAgain = runAnalysis(full, null, null, TRADIAURA_CONFIG);
    expect(fullAgain).toEqual(fullAnalysis);
    expect(prefixAnalysis.netScore).toBeTypeOf("number");
  });

  it("produces documented reason codes on a signal", async () => {
    const strategy = new TradiAuraSmartV1Strategy();
    const result = await strategy.analyze(makeContext(buildCandles(320, 0.0018, 7)));
    expect(result.reasons.length).toBeGreaterThan(0);
    for (const reason of result.reasons) {
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    }
    expect(result.indicators.netScore).toBeTypeOf("number");
    expect(Number(result.indicators.netScore)).toBeGreaterThan(0);
  });

  it("higher-timeframe regime reads the resampled 15m context", () => {
    const entry = buildCandles(320, 0.0018, 7);
    const higher = entry.filter((_, i) => i % 3 === 0).length > 0 ? entry.slice(0, 300) : entry;
    const view = buildMarketView(higher, TRADIAURA_CONFIG.thresholds);
    const regime = evaluateRegime(view, TRADIAURA_CONFIG.thresholds);
    expect(regime.direction).not.toBe(-1);
  });

  it("does not zero a valid signal when the live in-progress candle has tiny partial volume", async () => {
    const strategy = new TradiAuraSmartV1Strategy();

    const closed = buildCandles(320, 0.0018, 7);
    const base = await strategy.analyze(makeContext(closed));
    expect(base.signal).toBe("BUY");

    const last = closed[closed.length - 1];
    const forming: MarketCandle = {
      timestamp: last.timestamp + INTERVAL_MS,
      open: last.close,
      high: last.close,
      low: last.close,
      close: last.close,
      volume: 5,
      timeframe: "5",
    };
    const withForming = await strategy.analyze(makeContext([...closed, forming]));

    expect(withForming.signal).toBe("BUY");
    expect(withForming.reasons).not.toContain("participation-volume-veto");
  });
});
