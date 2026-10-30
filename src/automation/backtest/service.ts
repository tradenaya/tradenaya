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

/** Backtests running in THIS server process (production runs a single process). */
const runningJobs = new Set<number>();

/**
 * Never ask for candles that do not exist yet: an end date of "today" meant
 * 23:59 tonight, so the data check failed after downloading everything.
 */
export function clampToNow(config: BacktestConfig, now = Date.now()): BacktestConfig {
  if (!(config?.endTime > now)) return config;
  if (!(config.startTime < now)) {
    throw new BacktestError("The start date must be in the past.", "INVALID_CONFIG");
  }
  return { ...config, endTime: now };
}

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

  /**
   * Start a backtest in the background and return its record straight away
   * (status RUNNING). A long backtest takes minutes — far longer than the web
   * server waits for a request (the 504 "Gateway Time-out" users saw) — so the
   * page polls the list for progress and the result instead.
   */
  async start(userId: number, config: BacktestConfig): Promise<ReturnType<typeof summarizeBacktest>> {
    const prepared = await this.prepare(userId, config);
    runningJobs.add(prepared.id);
    void this.execute(prepared.id, userId, prepared.config)
      .catch(() => null) // already recorded as FAILED / CANCELLED on the row
      .finally(() => runningJobs.delete(prepared.id));
    const record = await this.store.get(userId, prepared.id);
    if (!record) throw new BacktestError("Backtest record disappeared after creation", "INTERNAL");
    return summarizeBacktest(record);
  }

  /** Run a backtest to completion (awaited). */
  async run(userId: number, config: BacktestConfig): Promise<ReturnType<typeof summarizeBacktest>> {
    const prepared = await this.prepare(userId, config);
    runningJobs.add(prepared.id);
    try {
      return await this.execute(prepared.id, userId, prepared.config);
    } finally {
      runningJobs.delete(prepared.id);
    }
  }

  /**
   * A RUNNING / QUEUED row that no job in this server process owns was cut off
   * by a restart (e.g. a deploy). Without this it stayed "in progress" forever
   * and, after two, blocked the user from starting any backtest.
   */
  async reapInterrupted(userId: number): Promise<void> {
    for (const id of await this.store.activeIds(userId)) {
      if (!runningJobs.has(id)) {
        await this.store.updateStatus(id, "FAILED", {
          errorMessage: "Stopped because the server restarted (for example an update was deployed) — please run it again.",
        });
      }
    }
  }

  private async prepare(userId: number, raw: BacktestConfig): Promise<{ id: number; config: BacktestConfig }> {
    const config = clampToNow(raw);
    this.validateConfig(config);
    await this.reapInterrupted(userId);
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
    return { id, config };
  }

  private async execute(id: number, userId: number, config: BacktestConfig): Promise<ReturnType<typeof summarizeBacktest>> {
    const provider = this.providerFactory(userId);
    let lastPersistedProgress = 0;
    // Progress writes are queued and awaited before the final status is written,
    // so a late "RUNNING" can never overwrite COMPLETED / FAILED.
    let progressWrites: Promise<void> = Promise.resolve();
    const onProgress = (progress: BacktestProgress) => {
      if (progress.percentage - lastPersistedProgress >= PROGRESS_THRESHOLD || progress.percentage >= 100) {
        lastPersistedProgress = progress.percentage;
        progressWrites = progressWrites.then(() =>
          this.store.updateStatus(id, "RUNNING", { progress }).catch((error) => {
            console.error(`[BacktestService] failed to persist progress for ${id}:`, error);
          }),
        );
      }
    };

    const engine = this.engineFactory({ provider, backtestId: id, onProgress });

    try {
      const result = await engine.run(config);
      await progressWrites;
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
      await progressWrites;
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
    await this.reapInterrupted(userId).catch(() => null);
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
