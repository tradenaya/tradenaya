import { describe, expect, it } from "vitest";
import type { ClosedTradeRow } from "./types";
import {
  aggregateByStrategy,
  aggregateBySymbol,
  buildEquityCurve,
  buildPnlSeries,
  computeExitAnalytics,
  computeTradeStatistics,
  sumFees,
  unrealizedOfPosition,
} from "./calculators";
import type { BotRow, OpenPositionRow } from "./types";

const DAY_MS = 86_400_000;
const DAY_1 = Date.UTC(2026, 0, 1);
const DAY_2 = DAY_1 + DAY_MS;
const DAY_3 = DAY_2 + DAY_MS;

function trade(overrides: Partial<ClosedTradeRow> = {}): ClosedTradeRow {
  return {
    id: 1,
    executionId: 1,
    botId: 1,
    userId: 1,
    symbol: "BTCUSDT",
    side: "BUY",
    entryPrice: 100,
    exitPrice: 110,
    exitReason: "TAKE_PROFIT",
    realizedPnl: 10,
    fees: 0.5,
    grossProfit: 0,
    commission: 0,
    fundingFee: 0,
    netPnl: 0,
    positionSize: 1,
    closedAt: new Date(DAY_1).toISOString(),
    createdAt: new Date(DAY_1).toISOString(),
    entryTime: new Date(DAY_1 - 60_000).toISOString(),
    durationMs: 60_000,
    trailingActivated: false,
    highestPrice: 111,
    lowestPrice: 99,
    leverage: null,
    stopLoss: null,
    takeProfit: null,
    ...overrides,
  };
}

function bot(overrides: Partial<BotRow> = {}): BotRow {
  return {
    id: 1,
    userId: 1,
    symbol: "BTCUSDT",
    strategy: "MultiTimeframe",
    leverage: 5,
    capital: 1000,
    capitalMode: "fixed",
    walletPercent: null,
    status: "RUNNING",
    desiredStatus: "RUNNING",
    currentTrade: null,
    lastAnalysisAt: null,
    lastExecutionAt: null,
    configJson: null,
    lastError: null,
    retryCount: null,
    heartbeatAt: null,
    createdAt: new Date(DAY_1).toISOString(),
    updatedAt: new Date(DAY_1).toISOString(),
    ...overrides,
  };
}

describe("calculators - money precision", () => {
  it("accumulates PnL without float drift via Money-backed sums", () => {
    const trades = [0.1, 0.2, 0.3, -0.15, 1.00000001].map((pnl, i) =>
      trade({ id: i + 1, realizedPnl: pnl, fees: 0 }),
    );
    const stats = computeTradeStatistics(trades);
    expect(stats.grossProfit).toBeCloseTo(1.60000001, 8);
    expect(stats.grossLoss).toBeCloseTo(0.15, 8);
    expect(stats.averageTradePnl).toBeCloseTo(1.45000001 / 5, 8);
  });

  it("sums fees exactly", () => {
    const trades = [trade({ fees: 0.1 }), trade({ id: 2, fees: 0.2 }), trade({ id: 3, fees: 0.3 })];
    expect(sumFees(trades)).toBeCloseTo(0.6, 8);
  });
});

