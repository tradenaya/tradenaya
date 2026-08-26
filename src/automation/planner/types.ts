import type { IndicatorBundle } from "@/automation/types/market";
import type { StrategyDecision } from "@/automation/strategy/types";

export type PlannerAction = "BUY" | "SELL" | "WAIT";
export type PlannerEntryType = "LIMIT" | "NONE";

export interface PlannerConfig {
  symbol: string;
  timeframe: string;
  capital: number;
  leverage: number;
  capitalMode: "fixed" | "percent";
  walletPercent?: number;
  minRiskRewardRatio?: number;
  minStopDistancePct?: number;
  maxStopDistancePct?: number;
  maxVolatilityPct?: number;
  minConfidence?: number;
  orderExpiryMinutes?: number;
}

export interface MarketStructureSnapshot {
  trend?: "UP" | "DOWN" | "SIDEWAYS";
  breakout?: boolean;
  higherHighs?: boolean;
  higherLows?: boolean;
  lowerHighs?: boolean;
  lowerLows?: boolean;
}

export interface SupportResistanceSnapshot {
  support?: number;
  resistance?: number;
}

export interface PlannerContext {
  strategyDecision: StrategyDecision;
  currentPrice: number;
  indicators: IndicatorBundle;
  marketStructure?: MarketStructureSnapshot;
  supportResistance?: SupportResistanceSnapshot;
  atr: number;
  config: PlannerConfig;
}

export interface TradePlan {
  action: PlannerAction;
  entryType: PlannerEntryType;
  limitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskRewardRatio: number | null;
  confidence: number;
  reason: string;
  expiryTime: string;
  symbol?: string;
  side?: PlannerAction;
  entryPrice?: number | null;
  leverage?: number;
}

export interface PlannerValidationResult {
  valid: boolean;
  reason: string;
  riskRewardRatio: number;
}
