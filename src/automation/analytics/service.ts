import type { BotRow, ClosedTradeRow, OpenPositionRow } from "./types";
import { IAnalyticsRepository } from "./repository";
import {
  aggregateByStrategy,
  aggregateBySymbol,
  buildEquityCurve,
  buildPnlSeries,
  computeExitAnalytics,
  computeOutcomeAnalytics,
  computeTradeStatistics,
  netPnl,
  sumFees,
  unrealizedOfPosition,
  type Granularity,
} from "./calculators";
import type {
  AccountSummary,
  ActiveOrderAnalytics,
  ActivityFeed,
  AnalyticsFilters,
  BacktestDetail,
  BacktestSummary,
  BotSummary,
  ClosedTradeSummary,
  EquityAnalytics,
  ExitAnalytics,
  OpenPositionAnalytics,
  OutcomeAnalytics,
  Paged,
  PnlAnalytics,
  StrategyPerformance,
  SymbolPerformance,
  TradeDetail,
  TradeStatistics,
} from "./types";
import { classifyOutcome } from "./types";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** Simple TTL cache used for expensive all-time aggregations. */
class TtlCache<V> {
  private store = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

function filtersCacheKey(filters: AnalyticsFilters): string {
  return JSON.stringify({
    botId: filters.botId ?? null,
    symbol: filters.symbol ?? null,
    strategy: filters.strategy ?? null,
    side: filters.side ?? null,
    exitReason: filters.exitReason ?? null,
    startTime: filters.startTime != null ? Math.floor(filters.startTime / 60_000) : null,
    endTime: filters.endTime != null ? Math.floor(filters.endTime / 60_000) : null,
  });
}

function defaultFilters(filters?: AnalyticsFilters): AnalyticsFilters {
  return {
    botId: filters?.botId ?? null,
    symbol: filters?.symbol ?? null,
    strategy: filters?.strategy ?? null,
    side: filters?.side ?? null,
    exitReason: filters?.exitReason ?? null,
    startTime: filters?.startTime ?? null,
    endTime: filters?.endTime ?? null,
  };
}

function botName(bot: Pick<BotRow, "id" | "symbol" | "strategy">): string {
  return `${bot.symbol} · ${bot.strategy}`;
}

function formatTrade(trade: ClosedTradeRow, bots: Map<number, BotRow>): ClosedTradeSummary {
  const bot = bots.get(trade.botId);
  const net = netPnl(trade);
  return {
    id: trade.id,
    tradeId: `T-${trade.id}`,
    botId: trade.botId,
    botName: bot ? botName(bot) : `Bot #${trade.botId}`,
    symbol: trade.symbol,
    side: trade.side,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    quantity: trade.positionSize,
    realizedPnl: trade.realizedPnl,
    fees: trade.fees,
    netPnl: net,
    grossProfit: trade.grossProfit,
    commission: trade.commission,
    fundingFee: trade.fundingFee,
    entryTime: trade.entryTime ?? trade.closedAt,
    exitTime: trade.closedAt,
    durationMs: trade.durationMs ?? 0,
    exitReason: trade.exitReason,
    leverage: trade.leverage,
    strategy: bot?.strategy ?? "Unknown",
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    trailingActivated: trade.trailingActivated,
    highestPrice: trade.highestPrice,
    lowestPrice: trade.lowestPrice,
  };
}

function formatPosition(position: OpenPositionRow, bots: Map<number, BotRow>): OpenPositionAnalytics {
  const bot = bots.get(position.botId);
  const qty = position.filledQuantity ?? position.quantity;
  const margin =
    position.entryPrice != null && qty != null && position.leverage && position.leverage > 0
      ? (position.entryPrice * qty) / position.leverage
      : null;

  let protectionStatus: OpenPositionAnalytics["protectionStatus"];
  if (position.state === "TRAILING") protectionStatus = "TRAILING";
  else if (position.state === "PROTECTED") protectionStatus = "PROTECTED";
  else if (["UNPROTECTED", "ENTRY_EXECUTED", "ERROR"].includes(position.state)) protectionStatus = "UNPROTECTED";
  else protectionStatus = "PENDING";

  return {
    positionId: position.id,
    botId: position.botId,
    botName: bot ? botName(bot) : `Bot #${position.botId}`,
    symbol: position.symbol,
    side: position.side,
    state: position.state,
    quantity: qty,
    filledQuantity: position.filledQuantity,
    entryPrice: position.entryPrice,
    plannedEntryPrice: position.plannedEntryPrice,
    currentPrice: position.currentPrice,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    leverage: position.leverage,
    margin,
    unrealizedPnl: unrealizedOfPosition(position),
    trailingEnabled: position.trailingEnabled,
    trailingActivated: position.trailingActivated,
    trailingDistancePct: position.trailingDistancePct,
    protectionStatus,
    highestPrice: position.highestPrice,
    lowestPrice: position.lowestPrice,
    openTime: position.createdAt,
    durationMs: position.createdAt ? Date.now() - new Date(position.createdAt).getTime() : 0,
  };
}

export interface AnalyticsServiceOptions {
  /** Starting capital baseline used for the equity curve (defaults to the sum of all bot capitals). */
  baselineCapital?: number;
  /** Cache TTL for expensive aggregations in ms (default 60_000). */
  cacheTtlMs?: number;
}

export class BotAnalyticsService {
  private cache: TtlCache<unknown>;

