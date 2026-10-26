export * from "./market";
export * from "./strategy";
export * from "./risk";
export * from "./order";

export interface AutomationConfig {
  symbol: string;
  timeframe: string;
  leverage: number;
  /** Auto-select the strongest current coin opportunity instead of a fixed symbol. */
  autoSelect?: boolean;
  /** Last selected direction for an auto-select bot (persisted each cycle). */
  side?: "LONG" | "SHORT";
  /** Leverage resolution mode when auto-select is active. */
  leverageMode?: "auto" | "manual";
  /** Manual leverage preference as a % of the selected coin's max leverage. */
  leveragePercent?: number;
  capital: number;
  capitalMode: "fixed" | "percent";
  walletPercent?: number;
  maxRiskPerTrade: number;
  dailyLossLimit: number;
  /**
   * SAFE (default): size each trade so a stop-loss hit loses at most
   * maxRiskPerTrade % of the allocated capital.
   * RISKY: use the WHOLE allocated capital as margin at the bot's leverage;
   * maxRiskPerTrade is not applied. Stop-loss, the liquidation-safety gate,
   * exchange minimums and the daily loss limit still apply.
   */
  riskStyle?: "SAFE" | "RISKY";
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
  /**
   * Only take entries whose momentum is already strong in the trade's
   * direction (RSI14 >= 80 for longs, <= 20 for shorts on the entry timeframe).
   * Fewer trades; off when absent so existing bots keep their behaviour.
   */
  momentumEntriesOnly?: boolean;
  /** Strategy id from automation/strategy/catalog (default: TradenayaSmartV1). */
  strategy?: string;
  /** LIVE (real CoinSwitch account, default) or PAPER (simulated account, real prices). Fixed at creation. */
  tradingMode?: "LIVE" | "PAPER";
  /** Auto-select scans: MAJORS (BTC, ETH, SOL, XRP, BNB, DOGE) or TOP_VOLUME (top 10 by 24h volume). */
  coinUniverse?: "MAJORS" | "TOP_VOLUME";
  /** User-assigned display name for this bot (optional). */
  name?: string;
}
