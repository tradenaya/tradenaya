import { Money } from "@/automation/backtest/decimal";
import type {
  BotRow,
  ClosedTradeRow,
  EquityPoint,
  ExitAnalytics,
  ExitReasonCategory,
  OpenPositionRow,
  OutcomeAnalytics,
  PnlPoint,
  StrategyPerformance,
  SymbolPerformance,
  TradeOutcome,
  TradeStatistics,
} from "./types";
import { ALL_TRADE_OUTCOMES, classifyOutcome, normalizeExitReason } from "./types";

export type Granularity = "daily" | "weekly" | "monthly";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** Thursday 2000-01-06: a stable anchor so week boundaries don't drift with the Epoch. */
const WEEK_ANCHOR = Date.UTC(2000, 0, 6);

function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

export function bucketKey(ms: number, granularity: Granularity): number {
  if (granularity === "daily") return Math.floor(ms / DAY_MS);
  if (granularity === "weekly") return Math.floor((ms - WEEK_ANCHOR) / WEEK_MS);
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function bucketStartMs(key: number, granularity: Granularity): number {
  if (granularity === "daily") return key * DAY_MS;
  if (granularity === "weekly") return WEEK_ANCHOR + key * WEEK_MS;
  const year = Math.floor(key / 12);
  const month = key % 12;
  return Date.UTC(year, month, 1);
}

/**
 * Net PnL of a closed trade. Newer rows carry the true cost breakdown
 * (grossProfit, commission, fundingFee); older rows store a price-only estimate
 * in realizedPnl. When any accounting figure is present we let the breakdown
 * define the net; otherwise we fall back to the legacy realizedPnl.
 */
export function netPnl(
  trade: Pick<ClosedTradeRow, "realizedPnl" | "grossProfit" | "commission" | "fundingFee">,
): number {
  if (trade.grossProfit !== 0 || trade.commission !== 0 || trade.fundingFee !== 0) {
    return trade.grossProfit - trade.commission - trade.fundingFee;
  }
  return trade.realizedPnl;
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Money-backed accumulator that returns 8-dp fixed point numbers. */
class MoneySum {
  private value = Money.zero();
  add(amount: number): this {
    this.value = this.value.add(Money.fromNumber(amount));
    return this;
  }
  get(): number {
    return this.value.toNumber();
  }
}

export function sumFees(trades: Pick<ClosedTradeRow, "fees">[]): number {
  const sum = new MoneySum();
  for (const t of trades) sum.add(t.fees);
  return sum.get();
}

/** Unrealized PnL of an open position, falling back to a price-based estimate. */
export function unrealizedOfPosition(position: OpenPositionRow): number {
  if (position.unrealizedPnl != null) return position.unrealizedPnl;
  const quantity = position.filledQuantity ?? position.quantity;
  if (position.entryPrice == null || position.currentPrice == null || quantity == null) return 0;
  if (position.side === "BUY") return (position.currentPrice - position.entryPrice) * quantity;
  return (position.entryPrice - position.currentPrice) * quantity;
}

// ---------------------------------------------------------------------------
// Trade statistics
// ---------------------------------------------------------------------------

export function computeTradeStatistics(trades: ClosedTradeRow[]): TradeStatistics {
  const grossProfit = new MoneySum();
  const grossLoss = new MoneySum();
  const totalPnl = new MoneySum();
  let longTrades = 0;
  let shortTrades = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;
  let cancelledTrades = 0;
  let largestWin = -Infinity;
  let largestLoss = Infinity;
  let durationSumMs = 0;
  let durationCount = 0;
  let consecutiveWins = 0;
  let maxConsecutiveWins = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;

  const sorted = [...trades].sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1));
  for (const trade of sorted) {
    const pnl = netPnl(trade);
    totalPnl.add(pnl);
    if (trade.side === "BUY") longTrades += 1;
    else shortTrades += 1;

    const outcome = classifyOutcome(trade.exitReason, pnl);
    if (outcome === "WIN") {
      winningTrades += 1;
      grossProfit.add(pnl);
      largestWin = Math.max(largestWin, pnl);
      consecutiveWins += 1;
      consecutiveLosses = 0;
    } else if (outcome === "LOSS") {
      losingTrades += 1;
      grossLoss.add(Math.abs(pnl));
      largestLoss = Math.min(largestLoss, pnl);
      consecutiveLosses += 1;
      consecutiveWins = 0;
    } else if (outcome === "BREAKEVEN") {
      breakevenTrades += 1;
    } else {
      cancelledTrades += 1;
    }
    maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins);
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);

    if (trade.durationMs != null) {
      durationSumMs += trade.durationMs;
      durationCount += 1;
    }
  }

  const total = sorted.length;
  const resolvedTrades = winningTrades + losingTrades;
  const grossProfitValue = grossProfit.get();
  const grossLossValue = grossLoss.get();
  const grossLossAbs = Math.abs(grossLossValue);

  return {
    totalTrades: total,
    longTrades,
    shortTrades,
    winningTrades,
    losingTrades,
    breakevenTrades,
    cancelledTrades,
    winRate: resolvedTrades ? round((winningTrades / resolvedTrades) * 100, 1) : 0,
    averageProfit: winningTrades ? grossProfitValue / winningTrades : 0,
    averageLoss: losingTrades ? -grossLossAbs / losingTrades : 0,
    largestWin: largestWin === -Infinity ? 0 : largestWin,
    largestLoss: largestLoss === Infinity ? 0 : largestLoss,
    averageTradePnl: total ? totalPnl.get() / total : 0,
    averageTradeDurationMs: durationCount ? durationSumMs / durationCount : 0,
    profitFactor: grossLossAbs > 0 ? grossProfitValue / grossLossAbs : grossProfitValue > 0 ? null : 0,
    expectancy: total ? totalPnl.get() / total : 0,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    grossProfit: grossProfitValue,
    grossLoss: grossLossValue,
    totalFees: sumFees(trades),
  };
}

