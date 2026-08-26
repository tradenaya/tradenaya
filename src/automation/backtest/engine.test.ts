import { describe, expect, it } from "vitest";
import type { MarketCandle } from "@/automation/types";
import { BacktestingEngine } from "./engine";
import type { HistoricalMarketDataProvider } from "./data-provider";
import type { BacktestConfig } from "./types";

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

/** Deterministic steadily-rising series that reliably trips the strategy's bullish confirmations. */
function buildUptrend(count: number, seed: number): MarketCandle[] {
  const rand = mulberry32(seed);
  const candles: MarketCandle[] = [];
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const close = open * (1 + 0.0012 + (rand() - 0.35) * 0.004);
    candles.push({
      timestamp: 1_700_000_000_000 + i * INTERVAL_MS,
      open,
      high: Math.max(open, close) * (1 + rand() * 0.002),
      low: Math.min(open, close) * (1 - rand() * 0.002),
      close,
      volume: 500 + rand() * 1500,
      timeframe: "5",
    });
    price = close;
  }
  return candles;
}

function baseConfig(candles: MarketCandle[]): BacktestConfig {
  return {
    symbol: "BTCUSDT",
    timeframe: "5m",
    startTime: candles[0].timestamp,
    endTime: candles[candles.length - 1].timestamp + INTERVAL_MS,
    initialCapital: 1000,
    capitalMode: "fixed",
    leverage: 5,
    maxRiskPerTrade: 1.5,
    dailyLossLimit: 5,
    enableTrailingStop: false,
    warmupCandles: 50,
    minRiskRewardRatio: 1.5,
  };
}

describe("BacktestingEngine (end to end)", () => {
  it("runs the live strategy pipeline and produces a valid result", async () => {
    const candles = buildUptrend(600, 42);
    const provider: HistoricalMarketDataProvider = { getCandles: async () => candles };
    const engine = new BacktestingEngine({ provider, backtestId: 1 });

    const result = await engine.run(baseConfig(candles));

    expect(result.backtestId).toBe(1);
    expect(result.metrics.initialCapital).toBe(1000);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.dataQuality.totalCandles).toBe(600);
    expect(result.dataQuality.seriousProblems).toBe(false);
    expect(result.config.symbol).toBe("BTCUSDT");
  });

  it("generates trades, tracks metrics, and is deterministic", async () => {
    const candles = buildUptrend(600, 7);
    const provider: HistoricalMarketDataProvider = { getCandles: async () => candles };
    const engine = new BacktestingEngine({ provider, backtestId: 2 });

    const first = await engine.run(baseConfig(candles));
    const second = await engine.run(baseConfig(candles));

    expect(first.trades.length).toBeGreaterThan(0);
    expect(second.trades.length).toBe(first.trades.length);
    expect(first.trades).toEqual(second.trades);

    const metrics = first.metrics;
    expect(metrics.tradeCount).toBe(first.trades.length);
    expect(metrics.totalPnl).toBeCloseTo(metrics.finalBalance - metrics.initialCapital, 6);
    expect(metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(metrics.winRate).toBeLessThanOrEqual(100);
    expect(metrics.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(metrics.profitFactor).toBeGreaterThan(0);
    expect(metrics.expectancy).toBeGreaterThan(-metrics.initialCapital);
  });

  it("reports every trade consistently and settles balances against the portfolio", async () => {
    const candles = buildUptrend(400, 21);
    const trades: unknown[] = [];
    const provider: HistoricalMarketDataProvider = { getCandles: async () => candles };
    const engine = new BacktestingEngine({
      provider,
      backtestId: 3,
      onTrade: (trade) => trades.push(trade),
    });

    const result = await engine.run(baseConfig(candles));

    expect(trades.length).toBe(result.trades.length);
    for (const trade of result.trades) {
      expect(trade.netPnl).toBeCloseTo(trade.grossPnl - trade.totalFee, 6);
      expect(trade.totalFee).toBeCloseTo(trade.entryFee + trade.exitFee, 6);
      expect(trade.exitTime).toBeGreaterThanOrEqual(trade.entryTime);
      expect(trade.plannedRiskReward).toBeGreaterThan(0);
      expect(trade.entryPrice).toBeGreaterThan(0);
      expect(trade.exitPrice).toBeGreaterThan(0);
    }
  });

  it("honours cancellation mid-run", async () => {
    const candles = buildUptrend(2000, 99);
    const provider: HistoricalMarketDataProvider = { getCandles: async () => candles };
    let cancelled = false;
    const engine = new BacktestingEngine({
      provider,
      backtestId: 4,
      shouldCancel: () => cancelled,
      onProgress: (progress) => {
        if (progress.percentage >= 40) cancelled = true;
      },
    });

    await expect(engine.run(baseConfig(candles))).rejects.toThrow(/cancelled/i);
  });

  it("throws a clear error when the provider returns no data", async () => {
    const provider: HistoricalMarketDataProvider = { getCandles: async () => [] };
    const engine = new BacktestingEngine({ provider, backtestId: 5 });
    const config = baseConfig([{ timestamp: 1_700_000_000_000, open: 1, high: 1, low: 1, close: 1, volume: 1, timeframe: "5" }]);

    await expect(engine.run(config)).rejects.toThrow(/No historical candles/i);
  });
});
