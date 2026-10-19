import { describe, expect, it } from "vitest";
import type { MarketCandle } from "@/automation/types";
import { BacktestExecutionEngine } from "@/automation/backtest/execution-engine";
import { BacktestPortfolio } from "@/automation/backtest/portfolio";
import { BacktestingEngine } from "@/automation/backtest/engine";
import { AutomationEngine } from "@/automation/engine/automation-engine";
import { HistoricalMarketDataAdapter } from "@/automation/backtest/market-adapter";
import { sanitizeConfig } from "@/app/api/bots/_helpers";
import {
  EXIT_LOOKBACK,
  MIN_CANDLES,
  STOP_ATR,
  TARGET_R,
  TrendBreakoutPlanner,
  TrendBreakoutStrategy,
  analyzeBreakout,
  channelStop,
} from ".";

const H4 = 4 * 3_600_000;
const T0 = 1_700_000_000_000;

/** `n` candles of a slow uptrend that stays inside a narrow range at the end, then optional last candle. */
function series(n: number, opts: { drift?: number; last?: Partial<MarketCandle> } = {}): MarketCandle[] {
  const drift = opts.drift ?? 0.2;
  const out: MarketCandle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    // gentle trend for most of the history, flat-ish for the last 25 candles (a range)
    if (i < n - 25) price += drift;
    const wiggle = i % 2 ? 0.4 : -0.4;
    const close = price + wiggle;
    out.push({ timestamp: T0 + i * H4, open: price, high: Math.max(price, close) + 0.3, low: Math.min(price, close) - 0.3, close, volume: 1000, timeframe: "4h" });
  }
  if (opts.last) out[out.length - 1] = { ...out[out.length - 1], ...opts.last };
  return out;
}

describe("Trend Breakout — signal rules", () => {
  it("needs enough history for the 200-EMA", () => {
    expect(analyzeBreakout(series(MIN_CANDLES - 1))).toBeNull();
  });

  it("goes LONG on a close above the 20-candle high in an uptrend", () => {
    const base = series(260);
    const high = Math.max(...base.slice(-21, -1).map((c) => c.high));
    const candles = series(260, { last: { close: high + 2, high: high + 2.2, volume: 2000 } });
    const r = analyzeBreakout(candles)!;
    expect(r.signal).toBe("BUY");
    expect(r.close).toBeGreaterThan(r.channelHigh);
    expect(r.close).toBeGreaterThan(r.ema!);
  });

  it("waits while price stays inside the range", () => {
    expect(analyzeBreakout(series(260))!.signal).toBeNull();
  });

  it("ignores a downside break that is against the uptrend", () => {
    const base = series(260);
    const low = Math.min(...base.slice(-21, -1).map((c) => c.low));
    const candles = series(260, { last: { close: low - 1, low: low - 1.2 } });
    const r = analyzeBreakout(candles)!;
    expect(r.close).toBeLessThan(r.channelLow);
    expect(r.close).toBeGreaterThan(r.ema!); // still above the trend line
    expect(r.signal).toBeNull();
  });

  it("rejects a breakout without volume behind it, and says why", () => {
    const base = series(260);
    const high = Math.max(...base.slice(-21, -1).map((c) => c.high));
    const r = analyzeBreakout(series(260, { last: { close: high + 2, high: high + 2.2, volume: 1000 } }))!;
    expect(r.breakout).toBe("BUY");
    expect(r.signal).toBeNull();
    expect(r.rejected).toMatch(/no volume behind the breakout/);
  });

  it("rejects a weak breakout that barely clears the range", () => {
    const base = series(260);
    const high = Math.max(...base.slice(-21, -1).map((c) => c.high));
    const r = analyzeBreakout(series(260, { last: { close: high + 0.05, high: high + 0.1, volume: 2000 } }))!;
    expect(r.breakout).toBe("BUY");
    expect(r.signal).toBeNull();
    expect(r.rejected).toMatch(/breakout too weak/);
  });

  it("rejects a breakout when the market is not trending (low ADX)", () => {
    // flat, choppy history: price oscillates with no trend, then pokes above the range
    const flat: MarketCandle[] = [];
    for (let i = 0; i < 260; i++) {
      const p = 100 + (i % 2 ? 0.6 : -0.6) + (i > 200 ? 0.004 * (i - 200) : 0);
      flat.push({ timestamp: T0 + i * H4, open: p, high: p + 0.5, low: p - 0.5, close: p, volume: 1000, timeframe: "4h" });
    }
    const high = Math.max(...flat.slice(-21, -1).map((c) => c.high));
    flat[259] = { ...flat[259], close: high + 0.6, high: high + 0.7, volume: 2500 };
    const r = analyzeBreakout(flat)!;
    if (r.breakout) {
      expect(r.signal).toBeNull();
      expect(r.rejected).toMatch(/not trending|too weak/);
    }
  });

  it("does not block trades when the feed has no volume data", () => {
    const base = series(260).map((c) => ({ ...c, volume: 0 }));
    const high = Math.max(...base.slice(-21, -1).map((c) => c.high));
    base[259] = { ...base[259], close: high + 2, high: high + 2.2, volume: 0 };
    const r = analyzeBreakout(base)!;
    expect(r.volumeRatio).toBeNull();
    expect(r.signal).toBe("BUY");
  });

  it("strategy decision carries a 2-ATR stop and a TARGET_R target", async () => {
    const base = series(260);
    const high = Math.max(...base.slice(-21, -1).map((c) => c.high));
    const candles = series(260, { last: { close: high + 2, high: high + 2.2, volume: 2000 } });
    const d = await new TrendBreakoutStrategy().analyze({ symbol: "BTCUSDT", timeframe: "4h", candles, indicators: {} as never, market: { price: high + 2 } as never });
    expect(d.signal).toBe("BUY");
    const risk = (d.entryZone as number) - (d.stopLossSuggestion as number);
    expect(risk).toBeCloseTo(STOP_ATR * Number(d.indicators.atr), 6);
    expect((d.takeProfitSuggestion as number) - (d.entryZone as number)).toBeCloseTo(TARGET_R * risk, 6);
  });
});