// ---------------------------------------------------------------------------
// Outcome breakdown (win / loss / breakeven / cancelled)
// ---------------------------------------------------------------------------

export function computeOutcomeAnalytics(trades: ClosedTradeRow[]): OutcomeAnalytics {
  const pnlByStatus = new Map<TradeOutcome, MoneySum>();
  const countByStatus = new Map<TradeOutcome, number>();
  for (const status of ALL_TRADE_OUTCOMES) {
    pnlByStatus.set(status, new MoneySum());
    countByStatus.set(status, 0);
  }

  for (const trade of trades) {
    const outcome = classifyOutcome(trade.exitReason, netPnl(trade));
    countByStatus.set(outcome, (countByStatus.get(outcome) ?? 0) + 1);
    pnlByStatus.get(outcome)!.add(netPnl(trade));
  }

  const total = trades.length;
  const wins = countByStatus.get("WIN") ?? 0;
  const losses = countByStatus.get("LOSS") ?? 0;
  const resolvedTrades = wins + losses;

  const statuses = ALL_TRADE_OUTCOMES.map((status) => ({
    status,
    count: countByStatus.get(status) ?? 0,
    pnl: pnlByStatus.get(status)!.get(),
    rate: total ? round(((countByStatus.get(status) ?? 0) / total) * 100, 1) : 0,
  }));

  return {
    total,
    resolvedTrades,
    winRate: resolvedTrades ? round((wins / resolvedTrades) * 100, 1) : 0,
    statuses,
  };
}

// ---------------------------------------------------------------------------
// Equity curve + drawdown
// ---------------------------------------------------------------------------

export interface EquityResult {
  points: EquityPoint[];
  startingEquity: number;
  currentEquity: number;
  peakEquity: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
}