  constructor(
    private readonly repo: IAnalyticsRepository,
    private readonly options: AnalyticsServiceOptions = {},
  ) {
    this.cache = new TtlCache(options.cacheTtlMs ?? 60_000);
  }

  private async botsMap(userId: number): Promise<Map<number, BotRow>> {
    const bots = await this.repo.getBots(userId);
    return new Map(bots.map((b) => [b.id, b]));
  }

  async getAccountSummary(userId: number, filters?: AnalyticsFilters): Promise<AccountSummary> {
    const key = `summary:${userId}:${filtersCacheKey(defaultFilters(filters))}`;
    const cached = this.cache.get(key) as AccountSummary | undefined;
    if (cached) return cached;

    const f = defaultFilters(filters);
    const [trades, positions, bots, counts] = await Promise.all([
      this.repo.getClosedTrades(userId, f),
      this.repo.getOpenPositions(userId, f.botId ?? undefined),
      this.repo.getBots(userId),
      this.repo.countBots(userId),
    ]);

    const now = Date.now();
    const todayStart = startOfDay(now);
    const weekStart = startOfDay(now - 6 * DAY_MS);
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).getTime();

    let realized = 0;
    let fees = 0;
    let todayPnl = 0;
    let weeklyPnl = 0;
    let monthlyPnl = 0;
    let winningTrades = 0;
    for (const trade of trades) {
      const net = netPnl(trade);
      realized += net;
      fees += trade.fees;
      if (net > 0) winningTrades += 1;
      const closed = new Date(trade.closedAt).getTime();
      if (closed >= todayStart) todayPnl += net;
      if (closed >= weekStart) weeklyPnl += net;
      if (closed >= monthStart) monthlyPnl += net;
    }

    const unrealized = positions.reduce((sum, p) => sum + unrealizedOfPosition(p), 0);
    const baseline = this.options.baselineCapital ?? bots.reduce((sum, b) => sum + b.capital, 0);
    const equity = buildEquityCurve({ trades, startingEquity: baseline });
    const stats = computeTradeStatistics(trades);
    const totalPnl = realized + unrealized;

    const result: AccountSummary = {
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      totalPnl,
      todayPnl,
      weeklyPnl,
      monthlyPnl,
      totalFees: fees,
      totalTrades: trades.length,
      winningTrades: stats.winningTrades,
      losingTrades: stats.losingTrades,
      cancelledTrades: stats.cancelledTrades,
      winRate: stats.winRate,
      profitFactor: stats.profitFactor,
      maxDrawdown: equity.maxDrawdown,
      maxDrawdownPct: equity.maxDrawdownPct,
      openPositions: positions.length,
      activeBots: counts.active,
      totalBots: counts.total,
    };

    this.cache.set(key, result);
    return result;
  }

