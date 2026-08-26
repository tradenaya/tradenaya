import type { MarketCandle } from "@/automation/types";
import { AutomationEngine } from "@/automation/engine/automation-engine";
import { TechnicalIndicatorEngine } from "@/automation/indicators/indicator-engine";
import { StrategyRegistry } from "@/automation/strategy/strategy-registry";
import { DefaultTradePlanner } from "@/automation/planner/trade-planner";
import { DefaultRiskManager } from "@/automation/risk/risk-manager";
import type { RiskManagerInput } from "@/automation/risk/types";
import type { TradePlan } from "@/automation/planner/types";
import { normalizeInterval, normalizeSymbol } from "@/automation/market/normalizer";
import type { MarketDataService } from "@/automation/market/market-data-service";
import { BacktestError, BacktestCancelledError } from "./errors";
import { HistoricalMarketDataAdapter } from "./market-adapter";
import type { HistoricalMarketDataProvider } from "./data-provider";
import { validateCandleQuality } from "./data-provider";
import { BacktestExecutionEngine } from "./execution-engine";
import { BacktestPortfolio } from "./portfolio";
import { BacktestMetricsCalculator } from "./metrics";
import {
  DEFAULT_FEE_RATE_BPS,
  DEFAULT_MAX_CONCURRENT_POSITIONS,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_WARMUP_CANDLES,
  DEFAULT_BACKTEST_POLICY,
  toAutomationConfig,
  type BacktestConfig,
  type BacktestEquityPoint,
  type BacktestProgress,
  type BacktestResult,
  type BacktestTrade,
} from "./types";

export interface BacktestingEngineOptions {
  provider: HistoricalMarketDataProvider;
  backtestId?: number;
  shouldCancel?: () => boolean;
  onProgress?: (progress: BacktestProgress) => void;
  onTrade?: (trade: BacktestTrade) => void;
  progressIntervalCandles?: number;
  /** Override for tests: build the exact live pipeline around the adapter. */
  engineFactory?: (adapter: MarketDataService) => AutomationEngine;
  riskManager?: DefaultRiskManager;
}

const DEFAULT_PROGRESS_INTERVAL = 250;

export class BacktestingEngine {
  private readonly provider: HistoricalMarketDataProvider;
  private readonly shouldCancel: () => boolean;
  private readonly onProgress?: (progress: BacktestProgress) => void;
  private readonly onTrade?: (trade: BacktestTrade) => void;
  private readonly progressInterval: number;
  private readonly backtestId: number;
  private readonly engineFactory?: (adapter: MarketDataService) => AutomationEngine;
  private readonly riskManager: DefaultRiskManager;

  constructor(options: BacktestingEngineOptions) {
    this.provider = options.provider;
    this.backtestId = options.backtestId ?? 0;
    this.shouldCancel = options.shouldCancel ?? (() => false);
    this.onProgress = options.onProgress;
    this.onTrade = options.onTrade;
    this.progressInterval = options.progressIntervalCandles ?? DEFAULT_PROGRESS_INTERVAL;
    this.engineFactory = options.engineFactory;
    this.riskManager = options.riskManager ?? new DefaultRiskManager();
  }