export function buildEquityCurve(input: {
  trades: ClosedTradeRow[];
  startingEquity: number;
  startTime?: number | null;
  endTime?: number | null;
}): EquityResult {
  const { trades, startingEquity, startTime, endTime } = input;
  const ordered = [...trades].sort((a, b) => (a.closedAt < b.closedAt ? -1 : 1));

  let minDay = startTime != null ? startOfDay(startTime) : Infinity;
  let maxDay = endTime != null ? startOfDay(endTime) : -Infinity;
  if (ordered.length) {
    minDay = Math.min(minDay, startOfDay(new Date(ordered[0].closedAt).getTime()));
    maxDay = Math.max(maxDay, startOfDay(new Date(ordered[ordered.length - 1].closedAt).getTime()));
  }
  if (!Number.isFinite(minDay) || !Number.isFinite(maxDay) || maxDay < minDay) {
    const now = startOfDay(Date.now());
    return {
      points: [{ timestamp: now, equity: startingEquity, drawdownPct: 0 }],
      startingEquity,
      currentEquity: startingEquity,
      peakEquity: startingEquity,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
    };
  }

  // Group realized PnL by day.
  const realizedByDay = new Map<number, number>();
  for (const trade of ordered) {
    const day = startOfDay(new Date(trade.closedAt).getTime());
    const value = realizedByDay.get(day) ?? 0;
    realizedByDay.set(day, value + netPnl(trade));
  }

  const points: EquityPoint[] = [];
  let equity = Money.fromNumber(startingEquity);
  let peak = equity;
  let maxDrawdownValue = Money.zero();
  let maxDrawdownPct = 0;

  const appendPoint = (timestamp: number) => {
    const equityValue = equity.toNumber();
    const peakValue = peak.toNumber();
    const dd = peakValue > 0 ? ((peakValue - equityValue) / peakValue) * 100 : 0;
    points.push({ timestamp, equity: equityValue, drawdownPct: round(dd, 2) });
  };

  appendPoint(minDay);
  for (let day = minDay; day <= maxDay; day += DAY_MS) {
    const dayRealized = realizedByDay.get(day);
    if (dayRealized !== undefined) {
      equity = equity.add(Money.fromNumber(dayRealized));
      if (equity.gt(peak)) peak = equity;
      const ddValue = peak.sub(equity);
      if (ddValue.isPositive() && ddValue.gt(maxDrawdownValue)) maxDrawdownValue = ddValue;
      const peakValue = peak.toNumber();
      if (peakValue > 0) {
        const ddPct = (ddValue.toNumber() / peakValue) * 100;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
      }
    }
    appendPoint(day + DAY_MS - 1);
  }

  const finalEquity = equity.toNumber();
  return {
    points,
    startingEquity,
    currentEquity: finalEquity,
    peakEquity: peak.toNumber(),
    maxDrawdown: maxDrawdownValue.toNumber(),
    maxDrawdownPct: round(maxDrawdownPct, 2),
  };
}

// ---------------------------------------------------------------------------
// PnL series
// ---------------------------------------------------------------------------

export interface PnlSeriesInput {
  trades: ClosedTradeRow[];
  unrealized: number;
  granularity: Granularity;
  startTime?: number | null;
  endTime?: number | null;
  now?: number;
}

export interface PnlSeriesResult {
  granularity: Granularity;
  realizedTotal: number;
  unrealizedTotal: number;
  cumulativeTotal: number;
  points: PnlPoint[];
}