describe("Trend Breakout — planner", () => {
  const decision = (entry: number, stop: number) => ({
    signal: "BUY" as const,
    confidence: 0.7,
    trend: "UP" as const,
    reasons: ["breakout-up"],
    indicators: {},
    entryZone: entry,
    stopLossSuggestion: stop,
    takeProfitSuggestion: entry + 10 * (entry - stop),
    timestamp: new Date().toISOString(),
  });
  const ctx = (entry: number, stop: number, currentPrice: number) => ({
    strategyDecision: decision(entry, stop),
    currentPrice,
    indicators: {} as never,
    atr: 1,
    config: { symbol: "BTCUSDT", timeframe: "4h", capital: 100, leverage: 5, capitalMode: "fixed" as const },
  });

  it("rests a LIMIT at the breakout close with a TARGET_R cap and a one-candle expiry", () => {
    const before = Date.now();
    const plan = new TrendBreakoutPlanner().plan(ctx(100, 97, 100.5));
    expect(plan).toMatchObject({ action: "BUY", entryType: "LIMIT", limitPrice: 100, stopLoss: 97, takeProfit: 100 + TARGET_R * 3, riskRewardRatio: TARGET_R });
    expect(new Date(plan.expiryTime).getTime() - before).toBeGreaterThanOrEqual(240 * 60_000 - 1000);
  });

  it("uses the live price when it already pulled back below the breakout close", () => {
    const plan = new TrendBreakoutPlanner().plan(ctx(100, 97, 99));
    expect(plan.limitPrice).toBe(99);
    expect(plan.takeProfit).toBeCloseTo(99 + TARGET_R * 2);
  });

  it("keeps the shared safety rules (stop more than 5% away is rejected)", () => {
    expect(new TrendBreakoutPlanner().plan(ctx(100, 90, 100)).action).toBe("WAIT");
  });
});