  /**
   * Run the full backtest. Execution is purely server-side and deterministic:
   * the only inputs are the historical candles and the configuration snapshot.
   */
  async run(config: BacktestConfig): Promise<BacktestResult> {
    this.validateConfig(config);

    const candles = await this.provider.getCandles({
      symbol: config.symbol,
      timeframe: config.timeframe,
      startTime: config.startTime,
      endTime: config.endTime,
    });

    if (candles.length === 0) {
      throw new BacktestError(
        `No historical candles returned for ${config.symbol} in the requested window.`,
        "NO_DATA",
      );
    }

    const intervalMs = this.intervalMs(config.timeframe);
    const dataQuality = validateCandleQuality(candles, { intervalMs });

    const feeRateBps = config.feeRateBps ?? DEFAULT_FEE_RATE_BPS;
    const slippageBps = config.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    const executionPolicy = config.executionPolicy ?? DEFAULT_BACKTEST_POLICY;
    const warmup = Math.min(config.warmupCandles ?? DEFAULT_WARMUP_CANDLES, candles.length - 1);

    const adapter = new HistoricalMarketDataAdapter();
    const engine =
      this.engineFactory?.(adapter) ??
      new AutomationEngine(
        adapter,
        new TechnicalIndicatorEngine(),
        new StrategyRegistry(),
        new DefaultTradePlanner(),
        this.riskManager,
      );

    const portfolio = new BacktestPortfolio(config.initialCapital, slippageBps);
    const sim = new BacktestExecutionEngine(
      { feeRateBps, slippageBps, executionPolicy, backtestId: this.backtestId, trailingActivationPct: 0 },
      portfolio,
    );

    const equityCurve: BacktestEquityPoint[] = [];
    let exposureSum = 0;
    let exposureCount = 0;

    for (let i = warmup; i < candles.length; i += 1) {
      this.checkCancelled();
      const candle = candles[i];

      if (sim.isIdle()) {
        await this.evaluateSignal(config, candles, adapter, engine, sim, portfolio, candle, i);
      }

      const result = sim.processCandle(candle);
      if (result.trade) this.onTrade?.(result.trade);

      const openPosition = sim.getOpenPosition();
      portfolio.markToMarket(openPosition ? [openPosition] : [], candle.close);

      const equity = portfolio.getEquity();
      const balance = portfolio.getBalance();
      equityCurve.push({
        timestamp: candle.timestamp,
        balance,
        equity,
        drawdownPct: portfolio.drawdownPct(),
      });
      exposureSum += (portfolio.getUsedMargin() / Math.max(equity, 1)) * 100;
      exposureCount += 1;

      if (i % this.progressInterval === 0 || i === candles.length - 1) {
        this.emitProgress(config, candles, i, sim.getTrades().length);
      }
    }

    // END_OF_BACKTEST policy: close any open position at the final price.
    const lastCandle = candles[candles.length - 1];
    const closingTrade = sim.closeAtEndOfBacktest(lastCandle.timestamp, lastCandle.close);
    if (closingTrade) this.onTrade?.(closingTrade);
    portfolio.markToMarket([], lastCandle.close);

    const lastPoint = equityCurve[equityCurve.length - 1];
    if (lastPoint && lastPoint.timestamp === lastCandle.timestamp) {
      lastPoint.balance = portfolio.getBalance();
      lastPoint.equity = portfolio.getEquity();
      lastPoint.drawdownPct = portfolio.drawdownPct();
    } else {
      equityCurve.push({
        timestamp: lastCandle.timestamp,
        balance: portfolio.getBalance(),
        equity: portfolio.getEquity(),
        drawdownPct: portfolio.drawdownPct(),
      });
    }

    const trades = sim.getTrades();
    const metrics = new BacktestMetricsCalculator().compute({
      initialCapital: config.initialCapital,
      finalBalance: portfolio.getBalance(),
      trades,
      equityCurve,
      exposurePct: exposureCount > 0 ? exposureSum / exposureCount : 0,
      intervalMs,
    });

    this.emitProgress(config, candles, candles.length - 1, trades.length);

    return {
      backtestId: this.backtestId,
      config,
      executionPolicy,
      slippageApplied: slippageBps > 0,
      dataQuality: dataQuality,
      metrics,
      trades,
      equityCurve,
      completedAt: Date.now(),
    };
  }

  // ---- internals ----

  private async evaluateSignal(
    config: BacktestConfig,
    candles: MarketCandle[],
    adapter: HistoricalMarketDataAdapter,
    engine: AutomationEngine,
    sim: BacktestExecutionEngine,
    portfolio: BacktestPortfolio,
    candle: MarketCandle,
    candleIndex: number,
  ): Promise<void> {
    // Rewind the market adapter so the strategy only ever sees closed candles
    // up to and including the current one — nothing from the future.
    adapter.setSlice(candles, candleIndex + 1);

    const decision = await engine.run(toAutomationConfig(config));
    const plan = decision.plan;
    if (decision.signal === "WAIT" || !plan || plan.action === "WAIT") return;

    const limitPrice = plan.limitPrice ?? null;
    const stopLoss = plan.stopLoss ?? null;
    const takeProfit = plan.takeProfit ?? null;
    if (!(limitPrice != null && limitPrice > 0) || !(stopLoss != null && stopLoss > 0) || !(takeProfit != null && takeProfit > 0)) {
      return;
    }
    if (!(plan.riskRewardRatio != null && plan.riskRewardRatio > 0)) return;

    const risk = this.riskManager.evaluate(this.buildRiskInput(config, plan, portfolio, candle));
    if (!risk.approved || !(risk.positionSize > 0)) return;

    const createdAt = candle.timestamp;
    const expiryMinutes = config.orderExpiryMinutes && config.orderExpiryMinutes > 0 ? config.orderExpiryMinutes : 120;

    sim.placeOrder({
      symbol: plan.symbol ?? config.symbol,
      side: plan.side === "SELL" ? "SELL" : "BUY",
      limitPrice,
      stopLoss,
      takeProfit,
      quantity: risk.positionSize,
      leverage: config.leverage,
      margin: risk.capitalUsed,
      createdAt,
      expiresAt: createdAt + expiryMinutes * 60_000,
      reason: plan.reason,
      trailingEnabled: config.enableTrailingStop,
      trailingDistancePct: config.trailingDistancePercent ?? 1,
      trailingActivationPct: 0,
    });
  }