export function buildPnlSeries(input: PnlSeriesInput): PnlSeriesResult {
  const { trades, unrealized, granularity, startTime, endTime, now } = input;
  const currentNow = now ?? Date.now();

  const realizedByBucket = new Map<number, number>();
  let minKey = startTime != null ? bucketKey(startTime, granularity) : Infinity;
  let maxKey = endTime != null ? bucketKey(endTime, granularity) : -Infinity;
  const realizedTotal = new MoneySum();

  for (const trade of trades) {
    const key = bucketKey(new Date(trade.closedAt).getTime(), granularity);
    const pnl = netPnl(trade);
    realizedByBucket.set(key, (realizedByBucket.get(key) ?? 0) + pnl);
    realizedTotal.add(pnl);
    minKey = Math.min(minKey, key);
    maxKey = Math.max(maxKey, key);
  }

  if (!Number.isFinite(minKey) || !Number.isFinite(maxKey) || maxKey < minKey) {
    const key = bucketKey(currentNow, granularity);
    return {
      granularity,
      realizedTotal: 0,
      unrealizedTotal: unrealized,
      cumulativeTotal: unrealized,
      points: [
        {
          timestamp: bucketStartMs(key, granularity),
          realized: 0,
          unrealized,
          total: unrealized,
          cumulative: unrealized,
        },
      ],
    };
  }

  // Include the current period even if it has no trades yet.
  const nowKey = bucketKey(currentNow, granularity);
  minKey = Math.min(minKey, nowKey);
  maxKey = Math.max(maxKey, nowKey);

  const points: PnlPoint[] = [];
  let cumulative = Money.zero();
  const realizedValue = realizedTotal.get();
  for (let key = minKey; key <= maxKey; key += 1) {
    const realized = realizedByBucket.get(key) ?? 0;
    cumulative = cumulative.add(Money.fromNumber(realized));
    const isLast = key === maxKey;
    const unrealizedBucket = isLast ? unrealized : 0;
    points.push({
      timestamp: bucketStartMs(key, granularity),
      realized,
      unrealized: unrealizedBucket,
      total: realized + unrealizedBucket,
      cumulative: cumulative.toNumber(),
    });
  }

  return {
    granularity,
    realizedTotal: realizedValue,
    unrealizedTotal: unrealized,
    cumulativeTotal: cumulative.toNumber() + unrealized,
    points,
  };
}

// ---------------------------------------------------------------------------
// Per-symbol / per-strategy aggregation
// ---------------------------------------------------------------------------

export function aggregateBySymbol(trades: ClosedTradeRow[]): SymbolPerformance[] {
  const grouped = new Map<
    string,
    { pnl: MoneySum; fees: MoneySum; total: number; long: number; short: number; wins: number; losses: number }
  >();

  for (const trade of trades) {
    let entry = grouped.get(trade.symbol);
    if (!entry) {
      entry = { pnl: new MoneySum(), fees: new MoneySum(), total: 0, long: 0, short: 0, wins: 0, losses: 0 };
      grouped.set(trade.symbol, entry);
    }
    const pnl = netPnl(trade);
    entry.pnl.add(pnl);
    entry.fees.add(trade.fees);
    entry.total += 1;
    if (trade.side === "BUY") entry.long += 1;
    else entry.short += 1;
    const outcome = classifyOutcome(trade.exitReason, pnl);
    if (outcome === "WIN") entry.wins += 1;
    else if (outcome === "LOSS") entry.losses += 1;
  }

  return [...grouped.entries()]
    .map(([symbol, e]) => {
      const resolved = e.wins + e.losses;
      return {
        symbol,
        trades: e.total,
        longTrades: e.long,
        shortTrades: e.short,
        pnl: e.pnl.get(),
        winRate: resolved ? round((e.wins / resolved) * 100, 1) : 0,
        averagePnl: e.total ? e.pnl.get() / e.total : 0,
        fees: e.fees.get(),
      };
    })
    .sort((a, b) => b.pnl - a.pnl);
}

export function aggregateByStrategy(
  trades: ClosedTradeRow[],
  bots: Map<number, BotRow>,
): StrategyPerformance[] {
  const grouped = new Map<
    string,
    { pnl: MoneySum; fees: MoneySum; trades: ClosedTradeRow[]; bots: Set<number> }
  >();

  for (const trade of trades) {
    const strategy = bots.get(trade.botId)?.strategy ?? "Unknown";
    let entry = grouped.get(strategy);
    if (!entry) {
      entry = { pnl: new MoneySum(), fees: new MoneySum(), trades: [], bots: new Set() };
      grouped.set(strategy, entry);
    }
    entry.pnl.add(netPnl(trade));
    entry.fees.add(trade.fees);
    entry.trades.push(trade);
    entry.bots.add(trade.botId);
  }

  return [...grouped.entries()].map(([strategy, e]) => {
    const stats = computeTradeStatistics(e.trades);
    const equity = buildEquityCurve({ trades: e.trades, startingEquity: 0 });
    return {
      strategy,
      bots: e.bots.size,
      trades: e.trades.length,
      pnl: e.pnl.get(),
      winRate: stats.winRate,
      maxDrawdownPct: equity.maxDrawdownPct,
      profitFactor: stats.profitFactor,
      averageTrade: e.trades.length ? e.pnl.get() / e.trades.length : 0,
      fees: e.fees.get(),
    };
  }).sort((a, b) => b.pnl - a.pnl);
}