  async getBotSummaries(userId: number, filters?: AnalyticsFilters): Promise<BotSummary[]> {
    const f = defaultFilters(filters);
    const [bots, positions, trades, activityFeed] = await Promise.all([
      this.repo.getBots(userId),
      this.repo.getOpenPositions(userId),
      this.repo.getClosedTrades(userId, f),
      this.repo.getActivity(userId, { limit: 500 }),
    ]);

    const latestActivity = new Map<number, BotSummary["lastActivity"]>();
    for (const item of activityFeed.items) {
      if (item.botId == null || latestActivity.has(item.botId)) continue;
      latestActivity.set(item.botId, {
        id: item.id,
        type: item.type,
        botId: item.botId,
        botName: null,
        symbol: item.symbol,
        message: item.message,
        severity: item.type.toUpperCase().includes("ERROR") ? "ERROR" : item.type.toUpperCase().includes("WARN") ? "WARNING" : "INFO",
        timestamp: item.createdAt,
      });
    }

    const now = Date.now();
    const todayStart = startOfDay(now);
    const positionsByBot = new Map<number, typeof positions>();
    for (const p of positions) {
      const list = positionsByBot.get(p.botId) ?? [];
      list.push(p);
      positionsByBot.set(p.botId, list);
    }

    return bots.map((bot) => {
      const botTrades = trades.filter((t) => t.botId === bot.id);
      const openPositions = positionsByBot.get(bot.id) ?? [];
      const currentPosition = openPositions.length ? formatPosition(openPositions[0], new Map([[bot.id, bot]])) : null;

      let totalPnl = 0;
      let todayPnl = 0;
      let wins = 0;
      let losses = 0;
      let cancelled = 0;
      let lastTrade: ClosedTradeSummary | null = null;
      for (const trade of botTrades) {
        const net = netPnl(trade);
        totalPnl += net;
        if (new Date(trade.closedAt).getTime() >= todayStart) todayPnl += net;
        const outcome = classifyOutcome(trade.exitReason, net);
        if (outcome === "WIN") wins += 1;
        else if (outcome === "LOSS") losses += 1;
        else if (outcome === "CANCELLED") cancelled += 1;
        if (!lastTrade || trade.closedAt > lastTrade.exitTime) {
          lastTrade = formatTrade(trade, new Map([[bot.id, bot]]));
        }
      }

      return {
        id: bot.id,
        name: botName(bot),
        symbol: bot.symbol,
        strategy: bot.strategy,
        status: bot.status,
        enabled: bot.desiredStatus === "RUNNING",
        desiredStatus: bot.desiredStatus,
        leverage: bot.leverage,
        capital: bot.capital,
        capitalMode: bot.capitalMode,
        currentPosition,
        currentPnl: currentPosition?.unrealizedPnl ?? 0,
        todayPnl,
        totalPnl,
        tradeCount: botTrades.length,
        winningTrades: wins,
        losingTrades: losses,
        cancelledTrades: cancelled,
        winRate: wins + losses ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
        lastTrade,
        lastAnalysisAt: bot.lastAnalysisAt,
        lastExecutionAt: bot.lastExecutionAt,
        lastError: bot.lastError,
        lastActivity: latestActivity.get(bot.id) ?? null,
        recoveryState: bot.status === "RECOVERING" ? "RECOVERING" : null,
        retryCount: bot.retryCount ?? 0,
        createdAt: bot.createdAt ?? "",
        updatedAt: bot.updatedAt ?? "",
      };
    });
  }

  async getEquity(userId: number, filters?: AnalyticsFilters): Promise<EquityAnalytics> {
    const f = defaultFilters(filters);
    const key = `equity:${userId}:${filtersCacheKey(f)}`;
    const cached = this.cache.get(key) as EquityAnalytics | undefined;
    if (cached) return cached;

    const [trades, bots, positions] = await Promise.all([
      this.repo.getClosedTrades(userId, f),
      this.repo.getBots(userId),
      this.repo.getOpenPositions(userId, f.botId ?? undefined),
    ]);
    const baseline = this.options.baselineCapital ?? bots.reduce((sum, b) => sum + b.capital, 0);
    const unrealized = positions.reduce((sum, p) => sum + unrealizedOfPosition(p), 0);
    const equity = buildEquityCurve({
      trades,
      startingEquity: baseline,
      startTime: f.startTime,
      endTime: f.endTime,
    });

    const result: EquityAnalytics = {
      startingEquity: equity.startingEquity,
      currentEquity: equity.currentEquity + unrealized,
      peakEquity: equity.peakEquity,
      currentDrawdownPct: equity.maxDrawdownPct,
      maxDrawdown: equity.maxDrawdown,
      maxDrawdownPct: equity.maxDrawdownPct,
      points: equity.points,
    };
    this.cache.set(key, result);
    return result;
  }

