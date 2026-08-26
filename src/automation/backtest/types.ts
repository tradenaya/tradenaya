import type { AutomationConfig } from "@/automation/types";

export type BacktestStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export const TERMINAL_BACKTEST_STATUSES: BacktestStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

/**
 * Same-candle ambiguity policy.
 *
 * OHLC candles do not reveal tick-by-tick ordering. When a single candle can
 * contain an entry AND a take-profit AND a stop-loss we must choose a
 * deterministic assumption:
 *
 *  - TARGET_FIRST: assume the take-profit executes before the stop-loss.
 *  - STOP_FIRST:   assume the stop-loss executes before the take-profit.
 *  - CONSERVATIVE: the recommended default. Behaves like STOP_FIRST (the
 *                  worst case for the simulated trade) and is explicitly
 *                  documented in the result metadata.
 */
export type BacktestExecutionPolicy = "CONSERVATIVE" | "STOP_FIRST" | "TARGET_FIRST";

export type BacktestExitReason =
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "TRAILING_STOP"
  | "MANUAL"
  | "END_OF_BACKTEST"
  | "OTHER";

export type BacktestSide = "BUY" | "SELL";

export type BacktestPositionSide = "LONG" | "SHORT";

export const DEFAULT_BACKTEST_POLICY: BacktestExecutionPolicy = "CONSERVATIVE";

/** Fee applied per side (basis points). Defaults to 5 bps, matching the live PnL calculator. */
export const DEFAULT_FEE_RATE_BPS = 5;

/** Slippage applied to exits, in basis points. Default 0. */
export const DEFAULT_SLIPPAGE_BPS = 0;

export const DEFAULT_MAX_CONCURRENT_POSITIONS = 5;

export const DEFAULT_WARMUP_CANDLES = 30;

/**
 * A backtest configuration. Reuses every field that already exists on the
 * live AutomationConfig (symbol/timeframe/leverage/capital/risk/trailing/planner
 * knobs) and adds only backtest-specific inputs. The whole object is stored as
 * a configuration snapshot so a historical backtest stays reproducible even if
 * the user later changes their bot configuration.
 */
export interface BacktestConfig {
  symbol: string;
  timeframe: string;

  /** Historical window (epoch ms). */
  startTime: number;
  endTime: number;

  /** Initial account capital. Maps to AutomationConfig.capital. */
  initialCapital: number;
  capitalMode: "fixed" | "percent";
  walletPercent?: number;

  leverage: number;
  maxRiskPerTrade: number;
  dailyLossLimit: number;

  enableTrailingStop: boolean;
  trailingDistancePercent?: number;

  minRiskRewardRatio?: number;
  minStopDistancePct?: number;
  maxStopDistancePct?: number;
  maxVolatilityPct?: number;
  minConfidence?: number;
  orderExpiryMinutes?: number;

  /** Maximum concurrent simulated positions (maps to the risk exposure check). */
  maxConcurrentPositions?: number;

  /** Trading fee per side in basis points (default 5, matches live). */
  feeRateBps?: number;
  /** Exit slippage in basis points (default 0). Entry LIMIT fills at the limit price. */
  slippageBps?: number;

  /** Same-candle TP/SL ambiguity policy (default CONSERVATIVE). */
  executionPolicy?: BacktestExecutionPolicy;

  /** Minimum closed candles before the strategy is allowed to evaluate. */
  warmupCandles?: number;

  /** Optional reference to the live bot this backtest mirrors. */
  botId?: number | null;

  /** Free-form label for the frontend. */
  description?: string;
}

export interface BacktestProgress {
  currentTimestamp: number;
  startTime: number;
  endTime: number;
  percentage: number;
  candlesProcessed: number;
  totalCandles: number;
  tradesGenerated: number;
}

export interface SimulatedOrder {
  id: number;
  symbol: string;
  side: BacktestSide;
  type: "LIMIT";
  limitPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  leverage: number;
  margin: number;
  /** Candle close time when the order was created. */
  createdAt: number;
  /** Deterministic expiry derived from createdAt + orderExpiryMinutes. */
  expiresAt: number;
  reason: string;
  trailingEnabled: boolean;
  trailingDistancePct: number;
  trailingActivationPct: number;
}

export interface SimulatedPosition {
  id: number;
  symbol: string;
  side: BacktestPositionSide;
  state: "OPEN" | "CLOSED";
  quantity: number;
  entryPrice: number;
  entryTime: number;
  stopLoss: number;
  takeProfit: number;
  leverage: number;
  margin: number;
  trailingEnabled: boolean;
  trailingDistancePct: number;
  trailingActivationPct: number;
  trailingActivated: boolean;
  highestPrice: number;
  lowestPrice: number;
  currentPrice: number | null;
  exitPrice: number | null;
  exitTime: number | null;
  exitReason: BacktestExitReason | null;
  grossPnl: number | null;
  netPnl: number | null;
  totalFees: number | null;
  mfe: number;
  mae: number;
}

