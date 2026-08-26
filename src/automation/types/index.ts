export * from "./market";
export * from "./strategy";
export * from "./risk";
export * from "./order";

export interface AutomationConfig {
  symbol: string;
  timeframe: string;
  leverage: number;
  capital: number;
  capitalMode: "fixed" | "percent";
  walletPercent?: number;
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
  /** ATR multiple a resting entry can drift past its limit before being cancelled. Default 2.5. */
  driftAtr?: number;
  /** Soft candle backstop (cancels in combination with another soft signal). Default 24. */
  maxCandles?: number;
  /** Absolute circuit-breaker so a resting order can never sit forever. Default 48. */
  hardCapCandles?: number;
  /** Ignore regime EMA flips smaller than this % when deciding trend direction. Default 0.3. */
  regimeTolerancePct?: number;
}