  async getPnl(userId: number, granularity: Granularity, filters?: AnalyticsFilters): Promise<PnlAnalytics> {
    const f = defaultFilters(filters);
    const key = `pnl:${userId}:${granularity}:${filtersCacheKey(f)}`;
    const cached = this.cache.get(key) as PnlAnalytics | undefined;
    if (cached) return cached;

    const [trades, positions] = await Promise.all([
      this.repo.getClosedTrades(userId, f),
      this.repo.getOpenPositions(userId, f.botId ?? undefined),
    ]);
    const unrealized = positions.reduce((sum, p) => sum + unrealizedOfPosition(p), 0);
    const series = buildPnlSeries({
      trades,
      unrealized,
      granularity,
      startTime: f.startTime,
      endTime: f.endTime,
    });

    const result: PnlAnalytics = {
      granularity,
      realizedTotal: series.realizedTotal,
      unrealizedTotal: series.unrealizedTotal,
      cumulativeTotal: series.cumulativeTotal,
      points: series.points,
    };
    this.cache.set(key, result);
    return result;
  }

  async getPositions(userId: number, botId?: number): Promise<OpenPositionAnalytics[]> {
    const [positions, bots] = await Promise.all([
      this.repo.getOpenPositions(userId, botId),
      this.repo.getBots(userId),
    ]);
    const botsById = new Map(bots.map((b) => [b.id, b]));
    return positions.map((p) => formatPosition(p, botsById));
  }

  async getOrders(userId: number, botId?: number): Promise<ActiveOrderAnalytics[]> {
    const [executions, bots] = await Promise.all([
      this.repo.getActiveExecutions(userId, botId),
      this.repo.getBots(userId),
    ]);
    const botsById = new Map(bots.map((b) => [b.id, b]));
    return executions.map((execution) => {
      const bot = botsById.get(execution.botId);
      const kind: ActiveOrderAnalytics["kind"] = execution.positionId
        ? execution.protectiveStatus === "STOP_LOSS_ARMED" || execution.slOrderId
          ? "STOP_LOSS"
          : "TAKE_PROFIT"
        : "ENTRY";
      return {
        id: execution.id,
        executionId: execution.id,
        botId: execution.botId,
        botName: bot ? botName(bot) : `Bot #${execution.botId}`,
        symbol: execution.symbol,
        side: execution.side,
        kind,
        orderType: execution.entryStatus ?? "PENDING",
        price: execution.limitPrice,
        triggerPrice: execution.slOrderId ? execution.stopLoss : null,
        quantity: execution.quantity,
        status: execution.entryStatus,
        exchangeOrderId: execution.entryOrderId,
        createdAt: execution.createdAt,
      };
    });
  }

  async getTrades(
    userId: number,
    filters: AnalyticsFilters,
    page: number,
    pageSize: number,
    sortBy: string,
    sortDir: "asc" | "desc",
  ): Promise<Paged<ClosedTradeSummary>> {
    const [result, bots] = await Promise.all([
      this.repo.getClosedTradesPage(userId, defaultFilters(filters), page, pageSize, sortBy, sortDir),
      this.repo.getBots(userId),
    ]);
    const botsById = new Map(bots.map((b) => [b.id, b]));
    return {
      ...result,
      items: result.items.map((t) => formatTrade(t, botsById)),
    };
  }

