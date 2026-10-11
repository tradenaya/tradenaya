import { describe, expect, it, vi } from "vitest";
import { BotAnalyticsService } from "./service";
import type { IAnalyticsRepository } from "./repository";
import type {
  ActivityRow,
  AnalyticsFilters,
  BotRow,
  ClosedTradeRow,
  ExecutionRow,
  OpenPositionRow,
} from "./types";

const DAY_MS = 86_400_000;
const DAY_1 = Date.UTC(2026, 0, 1);

function trade(overrides: Partial<ClosedTradeRow> = {}): ClosedTradeRow {
  return {
    id: 1,
    executionId: 10,
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

function position(overrides: Partial<OpenPositionRow> = {}): OpenPositionRow {
  return {
    id: 100,
    executionId: 10,
    botId: 1,
    userId: 1,
    symbol: "BTCUSDT",
    side: "BUY",
    state: "PROTECTED",
    quantity: 1,
    filledQuantity: 1,
    entryPrice: 100,
    plannedEntryPrice: 100,
    currentPrice: 120,
    stopLoss: 95,
    takeProfit: 130,
    leverage: 5,
    positionId: "pos-1",
    entryOrderId: "o-1",
    stopLossOrderId: "o-sl",
    takeProfitOrderId: "o-tp",
    stopLossTriggered: false,
    takeProfitTriggered: false,
    exitPrice: null,
    exitReason: null,
    realizedPnl: null,
    unrealizedPnl: 20,
    fees: null,
    trailingEnabled: true,
    trailingActivated: false,
    trailingDistancePct: 1,
    trailingActivationPct: 0.5,
    highestPrice: 121,
    lowestPrice: 99,
    errorMessage: null,
    createdAt: new Date(DAY_1).toISOString(),
    updatedAt: new Date(DAY_1).toISOString(),
    closedAt: null,
    ...overrides,
  };
}

function execution(overrides: Partial<ExecutionRow> = {}): ExecutionRow {
  return {
    id: 10,
    botId: 1,
    userId: 1,
    symbol: "BTCUSDT",
    side: "BUY",
    state: "CLOSED",
    executionKey: "key-10",
    limitPrice: 100,
    stopLoss: 95,
    takeProfit: 130,
    quantity: 1,
    filledQuantity: 1,
    leverage: 5,
    expiresAt: null,
    positionId: "pos-1",
    entryOrderId: "o-1",
    entryClientOrderId: "c-1",
    entryStatus: "FILLED",
    slOrderId: "o-sl",
    slClientOrderId: "c-sl",
    slStatus: "FILLED",
    tpOrderId: null,
    tpClientOrderId: null,
    tpStatus: null,
    protectiveStatus: "STOP_LOSS_FILLED",
    errorMessage: null,
    createdAt: new Date(DAY_1).toISOString(),
    updatedAt: new Date(DAY_1).toISOString(),
    ...overrides,
  };
}

class FakeRepository implements IAnalyticsRepository {
  bots: BotRow[];
  trades: ClosedTradeRow[];
  positions: OpenPositionRow[];
  executions: ExecutionRow[];
  activity: ActivityRow[];
  closedTradeCalls = 0;
  tradeDetail: ClosedTradeRow | null = null;

  constructor() {
    this.bots = [bot()];
    this.trades = [trade()];
    this.positions = [position()];
    this.executions = [execution()];
    this.activity = [];
    this.tradeDetail = trade();
  }

  async getBots(): Promise<BotRow[]> {
    return this.bots;
  }
  async getBot(_userId: number, botId: number): Promise<BotRow | null> {
    return this.bots.find((b) => b.id === botId) ?? null;
  }
  async countBots(): Promise<{ active: number; total: number }> {
    return { active: this.bots.length, total: this.bots.length };
  }
  async getClosedTrades(): Promise<ClosedTradeRow[]> {
    this.closedTradeCalls += 1;
    return this.trades;
  }
  async getClosedTradesPage(): Promise<never> {
    throw new Error("not implemented");
  }
  async getOpenPositions(): Promise<OpenPositionRow[]> {
    return this.positions;
  }
  async getActiveExecutions(): Promise<ExecutionRow[]> {
    return this.executions;
  }
  async getActivity(_userId: number, _opts: { botId?: number; limit?: number; offset?: number } = {}): Promise<{
    items: ActivityRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    return { items: this.activity, total: this.activity.length, page: 1, pageSize: 50, totalPages: 1 };
  }
  async getClosedTrade(_userId: number, tradeId: number): Promise<ClosedTradeRow | null> {
    return this.tradeDetail && this.tradeDetail.id === tradeId ? this.tradeDetail : null;
  }
  async getExecution(_userId: number, executionId: number): Promise<ExecutionRow | null> {
    return this.executions.find((e) => e.id === executionId) ?? null;
  }
  async getTradeEvents(_userId: number, _executionId: number, _limit = 50): Promise<ActivityRow[]> {
    return this.activity;
  }
}

describe("BotAnalyticsService", () => {
  it("computes an account summary from repository data", async () => {
    const repo = new FakeRepository();
    const service = new BotAnalyticsService(repo);
    const summary = await service.getAccountSummary(1);

    expect(summary.realizedPnl).toBeCloseTo(10, 8);
    expect(summary.unrealizedPnl).toBeCloseTo(20, 8);
    expect(summary.totalPnl).toBeCloseTo(30, 8);
    expect(summary.totalTrades).toBe(1);
    expect(summary.winningTrades).toBe(1);
    expect(summary.winRate).toBeCloseTo(100, 1);
    expect(summary.totalFees).toBeCloseTo(0.5, 8);
    expect(summary.openPositions).toBe(1);
    expect(summary.activeBots).toBe(1);
    expect(summary.totalBots).toBe(1);
  });

  it("builds bot summaries with a live position and current PnL", async () => {
    const repo = new FakeRepository();
    const service = new BotAnalyticsService(repo);
    const bots = await service.getBotSummaries(1);

    expect(bots).toHaveLength(1);
    const summary = bots[0];
    expect(summary.name).toContain("BTCUSDT");
    expect(summary.enabled).toBe(true);
    expect(summary.currentPosition).not.toBeNull();
    expect(summary.currentPnl).toBeCloseTo(20, 8);
    expect(summary.tradeCount).toBe(1);
    expect(summary.totalPnl).toBeCloseTo(10, 8);
    expect(summary.winRate).toBeCloseTo(100, 1);
  });

  it("excludes cancelled trades from bot summary win rate", async () => {
    const repo = new FakeRepository();
    repo.trades = [
      trade({ id: 1, realizedPnl: 20 }),
      trade({ id: 2, realizedPnl: 12 }),
      trade({ id: 3, exitReason: "ENTRY_CANCELLED", realizedPnl: 0 }),
    ];
    const service = new BotAnalyticsService(repo);
    const bots = await service.getBotSummaries(1);
    expect(bots).toHaveLength(1);
    const bot = bots[0];
    expect(bot.tradeCount).toBe(3);
    expect(bot.winningTrades).toBe(2);
    expect(bot.losingTrades).toBe(0);
    expect(bot.cancelledTrades).toBe(1);
    expect(bot.winRate).toBeCloseTo(100, 1);
  });

  it("reports cancelled trades in the account summary", async () => {
    const repo = new FakeRepository();
    repo.trades = [
      trade({ id: 1, realizedPnl: 20 }),
      trade({ id: 2, exitReason: "ENTRY_CANCELLED", realizedPnl: 0 }),
    ];
    const service = new BotAnalyticsService(repo);
    const summary = await service.getAccountSummary(1);
    expect(summary.totalTrades).toBe(2);
    expect(summary.winningTrades).toBe(1);
    expect(summary.losingTrades).toBe(0);
    expect(summary.cancelledTrades).toBe(1);
    expect(summary.winRate).toBeCloseTo(100, 1);
  });

  it("exposes open positions with protection status", async () => {
    const repo = new FakeRepository();
    const service = new BotAnalyticsService(repo);
    const positions = await service.getPositions(1);
    expect(positions).toHaveLength(1);
    expect(positions[0].protectionStatus).toBe("PROTECTED");
    expect(positions[0].margin).toBeCloseTo(20, 8);
  });

  it("uses bot capital as the equity baseline", async () => {
    const repo = new FakeRepository();
    repo.bots = [bot({ capital: 2000 })];
    repo.trades = [trade({ realizedPnl: 50 })];
    const service = new BotAnalyticsService(repo);
    const equity = await service.getEquity(1);
    expect(equity.startingEquity).toBeCloseTo(2000, 8);
    expect(equity.currentEquity).toBeCloseTo(2070, 8);
  });

  it("builds a PnL series with the requested granularity", async () => {
    const repo = new FakeRepository();
    const service = new BotAnalyticsService(repo);
    const pnl = await service.getPnl(1, "daily");
    expect(pnl.granularity).toBe("daily");
    expect(pnl.realizedTotal).toBeCloseTo(10, 8);
    expect(pnl.unrealizedTotal).toBeCloseTo(20, 8);
  });

  it("returns trade detail joined with execution data", async () => {
    const repo = new FakeRepository();
    const service = new BotAnalyticsService(repo);
    const detail = await service.getTradeDetail(1, 1);
    expect(detail).not.toBeNull();
    expect(detail!.executionId).toBe(10);
    expect(detail!.entryOrderId).toBe("o-1");
    expect(detail!.slOrderId).toBe("o-sl");
    expect(detail!.protectiveStatus).toBe("STOP_LOSS_FILLED");
  });

  it("returns null for a missing trade", async () => {
    const repo = new FakeRepository();
    repo.tradeDetail = null;
    const service = new BotAnalyticsService(repo);
    expect(await service.getTradeDetail(1, 999)).toBeNull();
  });

  it("caches expensive aggregations", async () => {
    const repo = new FakeRepository();
    const service = new BotAnalyticsService(repo, { cacheTtlMs: 60_000 });
    await service.getStatistics(1);
    await service.getStatistics(1);
    expect(repo.closedTradeCalls).toBe(1);
  });
});

describe("BotAnalyticsService strategy filter & comparison", () => {
  /** Fake that honours the strategy filter the way the SQL does (via the trade's bot). */
  class StrategyRepository extends FakeRepository {
    async getClosedTrades(_userId?: number, filters?: AnalyticsFilters): Promise<ClosedTradeRow[]> {
      const ids = filters?.strategy ? new Set(this.bots.filter((b) => b.strategy === filters.strategy).map((b) => b.id)) : null;
      return this.trades.filter((t) => (!ids || ids.has(t.botId)) && (filters?.startTime == null || new Date(t.closedAt).getTime() >= filters.startTime));
    }
  }

  function setup() {
    const repo = new StrategyRepository();
    repo.bots = [bot({ id: 1, strategy: "TradenayaSmartV1" }), bot({ id: 2, strategy: "TrendBreakoutV1" })];
    repo.trades = [
      trade({ id: 1, botId: 1, realizedPnl: 10, fees: 0, closedAt: new Date(DAY_1).toISOString() }),
      trade({ id: 2, botId: 1, realizedPnl: -20, fees: 0, exitReason: "STOP_LOSS", closedAt: new Date(DAY_1 + DAY_MS).toISOString() }),
      trade({ id: 3, botId: 2, realizedPnl: -5, fees: 0, exitReason: "STOP_LOSS", closedAt: new Date(DAY_1).toISOString() }),
      trade({ id: 4, botId: 2, realizedPnl: 30, fees: 0, closedAt: new Date(DAY_1 + 2 * DAY_MS).toISOString() }),
    ];
    repo.positions = [position({ botId: 1 }), position({ id: 101, botId: 2, unrealizedPnl: 5 })];
    return { repo, service: new BotAnalyticsService(repo) };
  }

  it("filters summary trades and open positions by strategy", async () => {
    const { service } = setup();
    const summary = await service.getAccountSummary(1, { strategy: "TrendBreakoutV1" });
    expect(summary.totalTrades).toBe(2);
    expect(summary.openPositions).toBe(1);
    const positions = await service.getPositions(1, undefined, "TrendBreakoutV1");
    expect(positions.map((p) => p.botId)).toEqual([2]);
  });

  it("compares strategies side by side over the same window", async () => {
    const { service } = setup();
    const result = await service.getStrategyComparison(1, ["TradenayaSmartV1", "TrendBreakoutV1"], null, null);
    const [smart, breakout] = result.rows;
    expect(smart).toMatchObject({ strategy: "TradenayaSmartV1", label: "Tradenaya Smart", trades: 2, bots: 1 });
    expect(smart.netPnl).toBeCloseTo(-10);
    expect(smart.maxDrawdown).toBeCloseTo(20);
    expect(breakout).toMatchObject({ strategy: "TrendBreakoutV1", label: "Trend Breakout (4h)", trades: 2 });
    expect(breakout.netPnl).toBeCloseTo(25);
    expect(breakout.curve.map((p) => p.cumulativePnl)).toEqual([-5, 25]);
  });

  it("applies the comparison window", async () => {
    const { service } = setup();
    const result = await service.getStrategyComparison(1, ["TrendBreakoutV1"], DAY_1 + DAY_MS, null);
    expect(result.rows[0].trades).toBe(1);
  });
});
