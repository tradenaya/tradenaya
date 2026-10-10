import { describe, expect, it } from "vitest";
import type { MarketCandle } from "@/automation/types";
import { BacktestExecutionEngine } from "./execution-engine";
import { BacktestPortfolio } from "./portfolio";
import { HistoricalMarketDataAdapter, LIVE_CANDLE_WINDOW } from "./market-adapter";
import { toAutomationConfig, type BacktestConfig } from "./types";

const M5 = 5 * 60_000;
const T0 = 1_700_000_000_000;

function candle(i: number, low: number, high = 101, close = 100): MarketCandle {
  return { timestamp: T0 + i * M5, open: 100, high, low, close, volume: 1000, timeframe: "5" };
}

function engine() {
  return new BacktestExecutionEngine({ feeRateBps: 5, slippageBps: 0, executionPolicy: "CONSERVATIVE" }, new BacktestPortfolio(1000, 0));
}

function order(createdAt: number, expiresAt: number) {
  return {
    symbol: "BTCUSDT",
    side: "BUY" as const,
    limitPrice: 99,
    stopLoss: 90,
    takeProfit: 120,
    quantity: 1,
    leverage: 5,
    margin: 20,
    createdAt,
    expiresAt,
    reason: "test",
    trailingEnabled: false,
    trailingDistancePct: 1,
    trailingActivationPct: 0,
  };
}

describe("backtest ↔ live parity", () => {
  it("never fills an entry on its own signal candle (no look-ahead)", () => {
    const sim = engine();
    const signal = candle(0, 98); // its low touched the limit BEFORE the order existed
    sim.placeOrder(order(signal.timestamp, signal.timestamp + M5 + 30 * 60_000));
    expect(sim.processCandle(signal).orderFilled).toBe(false);
    expect(sim.processCandle(candle(1, 98.5)).orderFilled).toBe(true);
  });

  it("cancels an unfilled entry once a candle opens at/after the expiry", () => {
    const sim = engine();
    const signal = candle(0, 100);
    const expiresAt = signal.timestamp + M5 + 30 * 60_000; // placed at close + 30 min
    sim.placeOrder(order(signal.timestamp, expiresAt));
    for (let i = 1; i <= 6; i++) expect(sim.processCandle(candle(i, 100)).orderFilled).toBe(false);
    // candle 7 opens exactly at expiry -> order gone even though price reaches the limit
    expect(sim.processCandle(candle(7, 98)).orderFilled).toBe(false);
    expect(sim.isIdle()).toBe(true);
  });

  it("passes the strong-momentum setting through to the live engine config", () => {
    const config = { symbol: "BTCUSDT", timeframe: "1h", startTime: 0, endTime: 1, initialCapital: 100, capitalMode: "fixed", leverage: 5, maxRiskPerTrade: 5, dailyLossLimit: 30, enableTrailingStop: false } as BacktestConfig;
    expect(toAutomationConfig({ ...config, momentumEntriesOnly: true }).momentumEntriesOnly).toBe(true);
    expect(toAutomationConfig(config).momentumEntriesOnly).toBe(false);
  });

  it("shows the strategy the same 300-candle window the live bot fetches", async () => {
    const adapter = new HistoricalMarketDataAdapter();
    const candles = Array.from({ length: 1000 }, (_, i) => candle(i, 99));
    adapter.setSlice(candles, 900);
    const snapshot = await adapter.getSnapshot("BTCUSDT", "5m");
    const visible = snapshot.candles["5"];
    expect(visible).toHaveLength(LIVE_CANDLE_WINDOW);
    expect(visible[visible.length - 1].timestamp).toBe(candles[899].timestamp);
  });
});