  async getTradeDetail(userId: number, tradeId: number): Promise<TradeDetail | null> {
    const [trade, bots] = await Promise.all([
      this.repo.getClosedTrade(userId, tradeId),
      this.repo.getBots(userId),
    ]);
    if (!trade) return null;
    const exec = await this.repo.getExecution(userId, trade.executionId);
    const botsById = new Map(bots.map((b) => [b.id, b]));
    const events = await this.repo.getTradeEvents(userId, trade.executionId);
    const summary = formatTrade(trade, botsById);

    return {
      ...summary,
      executionId: trade.executionId,
      positionId: exec?.positionId != null ? Number(exec.positionId) : null,
      entryOrderId: exec?.entryOrderId ?? null,
      slOrderId: exec?.slOrderId ?? null,
      tpOrderId: exec?.tpOrderId ?? null,
      slStatus: exec?.slStatus ?? null,
      tpStatus: exec?.tpStatus ?? null,
      protectiveStatus: exec?.protectiveStatus ?? "NONE",
      trailingActivated: trade.trailingActivated,
      trailingDistancePct: null,
      highestPrice: trade.highestPrice,
      lowestPrice: trade.lowestPrice,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        botId: e.botId,
        botName: e.botId != null ? (botsById.get(e.botId) ? botName(botsById.get(e.botId)!) : null) : null,
        symbol: e.symbol,
        message: e.message,
        severity: e.type.toUpperCase().includes("ERROR") ? "ERROR" : e.type.toUpperCase().includes("WARN") ? "WARNING" : "INFO",
        timestamp: e.createdAt,
      })),
    };
  }

  async getStatistics(userId: number, filters?: AnalyticsFilters): Promise<TradeStatistics> {
    const f = defaultFilters(filters);
    const key = `stats:${userId}:${filtersCacheKey(f)}`;
    const cached = this.cache.get(key) as TradeStatistics | undefined;
    if (cached) return cached;
    const trades = await this.repo.getClosedTrades(userId, f);
    const stats = computeTradeStatistics(trades);
    this.cache.set(key, stats);
    return stats;
  }

  async getSymbols(userId: number, filters?: AnalyticsFilters): Promise<SymbolPerformance[]> {
    const f = defaultFilters(filters);
    const key = `symbols:${userId}:${filtersCacheKey(f)}`;
    const cached = this.cache.get(key) as SymbolPerformance[] | undefined;
    if (cached) return cached;
    const trades = await this.repo.getClosedTrades(userId, f);
    const result = aggregateBySymbol(trades);
    this.cache.set(key, result);
    return result;
  }

  async getStrategies(userId: number, filters?: AnalyticsFilters): Promise<StrategyPerformance[]> {
    const f = defaultFilters(filters);
    const key = `strategies:${userId}:${filtersCacheKey(f)}`;
    const cached = this.cache.get(key) as StrategyPerformance[] | undefined;
    if (cached) return cached;
    const [trades, bots] = await Promise.all([
      this.repo.getClosedTrades(userId, f),
      this.repo.getBots(userId),
    ]);
    const result = aggregateByStrategy(trades, new Map(bots.map((b) => [b.id, b])));
    this.cache.set(key, result);
    return result;
  }

  async getExitAnalytics(userId: number, filters?: AnalyticsFilters): Promise<ExitAnalytics> {
    const f = defaultFilters(filters);
    const key = `exits:${userId}:${filtersCacheKey(f)}`;
    const cached = this.cache.get(key) as ExitAnalytics | undefined;
    if (cached) return cached;
    const trades = await this.repo.getClosedTrades(userId, f);
    const result = computeExitAnalytics(trades);
    this.cache.set(key, result);
    return result;
  }

  async getOutcomeAnalytics(userId: number, filters?: AnalyticsFilters): Promise<OutcomeAnalytics> {
    const f = defaultFilters(filters);
    const key = `outcomes:${userId}:${filtersCacheKey(f)}`;
    const cached = this.cache.get(key) as OutcomeAnalytics | undefined;
    if (cached) return cached;
    const trades = await this.repo.getClosedTrades(userId, f);
    const result = computeOutcomeAnalytics(trades);
    this.cache.set(key, result);
    return result;
  }

  async getActivity(userId: number, opts: { botId?: number; limit?: number; offset?: number }): Promise<ActivityFeed> {
    const feed = await this.repo.getActivity(userId, { ...opts, limit: opts.limit ?? 50 });
    return {
      items: feed.items.map((e) => ({
        id: e.id,
        type: e.type,
        botId: e.botId,
        botName: null,
        symbol: e.symbol,
        message: e.message,
        severity: e.type.toUpperCase().includes("ERROR") ? "ERROR" : e.type.toUpperCase().includes("WARN") ? "WARNING" : "INFO",
        timestamp: e.createdAt,
      })),
      total: feed.total,
    };
  }
}

// Re-export backtest-related types so API routes can rely on the analytics barrel.
export type { BacktestDetail, BacktestSummary };
export { sumFees };
