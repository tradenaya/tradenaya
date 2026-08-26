import type { BacktestEquityPoint, BacktestMetrics, BacktestTrade } from "./types";

export interface MetricsInput {
  initialCapital: number;
  finalBalance: number;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  /** Average fraction of equity committed as margin over the run (%). */
  exposurePct: number;
  /** Interval length in ms between equity points (for annualization). */
  intervalMs: number;
}

const PERIODS_PER_YEAR_MINUTES = 525_600;

/**
 * Computes the full backtest statistics set from the simulated trades and
 * equity curve. Metrics that are mathematically invalid for the available data
 * (e.g. Sharpe/Sortino with fewer than two returns or zero variance) are
 * returned as null rather than fabricated.
 */
export class BacktestMetricsCalculator {
  compute(input: MetricsInput): BacktestMetrics {
    const trades = input.trades;
    const winning = trades.filter((t) => t.netPnl > 0);
    const losing = trades.filter((t) => t.netPnl < 0);

    const grossProfit = winning.reduce((sum, t) => sum + t.netPnl, 0);
    const grossLoss = losing.reduce((sum, t) => sum + t.netPnl, 0);
    const totalPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);
    const totalFees = trades.reduce((sum, t) => sum + t.totalFee, 0);
    const decisionCount = winning.length + losing.length;

    const profitFactor =
      Math.abs(grossLoss) > 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;

    const maxDrawdown = this.maxDrawdown(input.equityCurve);
    const { sharpeRatio, sortinoRatio } = this.riskAdjustedRatios(input);

    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let streak = 0;
    let lastWin: boolean | null = null;
    for (const trade of trades) {
      const win = trade.netPnl > 0;
      if (win === lastWin) streak += 1;
      else streak = 1;
      lastWin = win;
      if (win) maxConsecutiveWins = Math.max(maxConsecutiveWins, streak);
      else maxConsecutiveLosses = Math.max(maxConsecutiveLosses, streak);
    }

    return {
      initialCapital: input.initialCapital,
      finalBalance: input.finalBalance,
      totalReturnPct: input.initialCapital > 0 ? (totalPnl / input.initialCapital) * 100 : 0,
      totalPnl,
      grossProfit,
      grossLoss,
      totalFees,
      tradeCount: trades.length,
      winningTrades: winning.length,
      losingTrades: losing.length,
      winRate: decisionCount > 0 ? (winning.length / decisionCount) * 100 : 0,
      avgWinningTrade: winning.length > 0 ? grossProfit / winning.length : 0,
      avgLosingTrade: losing.length > 0 ? grossLoss / losing.length : 0,
      largestWinningTrade: winning.length > 0 ? Math.max(...winning.map((t) => t.netPnl)) : 0,
      largestLosingTrade: losing.length > 0 ? Math.min(...losing.map((t) => t.netPnl)) : 0,
      profitFactor,
      maxDrawdown: maxDrawdown.value,
      maxDrawdownPct: maxDrawdown.pct,
      avgTradeDurationMs: trades.length > 0 ? trades.reduce((sum, t) => sum + t.durationMs, 0) / trades.length : 0,
      longTrades: trades.filter((t) => t.side === "LONG").length,
      shortTrades: trades.filter((t) => t.side === "SHORT").length,
      sharpeRatio,
      sortinoRatio,
      expectancy: trades.length > 0 ? totalPnl / trades.length : 0,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      avgRiskReward: trades.length > 0 ? trades.reduce((sum, t) => sum + t.plannedRiskReward, 0) / trades.length : 0,
      exposurePct: input.exposurePct,
    };
  }

  private maxDrawdown(curve: BacktestEquityPoint[]): { value: number; pct: number } {
    if (curve.length === 0) return { value: 0, pct: 0 };
    let peak = curve[0].equity;
    let maxValue = 0;
    let maxPct = 0;
    for (const point of curve) {
      if (point.equity > peak) peak = point.equity;
      const dd = peak - point.equity;
      const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
      if (dd > maxValue) maxValue = dd;
      if (ddPct > maxPct) maxPct = ddPct;
    }
    return { value: maxValue, pct: maxPct };
  }

  private riskAdjustedRatios(input: MetricsInput): { sharpeRatio: number | null; sortinoRatio: number | null } {
    const returns: number[] = [];
    for (let i = 1; i < input.equityCurve.length; i += 1) {
      const previous = input.equityCurve[i - 1].equity;
      if (!(previous > 0)) continue;
      returns.push((input.equityCurve[i].equity - previous) / previous);
    }
    if (returns.length < 2) return { sharpeRatio: null, sortinoRatio: null };

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    if (!(std > 0)) return { sharpeRatio: null, sortinoRatio: null };

    const periodMinutes = input.intervalMs > 0 ? input.intervalMs / 60_000 : 5;
    const periodsPerYear = PERIODS_PER_YEAR_MINUTES / periodMinutes;
    const annualizer = Math.sqrt(Math.max(periodsPerYear, 1));

    const downside = returns.filter((r) => r < 0);
    const downsideDeviation =
      downside.length > 0 ? Math.sqrt(downside.reduce((sum, r) => sum + r * r, 0) / Math.max(downside.length - 1, 1)) : 0;

    return {
      sharpeRatio: (mean / std) * annualizer,
      sortinoRatio: downsideDeviation > 0 ? (mean / downsideDeviation) * annualizer : null,
    };
  }
}