export interface BacktestTrade {
  tradeId: string;
  backtestId: number;
  symbol: string;
  side: BacktestPositionSide;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
  margin: number;
  grossPnl: number;
  entryFee: number;
  exitFee: number;
  totalFee: number;
  netPnl: number;
  returnPct: number;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  exitReason: BacktestExitReason;
  durationMs: number;
  /** Planned reward/risk ratio from the trade plan (|TP-entry| / |SL-entry|). */
  plannedRiskReward: number;
}

export interface BacktestEquityPoint {
  timestamp: number;
  balance: number;
  equity: number;
  drawdownPct: number;
}

export interface DataQualityReport {
  totalCandles: number;
  startTime: number;
  endTime: number;
  missingCandles: number;
  duplicateCandles: number;
  invalidCandles: number;
  outOfOrder: number;
  gaps: number;
  gapDetails: Array<{ at: number; gapMs: number }>;
  seriousProblems: boolean;
}

export interface BacktestMetrics {
  initialCapital: number;
  finalBalance: number;
  totalReturnPct: number;
  totalPnl: number;
  grossProfit: number;
  grossLoss: number;
  totalFees: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWinningTrade: number;
  avgLosingTrade: number;
  largestWinningTrade: number;
  largestLosingTrade: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  avgTradeDurationMs: number;
  longTrades: number;
  shortTrades: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  expectancy: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgRiskReward: number;
  exposurePct: number;
}

export interface BacktestResult {
  backtestId: number;
  config: BacktestConfig;
  executionPolicy: BacktestExecutionPolicy;
  slippageApplied: boolean;
  dataQuality: DataQualityReport;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  completedAt: number;
}

export interface BacktestRecord {
  id: number;
  userId: number;
  botId: number | null;
  symbol: string;
  timeframe: string;
  startTime: number;
  endTime: number;
  initialCapital: number;
  configSnapshot: BacktestConfig;
  status: BacktestStatus;
  progress: BacktestProgress | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  metrics?: BacktestMetrics | null;
}

/**
 * Build the AutomationConfig the live strategy pipeline expects from a
 * BacktestConfig. Initial capital maps to the bot's configured capital so the
 * exact same strategy/planner/risk code runs in backtest and live.
 */
export function toAutomationConfig(config: BacktestConfig): AutomationConfig {
  return {
    symbol: config.symbol,
    timeframe: config.timeframe,
    leverage: config.leverage,
    capital: config.initialCapital,
    capitalMode: config.capitalMode,
    walletPercent: config.walletPercent,
    maxRiskPerTrade: config.maxRiskPerTrade,
    dailyLossLimit: config.dailyLossLimit,
    enableTrailingStop: config.enableTrailingStop,
    trailingDistancePercent: config.trailingDistancePercent,
    minRiskRewardRatio: config.minRiskRewardRatio,
    minStopDistancePct: config.minStopDistancePct,
    maxStopDistancePct: config.maxStopDistancePct,
    maxVolatilityPct: config.maxVolatilityPct,
    minConfidence: config.minConfidence,
    orderExpiryMinutes: config.orderExpiryMinutes,
  };
}

/** Stable canonical serialization of the configuration (for duplicate detection). */
export function fingerprintConfig(config: BacktestConfig): string {
  const canonical: Record<string, unknown> = {
    symbol: String(config.symbol ?? "").toUpperCase(),
    timeframe: String(config.timeframe ?? "").toLowerCase(),
    startTime: config.startTime,
    endTime: config.endTime,
    initialCapital: config.initialCapital,
    capitalMode: config.capitalMode,
    walletPercent: config.walletPercent ?? null,
    leverage: config.leverage,
    maxRiskPerTrade: config.maxRiskPerTrade,
    dailyLossLimit: config.dailyLossLimit,
    enableTrailingStop: config.enableTrailingStop,
    trailingDistancePercent: config.trailingDistancePercent ?? null,
    minRiskRewardRatio: config.minRiskRewardRatio ?? null,
    minStopDistancePct: config.minStopDistancePct ?? null,
    maxStopDistancePct: config.maxStopDistancePct ?? null,
    maxVolatilityPct: config.maxVolatilityPct ?? null,
    minConfidence: config.minConfidence ?? null,
    orderExpiryMinutes: config.orderExpiryMinutes ?? null,
    maxConcurrentPositions: config.maxConcurrentPositions ?? null,
    feeRateBps: config.feeRateBps ?? null,
    slippageBps: config.slippageBps ?? null,
    executionPolicy: config.executionPolicy ?? null,
    warmupCandles: config.warmupCandles ?? null,
  };
  return JSON.stringify(canonical);
}
