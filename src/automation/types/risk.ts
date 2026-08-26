export type CapitalMode = "fixed" | "percent";

export interface RiskConfig {
  capital: number;
  capitalMode: CapitalMode;
  walletPercent?: number;
  maxRiskPerTrade: number;
  dailyLossLimit: number;
  leverage: number;
  maxPositionSize?: number;
}

export interface RiskAssessment {
  allowed: boolean;
  reason?: string;
  positionSize: number;
  riskAmount: number;
  stopLossDistance: number;
  takeProfitDistance: number;
  riskReward: number;
}