describe("computeTradeStatistics", () => {
  it("computes counts, win rate and profit factor", () => {
    const trades = [
      trade({ id: 1, realizedPnl: 20, side: "BUY", closedAt: new Date(DAY_1).toISOString() }),
      trade({ id: 2, realizedPnl: -5, side: "SELL", closedAt: new Date(DAY_2).toISOString() }),
      trade({ id: 3, realizedPnl: 10, side: "BUY", closedAt: new Date(DAY_3).toISOString() }),
    ];
    const stats = computeTradeStatistics(trades);
    expect(stats.totalTrades).toBe(3);
    expect(stats.longTrades).toBe(2);
    expect(stats.shortTrades).toBe(1);
    expect(stats.winningTrades).toBe(2);
    expect(stats.losingTrades).toBe(1);
    expect(stats.winRate).toBeCloseTo(66.7, 1);
    expect(stats.grossProfit).toBeCloseTo(30, 8);
    expect(stats.grossLoss).toBeCloseTo(5, 8);
    expect(stats.profitFactor).toBeCloseTo(6, 8);
    expect(stats.largestWin).toBeCloseTo(20, 8);
    expect(stats.largestLoss).toBeCloseTo(-5, 8);
  });

  it("returns null profit factor when there are no losing trades", () => {
    const stats = computeTradeStatistics([trade({ id: 1, realizedPnl: 5 })]);
    expect(stats.profitFactor).toBeNull();
  });

  it("tracks consecutive wins and losses in chronological order", () => {
    const trades = [
      trade({ id: 1, realizedPnl: 1, closedAt: new Date(DAY_1).toISOString() }),
      trade({ id: 2, realizedPnl: -1, closedAt: new Date(DAY_2).toISOString() }),
      trade({ id: 3, realizedPnl: 2, closedAt: new Date(DAY_2 + 60_000).toISOString() }),
      trade({ id: 4, realizedPnl: 3, closedAt: new Date(DAY_3).toISOString() }),
      trade({ id: 5, realizedPnl: -2, closedAt: new Date(DAY_3 + 60_000).toISOString() }),
      trade({ id: 6, realizedPnl: -1, closedAt: new Date(DAY_3 + 120_000).toISOString() }),
    ];
    const stats = computeTradeStatistics(trades);
    expect(stats.maxConsecutiveWins).toBe(2);
    expect(stats.maxConsecutiveLosses).toBe(2);
  });
});

describe("buildEquityCurve", () => {
  it("produces a daily curve with drawdown", () => {
    const trades = [
      trade({ id: 1, realizedPnl: 100, closedAt: new Date(DAY_1).toISOString() }),
      trade({ id: 2, realizedPnl: -50, closedAt: new Date(DAY_2).toISOString() }),
      trade({ id: 3, realizedPnl: -20, closedAt: new Date(DAY_3).toISOString() }),
    ];
    const equity = buildEquityCurve({ trades, startingEquity: 1000 });
    expect(equity.startingEquity).toBe(1000);
    expect(equity.currentEquity).toBeCloseTo(1030, 8);
    expect(equity.peakEquity).toBeCloseTo(1100, 8);
    expect(equity.maxDrawdown).toBeCloseTo(70, 8);
    expect(equity.maxDrawdownPct).toBeCloseTo(6.36, 2);
    expect(equity.points.length).toBeGreaterThan(1);
    expect(equity.points[0].equity).toBe(1000);
  });

  it("handles an empty trade list", () => {
    const equity = buildEquityCurve({ trades: [], startingEquity: 500 });
    expect(equity.currentEquity).toBe(500);
    expect(equity.maxDrawdown).toBe(0);
  });
});

describe("buildPnlSeries", () => {
  it("buckets daily, keeps cumulative, adds unrealized to the last point", () => {
    const trades = [
      trade({ id: 1, realizedPnl: 10, closedAt: new Date(DAY_1).toISOString() }),
      trade({ id: 2, realizedPnl: 5, closedAt: new Date(DAY_2).toISOString() }),
    ];
    const series = buildPnlSeries({
      trades,
      unrealized: 7,
      granularity: "daily",
      startTime: DAY_1,
      endTime: DAY_2 + DAY_MS,
      now: DAY_2 + DAY_MS,
    });
    expect(series.realizedTotal).toBeCloseTo(15, 8);
    expect(series.unrealizedTotal).toBeCloseTo(7, 8);
    expect(series.cumulativeTotal).toBeCloseTo(22, 8);
    const last = series.points[series.points.length - 1];
    expect(last.unrealized).toBeCloseTo(7, 8);
    expect(last.realized).toBeCloseTo(0, 8);
    expect(last.total).toBeCloseTo(7, 8);
    expect(last.cumulative).toBeCloseTo(15, 8);
  });
});