// ---------------------------------------------------------------------------
// Exit analytics
// ---------------------------------------------------------------------------

function mfePct(trade: ClosedTradeRow): number | null {
  if (trade.entryPrice <= 0 || trade.highestPrice == null || trade.lowestPrice == null) return null;
  if (trade.side === "BUY") {
    return ((trade.highestPrice - trade.entryPrice) / trade.entryPrice) * 100;
  }
  return ((trade.entryPrice - trade.lowestPrice) / trade.entryPrice) * 100;
}

export function computeExitAnalytics(trades: ClosedTradeRow[]): ExitAnalytics {
  const byReason = new Map<ExitReasonCategory, { count: number; pnl: MoneySum; wins: number; losses: number }>();
  const tpHits: number[] = [];
  const slHits: number[] = [];
  const trailingHits: number[] = [];
  let trailingMovements = 0;
  let trailingMfeSum = 0;
  let trailingMfeCount = 0;
  let trailingPnl = Money.zero();

  for (const trade of trades) {
    const category = normalizeExitReason(trade.exitReason, trade.trailingActivated);
    let entry = byReason.get(category);
    if (!entry) {
      entry = { count: 0, pnl: new MoneySum(), wins: 0, losses: 0 };
      byReason.set(category, entry);
    }
    const pnl = netPnl(trade);
    entry.count += 1;
    entry.pnl.add(pnl);
    const outcome = classifyOutcome(trade.exitReason, pnl);
    if (outcome === "WIN") entry.wins += 1;
    else if (outcome === "LOSS") entry.losses += 1;

    if (category === "TAKE_PROFIT") tpHits.push(pnl);
    else if (category === "STOP_LOSS") slHits.push(pnl);
    else if (category === "TRAILING_STOP") {
      trailingHits.push(pnl);
      trailingPnl = trailingPnl.add(Money.fromNumber(pnl));
    }

    if (trade.trailingActivated) {
      trailingMovements += 1;
      const mfe = mfePct(trade);
      if (mfe != null) {
        trailingMfeSum += mfe;
        trailingMfeCount += 1;
      }
    }
  }

  const reasons = [...byReason.entries()].map(([reason, e]) => {
    const resolved = e.wins + e.losses;
    return {
      reason,
      count: e.count,
      pnl: e.pnl.get(),
      winRate: resolved ? round((e.wins / resolved) * 100, 1) : 0,
      averagePnl: e.count ? e.pnl.get() / e.count : 0,
    };
  });

  const sum = (values: number[]) => {
    const s = new MoneySum();
    for (const v of values) s.add(v);
    return s.get();
  };
  const avg = (values: number[]) => (values.length ? sum(values) / values.length : 0);

  const tpCount = tpHits.length;
  const slCount = slHits.length;
  const trCount = trailingHits.length;
  const closedCount = tpCount + slCount + trCount;

  return {
    reasons,
    tpSl: {
      tpHits: tpCount,
      slHits: slCount,
      trailingHits: trCount,
      tpPct: closedCount ? round((tpCount / closedCount) * 100, 1) : 0,
      slPct: closedCount ? round((slCount / closedCount) * 100, 1) : 0,
      trailingPct: closedCount ? round((trCount / closedCount) * 100, 1) : 0,
      averageTpPnl: avg(tpHits),
      averageSlPnl: avg(slHits),
      averageTrailingPnl: avg(trailingHits),
      trailing: {
        trailingMovements,
        trailingClosedTrades: trCount,
        averageMfePct: round(trailingMfeCount ? trailingMfeSum / trailingMfeCount : 0, 2),
        averagePnl: avg(trailingHits),
        profitProtected: trailingPnl.toNumber(),
      },
    },
  };
}
