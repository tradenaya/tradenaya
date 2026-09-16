import type {
  BacktestConfig,
  BacktestEquityPoint,
  BacktestMetrics,
  BacktestStatus,
  BacktestTrade,
} from "@/automation/backtest/types";
import type { ExecutionState } from "@/automation/executor/types";
import type { ExitReason, PositionState } from "@/automation/position/PositionManagerTypes";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * Analytics query filters. All date bounds are epoch milliseconds. Every query
 * is additionally scoped by the authenticated userId inside the repository.
 */
export interface AnalyticsFilters {
  botId?: number | null;
  symbol?: string | null;
  strategy?: string | null;
  side?: "BUY" | "SELL" | null;
  exitReason?: string | null;
  startTime?: number | null;
  endTime?: number | null;
}

export interface PagedRequest {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Raw rows returned by the repository (shapes mirror the automation_* tables)
// ---------------------------------------------------------------------------

export interface BotRow {
  id: number;
  userId: number;
  symbol: string;
  strategy: string;
  leverage: number;
  capital: number;
  capitalMode: string;
  walletPercent: number | null;
  status: string;
  desiredStatus: string | null;
  currentTrade: string | null;
  lastAnalysisAt: string | null;
  lastExecutionAt: string | null;
  configJson: string | null;
  lastError: string | null;
  retryCount: number | null;
  heartbeatAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ClosedTradeRow {
  id: number;
  executionId: number;
  botId: number;
  userId: number;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  exitReason: string;
  realizedPnl: number;
  fees: number;
  /** Price-move profit before costs (may be 0 for pre-accounting rows). */
  grossProfit: number;
  /** Entry + exit commission. */
  commission: number;
  /** Funding fees accrued while open. */
  fundingFee: number;
  /** True net P&L = grossProfit - commission - fundingFee. */
  netPnl: number;
  positionSize: number;
  closedAt: string;
  createdAt: string;
  /** Populated by a join with automation_positions when available. */
  entryTime: string | null;
  durationMs: number | null;
  trailingActivated: boolean;
  highestPrice: number | null;
  lowestPrice: number | null;
  leverage: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface OpenPositionRow {
  id: number;
  executionId: number | null;
  botId: number;
  userId: number;
  symbol: string;
  side: "BUY" | "SELL";
  state: PositionState;
  quantity: number | null;
  filledQuantity: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  leverage: number | null;
  positionId: string | null;
  entryOrderId: string | null;
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  stopLossTriggered: boolean;
  takeProfitTriggered: boolean;
  exitPrice: number | null;
  exitReason: string | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  fees: number | null;
  trailingEnabled: boolean;
  trailingActivated: boolean;
  trailingDistancePct: number | null;
  trailingActivationPct: number | null;
  highestPrice: number | null;
  lowestPrice: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface ExecutionRow {
  id: number;
  botId: number;
  userId: number;
  symbol: string;
  side: "BUY" | "SELL";
  state: ExecutionState;
  executionKey: string;
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  quantity: number | null;
  filledQuantity: number | null;
  leverage: number | null;
  expiresAt: number | null;
  positionId: string | null;
  entryOrderId: string | null;
  entryClientOrderId: string | null;
  entryStatus: string | null;
  slOrderId: string | null;
  slClientOrderId: string | null;
  slStatus: string | null;
  tpOrderId: string | null;
  tpClientOrderId: string | null;
  tpStatus: string | null;
  protectiveStatus: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRow {
  id: number;
  type: string;
  botId: number | null;
  userId: number;
  symbol: string | null;
  message: string;
  createdAt: string;
  source: "scheduler" | "position" | "notification";
}

// ---------------------------------------------------------------------------
// Analytics DTOs
// ---------------------------------------------------------------------------

export interface AccountSummary {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  todayPnl: number;
  weeklyPnl: number;
  monthlyPnl: number;
  totalFees: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  cancelledTrades: number;
  winRate: number;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  openPositions: number;
  activeBots: number;
  totalBots: number;
}

export interface OpenPositionAnalytics {
  positionId: number;
  botId: number;
  botName: string;
  symbol: string;
  side: "BUY" | "SELL";
  state: PositionState;
  quantity: number | null;
  filledQuantity: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  leverage: number | null;
  margin: number | null;
  unrealizedPnl: number | null;
  trailingEnabled: boolean;
  trailingActivated: boolean;
  trailingDistancePct: number | null;
  protectionStatus: "PROTECTED" | "UNPROTECTED" | "TRAILING" | "PENDING";
  highestPrice: number | null;
  lowestPrice: number | null;
  openTime: string;
  durationMs: number;
}

export interface ClosedTradeSummary {
  id: number;
  tradeId: string;
  botId: number;
  botName: string;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  realizedPnl: number;
  fees: number;
  netPnl: number;
  grossProfit: number;
  commission: number;
  fundingFee: number;
  entryTime: string;
  exitTime: string;
  durationMs: number;
  exitReason: string;
  leverage: number | null;
  strategy: string;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingActivated: boolean;
  highestPrice: number | null;
  lowestPrice: number | null;
}

export interface TradeDetail extends ClosedTradeSummary {
  executionId: number;
  positionId: number | null;
  entryOrderId: string | null;
  slOrderId: string | null;
  tpOrderId: string | null;
  slStatus: string | null;
  tpStatus: string | null;
  protectiveStatus: string;
  trailingActivated: boolean;
  trailingDistancePct: number | null;
  highestPrice: number | null;
  lowestPrice: number | null;
  events: ActivityEntry[];
}

export interface BotSummary {
  id: number;
  name: string;
  symbol: string;
  strategy: string;
  status: string;
  enabled: boolean;
  desiredStatus: string | null;
  leverage: number;
  capital: number;
  capitalMode: string;
  currentPosition: OpenPositionAnalytics | null;
  currentPnl: number;
  todayPnl: number;
  totalPnl: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  cancelledTrades: number;
  winRate: number;
  lastTrade: ClosedTradeSummary | null;
  lastAnalysisAt: string | null;
  lastExecutionAt: string | null;
  lastError: string | null;
  lastActivity: ActivityEntry | null;
  recoveryState: "RECOVERING" | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveOrderAnalytics {
  id: number;
  executionId: number;
  botId: number;
  botName: string;
  symbol: string;
  side: "BUY" | "SELL";
  kind: "ENTRY" | "TAKE_PROFIT" | "STOP_LOSS";
  orderType: string;
  price: number | null;
  triggerPrice: number | null;
  quantity: number | null;
  status: string | null;
  exchangeOrderId: string | null;
  createdAt: string;
}

export interface TradeStatistics {
  totalTrades: number;
  longTrades: number;
  shortTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  cancelledTrades: number;
  winRate: number;
  averageProfit: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  averageTradePnl: number;
  averageTradeDurationMs: number;
  profitFactor: number | null;
  expectancy: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  grossProfit: number;
  grossLoss: number;
  totalFees: number;
}

/** Result of a closed trade. Only WIN and LOSS count toward the win rate. */
export type TradeOutcome = "WIN" | "LOSS" | "BREAKEVEN" | "CANCELLED";

export const ALL_TRADE_OUTCOMES: TradeOutcome[] = ["WIN", "LOSS", "BREAKEVEN", "CANCELLED"];

/** Counts + PnL + share for a single outcome status. */
export interface TradeOutcomeStat {
  status: TradeOutcome;
  count: number;
  pnl: number;
  /** Share of all closed trades, percent. */
  rate: number;
}

/** Full breakdown of closed trades by outcome. */
export interface OutcomeAnalytics {
  total: number;
  /** Number of trades that resolved to a win or loss. */
  resolvedTrades: number;
  /** Wins / (wins + losses) * 100. Cancelled and breakeven trades are excluded. */
  winRate: number;
  statuses: TradeOutcomeStat[];
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
  drawdownPct: number;
}

export interface EquityAnalytics {
  startingEquity: number;
  currentEquity: number;
  peakEquity: number;
  currentDrawdownPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  points: EquityPoint[];
}

export interface PnlPoint {
  timestamp: number;
  realized: number;
  unrealized: number;
  total: number;
  cumulative: number;
}

export interface PnlAnalytics {
  granularity: "daily" | "weekly" | "monthly";
  realizedTotal: number;
  unrealizedTotal: number;
  cumulativeTotal: number;
  points: PnlPoint[];
}

export interface SymbolPerformance {
  symbol: string;
  trades: number;
  longTrades: number;
  shortTrades: number;
  pnl: number;
  winRate: number;
  averagePnl: number;
  fees: number;
}

export interface StrategyPerformance {
  strategy: string;
  bots: number;
  trades: number;
  pnl: number;
  winRate: number;
  maxDrawdownPct: number;
  profitFactor: number | null;
  averageTrade: number;
  fees: number;
}

export interface ExitReasonStat {
  reason: string;
  count: number;
  pnl: number;
  winRate: number;
  averagePnl: number;
}

export interface TrailingAnalytics {
  trailingMovements: number;
  trailingClosedTrades: number;
  averageMfePct: number;
  averagePnl: number;
  profitProtected: number;
}

export interface TpSlAnalytics {
  tpHits: number;
  slHits: number;
  trailingHits: number;
  tpPct: number;
  slPct: number;
  trailingPct: number;
  averageTpPnl: number;
  averageSlPnl: number;
  averageTrailingPnl: number;
  trailing: TrailingAnalytics;
}

export interface ExitAnalytics {
  reasons: ExitReasonStat[];
  tpSl: TpSlAnalytics;
}

export interface ActivityEntry {
  id: number;
  type: string;
  botId: number | null;
  botName: string | null;
  symbol: string | null;
  message: string;
  severity: "INFO" | "WARNING" | "ERROR";
  timestamp: string;
}

export interface ActivityFeed {
  items: ActivityEntry[];
  total: number;
}

// ---------------------------------------------------------------------------
// Backtest DTOs
// ---------------------------------------------------------------------------

export interface BacktestSummary {
  id: number;
  botId: number | null;
  symbol: string;
  timeframe: string;
  startTime: number;
  endTime: number;
  initialCapital: number;
  finalBalance: number | null;
  status: BacktestStatus;
  totalReturnPct: number | null;
  totalPnl: number | null;
  winRate: number | null;
  maxDrawdownPct: number | null;
  profitFactor: number | null;
  tradeCount: number | null;
  executionPolicy: string | null;
  slippageApplied: boolean;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface BacktestDetail extends BacktestSummary {
  config: BacktestConfig | null;
  metrics: BacktestMetrics | null;
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
}

/** Normalized exit-reason vocabulary shared by live and backtest analytics. */
export const EXIT_REASON_CATEGORIES = [
  "TAKE_PROFIT",
  "STOP_LOSS",
  "TRAILING_STOP",
  "MANUAL_CLOSE",
  "EXCHANGE_CLOSE",
  "END_OF_BACKTEST",
  "OTHER",
] as const;

export type ExitReasonCategory = (typeof EXIT_REASON_CATEGORIES)[number];

export function normalizeExitReason(reason: string | null | undefined, trailingActivated = false): ExitReasonCategory {
  const normalized = String(reason ?? "").toUpperCase();
  switch (normalized) {
    case "TAKE_PROFIT":
      return "TAKE_PROFIT";
    case "STOP_LOSS":
      // A stop-loss close on a position whose trailing stop had activated was
      // closed by the trailing mechanism (the stop had been moved into profit).
      return trailingActivated ? "TRAILING_STOP" : "STOP_LOSS";
    case "TRAILING_STOP":
      return "TRAILING_STOP";
    case "MANUAL_CLOSE":
    case "MANUAL":
      return "MANUAL_CLOSE";
    case "EXCHANGE_CLOSE":
    case "LIQUIDATION":
      return "EXCHANGE_CLOSE";
    case "END_OF_BACKTEST":
      return "END_OF_BACKTEST";
    default:
      return "OTHER";
  }
}

/** Exit reasons that mean the trade never produced a real outcome. */
const NO_RESULT_EXITS = new Set(["ENTRY_CANCELLED", "EXPIRED", "ERROR"]);

export function isNoResultExit(reason: string | null | undefined): boolean {
  return NO_RESULT_EXITS.has(String(reason ?? "").toUpperCase());
}

/**
 * Classify a closed trade by result. Trades that never produced a real outcome
 * (cancelled/expired/error) are "CANCELLED" and never count toward the win rate.
 */
export function classifyOutcome(exitReason: string | null | undefined, pnl: number): TradeOutcome {
  if (isNoResultExit(exitReason)) return "CANCELLED";
  if (pnl > 0) return "WIN";
  if (pnl < 0) return "LOSS";
  return "BREAKEVEN";
}

export { ExitReason as LiveExitReason };
