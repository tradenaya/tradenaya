import type { TradePlan } from "@/automation/planner/types";

export type RiskVerdict = "APPROVED" | "REJECTED";

export interface RiskManagerConfig {
  maxRiskPerTradePct: number;
  maxCapitalAllocationPct: number;
  minWalletBalance: number;
  maxLeverage: number;
  maxSimultaneousPositions: number;
  maxSimultaneousBots: number;
  dailyLossLimitPct: number;
  dailyTradeLimit: number;
  maxDrawdownPct: number;
  minRiskRewardRatio: number;
  tolerance?: number;
}

export const DEFAULT_RISK_CONFIG: RiskManagerConfig = {
  maxRiskPerTradePct: 1.5,
  maxCapitalAllocationPct: 25,
  minWalletBalance: 0,
  maxLeverage: 10,
  maxSimultaneousPositions: 5,
  maxSimultaneousBots: 5,
  dailyLossLimitPct: 5,
  dailyTradeLimit: 20,
  maxDrawdownPct: 15,
  minRiskRewardRatio: 2,
  tolerance: 1e-9,
};

export interface WalletInfo {
  balance: number;
  equity?: number;
  peakBalance?: number;
}

export interface CapitalSelection {
  mode: "fixed" | "percent";
  amount?: number;
  percent?: number;
  leverage: number;
}

export interface DailyStatistics {
  date: string;
  realizedPnl: number;
  tradeCount: number;
}

export interface OpenPositionSnapshot {
  symbol: string;
  positionId?: string;
  side: "LONG" | "SHORT";
  size: number;
  margin?: number;
  value?: number;
  unrealizedPnl?: number;
}

export interface OpenOrderSnapshot {
  orderId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  quantity: number;
  reduceOnly?: boolean;
}

export interface RiskManagerInput {
  config: Partial<RiskManagerConfig>;
  wallet: WalletInfo;
  capital: CapitalSelection;
  plan: TradePlan;
  openPositions: OpenPositionSnapshot[];
  openOrders: OpenOrderSnapshot[];
  daily: DailyStatistics;
  runningBots?: number;
}

export interface RiskCheckResult {
  name: string;
  passed: boolean;
  message: string;
}

export interface RiskDecision {
  approved: boolean;
  reason: string;
  positionSize: number;
  capitalUsed: number;
  leverage: number;
  expectedLoss: number;
  expectedProfit: number;
  riskPercentage: number;
  timestamp: string;
  checks?: RiskCheckResult[];
}
