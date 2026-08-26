import { MarketDataRestClient } from "@/automation/market/rest-client";
import { BacktestingEngine } from "./engine";
import { BacktestError, BacktestCancelledError } from "./errors";
import { RestHistoricalDataProvider } from "./data-provider";
import type { HistoricalMarketDataProvider } from "./data-provider";
import { BacktestStore, summarizeBacktest } from "./store";
import type { BacktestConfig, BacktestProgress } from "./types";

/** Maximum concurrently active (queued/running) backtests per user. */
export const MAX_ACTIVE_BACKTESTS = 2;

/** Progress persistence threshold: only write the row every ~5%. */
const PROGRESS_THRESHOLD = 5;

export interface BacktestServiceOptions {
  store?: BacktestStore;
  /** For tests: swap in a fake engine that returns a canned BacktestResult. */
  engineFactory?: (options: {
    provider: HistoricalMarketDataProvider;
    backtestId: number;
    onProgress: (progress: BacktestProgress) => void;
  }) => Pick<BacktestingEngine, "run">;
  /** For tests: override the historical data provider. */
  providerFactory?: typeof makeProvider;
}

function makeProvider(userId: number) {
  return new RestHistoricalDataProvider({ restClient: new MarketDataRestClient(), userId });
}

export class BacktestService {
  private readonly store: BacktestStore;
  private readonly engineFactory: NonNullable<BacktestServiceOptions["engineFactory"]>;
  private readonly providerFactory: (userId: number) => HistoricalMarketDataProvider;

  constructor(options: BacktestServiceOptions = {}) {
    this.store = options.store ?? new BacktestStore();
    this.providerFactory = options.providerFactory ?? makeProvider;
    this.engineFactory = options.engineFactory ?? (({ provider, backtestId, onProgress }) => {
      const engine = new BacktestingEngine({ provider, backtestId, onProgress });
      return { run: (config: BacktestConfig) => engine.run(config) };
    });
  }

  async run(userId: number, config: BacktestConfig): Promise<ReturnType<typeof summarizeBacktest>> {
    this.validateConfig(config);
    const active = await this.store.countActive(userId);
    if (active >= MAX_ACTIVE_BACKTESTS) {
      throw new BacktestError(
        `You already have ${active} backtest${active === 1 ? "" : "s"} in progress. Wait for one to finish before starting another.`,
        "DUPLICATE_JOB",
      );
    }

    const id = await this.store.create({
      userId,
      botId: config.botId ?? null,
      symbol: config.symbol,
      timeframe: config.timeframe,
      startTime: config.startTime,
      endTime: config.endTime,
      initialCapital: config.initialCapital,
      config: config as unknown as Record<string, unknown>,
    });

    await this.store.updateStatus(id, "RUNNING", { progress: null });

    const provider = this.providerFactory(userId);
    let lastPersistedProgress = 0;
    const onProgress = (progress: BacktestProgress) => {
      if (progress.percentage - lastPersistedProgress >= PROGRESS_THRESHOLD || progress.percentage >= 100) {
        lastPersistedProgress = progress.percentage;
        this.store.updateStatus(id, "RUNNING", { progress }).catch((error) => {
          console.error(`[BacktestService] failed to persist progress for ${id}:`, error);
        });
      }
    };

    const engine = this.engineFactory({ provider, backtestId: id, onProgress });

    try {
      const result = await engine.run(config);
      await this.store.saveResult(id, {
        metrics: result.metrics,
        equityCurve: result.equityCurve,
        executionPolicy: result.executionPolicy,
        slippageApplied: result.slippageApplied,
        completedAt: result.completedAt,
      });
      await this.store.insertTrades(id, result.trades);
      const record = await this.store.get(userId, id);
      if (!record) throw new BacktestError("Backtest record disappeared during execution", "INTERNAL");
      return summarizeBacktest(record);
    } catch (error) {
      if (error instanceof BacktestCancelledError) {
        await this.store.updateStatus(id, "CANCELLED", { errorMessage: error.message });
      } else {
        const message = error instanceof Error ? error.message : "Unknown backtest failure";
        await this.store.updateStatus(id, "FAILED", { errorMessage: message });
      }
      throw error;
    }
  }

  async list(userId: number, limit = 20): Promise<ReturnType<typeof summarizeBacktest>[]> {
    const records = await this.store.list(userId, limit);
    return records.map(summarizeBacktest);
  }

  async getSummary(userId: number, id: number): Promise<ReturnType<typeof summarizeBacktest> | null> {
    const record = await this.store.get(userId, id);
    return record ? summarizeBacktest(record) : null;
  }

  async getDetail(userId: number, id: number) {
    const record = await this.store.get(userId, id);
    if (!record) return null;
    const trades = await this.store.getTrades(userId, id);
    return {
      ...summarizeBacktest(record),
      config: record.config,
      metrics: record.metrics,
      equityCurve: record.equityCurve,
      trades,
    };
  }

  async remove(userId: number, id: number): Promise<boolean> {
    return this.store.delete(userId, id);
  }

  private validateConfig(config: BacktestConfig): void {
    if (!config || typeof config !== "object") {
      throw new BacktestError("A backtest configuration is required", "INVALID_CONFIG");
    }
    if (!(config.initialCapital > 0)) throw new BacktestError("Initial capital must be greater than zero", "INVALID_CONFIG");
    if (!(config.leverage > 0)) throw new BacktestError("Leverage must be greater than zero", "INVALID_CONFIG");
    if (!(config.maxRiskPerTrade > 0)) throw new BacktestError("Max risk per trade must be greater than zero", "INVALID_CONFIG");
    if (config.dailyLossLimit == null || config.dailyLossLimit < 0) throw new BacktestError("Daily loss limit is required", "INVALID_CONFIG");
    if (!(config.startTime > 0) || !(config.endTime > config.startTime)) throw new BacktestError("Invalid backtest time window", "INVALID_CONFIG");
  }
}