describe("aggregation", () => {
  it("groups by symbol with win rates", () => {
    const trades = [
      trade({ id: 1, symbol: "BTCUSDT", realizedPnl: 10, side: "BUY" }),
      trade({ id: 2, symbol: "BTCUSDT", realizedPnl: -5, side: "SELL" }),
      trade({ id: 3, symbol: "ETHUSDT", realizedPnl: 20, side: "BUY" }),
    ];
    const symbols = aggregateBySymbol(trades);
    expect(symbols).toHaveLength(2);
    const btc = symbols.find((s) => s.symbol === "BTCUSDT")!;
    expect(btc.pnl).toBeCloseTo(5, 8);
    expect(btc.trades).toBe(2);
    expect(btc.winRate).toBeCloseTo(50, 1);
    const eth = symbols.find((s) => s.symbol === "ETHUSDT")!;
    expect(eth.winRate).toBeCloseTo(100, 1);
  });

  it("groups by strategy and reports bot counts", () => {
    const bots = new Map<number, BotRow>([
      [1, bot({ id: 1, strategy: "MultiTimeframe" })],
      [2, bot({ id: 2, strategy: "Breakout" })],
    ]);
    const trades = [
      trade({ id: 1, botId: 1, realizedPnl: 10 }),
      trade({ id: 2, botId: 1, realizedPnl: -4 }),
      trade({ id: 3, botId: 2, realizedPnl: 8 }),
    ];
    const strategies = aggregateByStrategy(trades, bots);
    expect(strategies).toHaveLength(2);
    const mf = strategies.find((s) => s.strategy === "MultiTimeframe")!;
    expect(mf.bots).toBe(1);
    expect(mf.trades).toBe(2);
    expect(mf.pnl).toBeCloseTo(6, 8);
  });
});

describe("computeExitAnalytics", () => {
  it("normalizes trailing-activated stop losses into TRAILING_STOP", () => {
    const trades = [
      trade({ id: 1, exitReason: "TAKE_PROFIT", realizedPnl: 20 }),
      trade({ id: 2, exitReason: "STOP_LOSS", trailingActivated: true, realizedPnl: 15 }),
      trade({ id: 3, exitReason: "STOP_LOSS", trailingActivated: false, realizedPnl: -10 }),
    ];
    const analytics = computeExitAnalytics(trades);
    const tp = analytics.reasons.find((r) => r.reason === "TAKE_PROFIT")!;
    expect(tp.count).toBe(1);
    const trailing = analytics.reasons.find((r) => r.reason === "TRAILING_STOP")!;
    expect(trailing.count).toBe(1);
    const sl = analytics.reasons.find((r) => r.reason === "STOP_LOSS")!;
    expect(sl.count).toBe(1);

    expect(analytics.tpSl.tpHits).toBe(1);
    expect(analytics.tpSl.trailingHits).toBe(1);
    expect(analytics.tpSl.slHits).toBe(1);
    expect(analytics.tpSl.trailing.trailingMovements).toBe(1);
    expect(analytics.tpSl.trailing.trailingClosedTrades).toBe(1);
    expect(analytics.tpSl.trailing.averageMfePct).toBeCloseTo(11, 2);
  });
});

describe("unrealizedOfPosition", () => {
  it("uses the stored unrealized PnL when present", () => {
    const position = { unrealizedPnl: 42 } as OpenPositionRow;
    expect(unrealizedOfPosition(position)).toBe(42);
  });

  it("falls back to a price-based estimate for longs and shorts", () => {
    const longPosition = {
      unrealizedPnl: null,
      entryPrice: 100,
      currentPrice: 110,
      filledQuantity: 2,
      quantity: 2,
      side: "BUY",
    } as unknown as OpenPositionRow;
    expect(unrealizedOfPosition(longPosition)).toBeCloseTo(20, 8);

    const shortPosition = {
      unrealizedPnl: null,
      entryPrice: 100,
      currentPrice: 95,
      filledQuantity: 2,
      quantity: 2,
      side: "SELL",
    } as unknown as OpenPositionRow;
    expect(unrealizedOfPosition(shortPosition)).toBeCloseTo(10, 8);
  });
});