  private buildRiskInput(config: BacktestConfig, plan: TradePlan, portfolio: BacktestPortfolio, candle: MarketCandle): RiskManagerInput {
    const wallet = portfolio.walletSnapshot();
    const date = new Date(candle.timestamp).toISOString().slice(0, 10);
    const daily = portfolio.dailyStats(date);
    return {
      config: {
        maxRiskPerTradePct: config.maxRiskPerTrade,
        maxCapitalAllocationPct: 100,
        minWalletBalance: 0,
        maxLeverage: config.leverage,
        maxSimultaneousPositions: config.maxConcurrentPositions ?? DEFAULT_MAX_CONCURRENT_POSITIONS,
        maxSimultaneousBots: 5,
        dailyLossLimitPct: config.dailyLossLimit,
        dailyTradeLimit: 20,
        maxDrawdownPct: 15,
        minRiskRewardRatio: config.minRiskRewardRatio ?? 2,
      },
      wallet: { balance: wallet.balance, equity: wallet.equity, peakBalance: wallet.peakBalance },
      capital: {
        mode: config.capitalMode,
        amount: config.capitalMode === "fixed" ? config.initialCapital : undefined,
        percent: config.capitalMode === "percent" ? config.walletPercent : undefined,
        leverage: config.leverage,
      },
      plan: { ...plan, symbol: plan.symbol ?? config.symbol },
      // Only evaluated while idle, so there can never be concurrent exposure here.
      openPositions: [],
      openOrders: [],
      daily: { date, realizedPnl: daily.realizedPnl.toNumber(), tradeCount: daily.tradeCount },
      runningBots: 1,
    };
  }

  private checkCancelled(): void {
    if (this.shouldCancel()) {
      throw new BacktestCancelledError();
    }
  }

  private emitProgress(config: BacktestConfig, candles: MarketCandle[], index: number, tradesGenerated: number): void {
    if (!this.onProgress) return;
    const processed = index + 1;
    this.onProgress({
      currentTimestamp: candles[index].timestamp,
      startTime: config.startTime,
      endTime: config.endTime,
      percentage: (processed / candles.length) * 100,
      candlesProcessed: processed,
      totalCandles: candles.length,
      tradesGenerated,
    });
  }

  private intervalMs(timeframe: string): number {
    const minutes = normalizeInterval(timeframe);
    if (minutes === null) {
      throw new BacktestError(`Unsupported timeframe: ${timeframe}`, "INVALID_CONFIG");
    }
    return minutes * 60_000;
  }

  private validateConfig(config: BacktestConfig): void {
    const symbol = normalizeSymbol(config.symbol);
    if (!symbol || symbol.length < 5) throw new BacktestError("A valid trading symbol is required", "INVALID_CONFIG");
    if (normalizeInterval(config.timeframe) === null) throw new BacktestError("A valid timeframe is required", "INVALID_CONFIG");
    if (!(config.startTime > 0) || !(config.endTime > config.startTime)) throw new BacktestError("Invalid backtest time window", "INVALID_CONFIG");
    if (!(config.initialCapital > 0)) throw new BacktestError("Initial capital must be greater than zero", "INVALID_CONFIG");
    if (!(config.leverage > 0)) throw new BacktestError("Leverage must be greater than zero", "INVALID_CONFIG");
    if (!(config.maxRiskPerTrade > 0)) throw new BacktestError("Max risk per trade must be greater than zero", "INVALID_CONFIG");
    if (config.dailyLossLimit == null || config.dailyLossLimit < 0) throw new BacktestError("Daily loss limit is required", "INVALID_CONFIG");
    if ((config.feeRateBps ?? 0) < 0) throw new BacktestError("Fee rate cannot be negative", "INVALID_CONFIG");
    if ((config.slippageBps ?? 0) < 0) throw new BacktestError("Slippage cannot be negative", "INVALID_CONFIG");
  }
}