describe("Trend Breakout — trailing stop", () => {
  const c = (i: number, low: number, high: number): MarketCandle => ({ timestamp: T0 + i * H4, open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 1, timeframe: "4h" });

  it("trails to the lowest low of the last 10 candles and never loosens", () => {
    const candles = Array.from({ length: 12 }, (_, i) => c(i, 100 + i, 105 + i));
    expect(channelStop("BUY", candles, 95)).toBe(102); // lows 102..111 -> min 102
    expect(channelStop("BUY", candles, 104)).toBe(104); // never moves down
    expect(channelStop("SELL", candles, 200)).toBe(116); // highs 107..116 -> max 116
  });

  it("backtest simulator trails the stop to the channel and labels it a trailing exit", () => {
    const sim = new BacktestExecutionEngine({ feeRateBps: 5, slippageBps: 0, executionPolicy: "CONSERVATIVE" }, new BacktestPortfolio(10_000, 0));
    const history = Array.from({ length: EXIT_LOOKBACK }, (_, i) => c(i, 98, 101));
    history.forEach((x) => sim.processCandle(x));
    sim.placeOrder({ symbol: "BTCUSDT", side: "BUY", limitPrice: 100, stopLoss: 90, takeProfit: 200, quantity: 1, leverage: 5, margin: 20, createdAt: history[history.length - 1].timestamp, expiresAt: T0 + 100 * H4, reason: "t", trailingEnabled: false, trailingDistancePct: 1, trailingActivationPct: 0, channelTrailLookback: EXIT_LOOKBACK });
    let i = EXIT_LOOKBACK;
    expect(sim.processCandle(c(i++, 99.5, 101)).orderFilled).toBe(true);
    for (let k = 0; k < 12; k++) sim.processCandle(c(i++, 102 + k, 106 + k)); // trend up, stop follows
    // stop has trailed from 90 to the 10-candle low, above the 100 entry
    expect(sim.getOpenPosition()!.stopLoss).toBe(103);
    const res = sim.processCandle(c(i++, 100, 104)); // drop through the trailed stop
    expect(res.positionClosed).toBe(true);
    expect(res.trade!.exitReason).toBe("TRAILING_STOP");
    expect(res.trade!.netPnl).toBeGreaterThan(0);
  });
});

describe("Trend Breakout — wiring", () => {
  it("bot config: forces the 4h timeframe and drops the momentum filter", () => {
    const cfg = sanitizeConfig({ strategy: "TrendBreakoutV1", timeframe: "5m", momentumEntriesOnly: true, symbol: "BTCUSDT", leverage: 5, capital: 100 });
    expect(cfg).toMatchObject({ strategy: "TrendBreakoutV1", timeframe: "4h", momentumEntriesOnly: false });
    expect(sanitizeConfig({ strategy: "nope", timeframe: "1h", momentumEntriesOnly: true }).strategy).toBe("TradenayaSmartV1");
  });

  it("engine routes a Trend Breakout bot to the breakout strategy + planner", async () => {
    const base = series(320);
    const high = Math.max(...base.slice(-21, -1).map((x) => x.high));
    const candles = series(320, { last: { close: high + 2, high: high + 2.2, volume: 2000 } });
    const adapter = new HistoricalMarketDataAdapter();
    adapter.setSlice(candles, candles.length);
    const result = await new AutomationEngine(adapter).run({ symbol: "BTCUSDT", timeframe: "4h", strategy: "TrendBreakoutV1", leverage: 5, capital: 1000, capitalMode: "fixed", maxRiskPerTrade: 1, dailyLossLimit: 30, enableTrailingStop: false, momentumEntriesOnly: true });
    expect(result.signal).toBe("BUY");
    expect(result.plan?.riskRewardRatio).toBe(TARGET_R);
  });

  it("backtest keeps trading in fixed-capital mode after a losing trade", async () => {
    // Uptrend that steps up every 30 candles (a breakout). The first breakout
    // is followed by a crash through its stop (a loss); later ones run.
    const candles: MarketCandle[] = [];
    let p = 100;
    for (let i = 0; i < 900; i++) {
      if (i % 30 === 0 && i >= 300) p += 3;
      else if (i === 302) p -= 9;
      else p += 0.02;
      const w = i % 2 ? 0.3 : -0.3;
      // breakout candles come with above-average volume, like real ones
      candles.push({ timestamp: T0 + i * H4, open: p - w, high: p + 0.5, low: p - 0.5, close: p + w, volume: i % 30 === 0 && i >= 300 ? 2500 : 1000, timeframe: "4h" });
    }
    const engine = new BacktestingEngine({ provider: { getCandles: async () => candles }, backtestId: 1 });
    const r = await engine.run({ symbol: "BTCUSDT", timeframe: "4h", strategy: "TrendBreakoutV1", startTime: candles[300].timestamp, endTime: candles[899].timestamp + 1, initialCapital: 1000, capitalMode: "fixed", leverage: 5, maxRiskPerTrade: 1, dailyLossLimit: 30, enableTrailingStop: false });
    const firstLoss = r.trades.findIndex((t) => t.netPnl < 0);
    expect(firstLoss).toBeGreaterThanOrEqual(0);
    expect(r.trades.length).toBeGreaterThan(firstLoss + 1);
  });
});
