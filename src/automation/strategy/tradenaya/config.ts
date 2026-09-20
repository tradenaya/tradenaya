/**
 * TRADENAYA_SMART_V1 — centralized configuration.
 *
 * Single source of truth for every threshold, weight and parameter the
 * strategy uses. Nothing is hard-coded inside the factor or scoring logic; the
 * strategy is fully determined by this configuration object (plus the candles),
 * which keeps live and backtest behaviour identical and makes the algorithm
 * reproducible and auditable.
 */
export const TRADENAYA_VERSION = "TRADENAYA_SMART_V1";

export interface TimeframeConfig {
  /** Regime/context timeframe (larger than the entry timeframe). */
  higher: string;
  /** Secondary context timeframe (larger than `higher`). Optional. */
  medium?: string;
}

/**
 * Regime timeframes per entry timeframe. `higher` is the trend/regime filter,
 * `medium` is an optional secondary confirmation. Higher-timeframe candles are
 * derived deterministically from the entry candles (see candle-resampler.ts).
 */
export const TIMEFRAME_MAP: Record<string, TimeframeConfig> = {
  "1m": { higher: "5m", medium: "15m" },
  "3m": { higher: "15m", medium: "30m" },
  "5m": { higher: "15m", medium: "1h" },
  "15m": { higher: "1h", medium: "4h" },
  "30m": { higher: "1h", medium: "4h" },
  "1h": { higher: "4h", medium: "1d" },
  "2h": { higher: "8h", medium: "1d" },
  "4h": { higher: "1d" },
  "6h": { higher: "1d" },
  "8h": { higher: "1d" },
  "12h": { higher: "1d" },
  "1d": { higher: "1d" },
};

/** Default entry timeframe used when a bot does not specify one. */
export const DEFAULT_ENTRY_TIMEFRAME = "5m";

export interface FactorWeights {
  regime: number;
  trend: number;
  structure: number;
  momentum: number;
  participation: number;
  volatility: number;
  entryLocation: number;
  riskReward: number;
  flow: number;
}

/** Relative importance of each factor. All weights sum to 1. */
export const FACTOR_WEIGHTS: FactorWeights = {
  regime: 0.05,
  trend: 0.2,
  structure: 0.175,
  momentum: 0.15,
  participation: 0.075,
  volatility: 0.05,
  entryLocation: 0.15,
  riskReward: 0.1,
  flow: 0.05,
};

export interface TradenayaThresholds {
  /** Minimum |net score| required to emit a LONG/SHORT signal. */
  minNetScore: number;
  /** Maximum |net score| (used to normalize confidence). */
  maxNetScore: number;
  /** Minimum number of closed candles required to evaluate at all. */
  minCandles: number;

  emaFast: number;
  emaMedium: number;
  emaSlow: number;
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  atrPeriod: number;
  adxPeriod: number;
  bollingerPeriod: number;
  bollingerMult: number;
  supertrendPeriod: number;
  supertrendMult: number;
  volumePeriod: number;

  /** Swing (fractal) lookback on each side. */
  swingLookback: number;
  /** How many recent candles to scan for support/resistance. */
  supportResistanceWindow: number;
  /** Cluster distance for support/resistance levels, in ATR multiples. */
  srClusterAtr: number;

  /** RSI below this -> momentum favors short; above -> favors long. */
  rsiNeutral: number;
  /** Above this the market is overbought and chasing is penalized. */
  rsiOverbought: number;
  /** Below this the market is oversold. */
  rsiOversold: number;

  /** ADX above this is a strong trend; below this the trend is weak. */
  adxStrong: number;
  adxWeak: number;

  /** ATR% band considered tradable. */
  atrPctMin: number;
  atrPctMax: number;
  atrPctIdealLow: number;
  atrPctIdealHigh: number;

  /** Volume ratio below this -> participation factor scores 0. */
  volumeMinRatio: number;
  /** Volume ratio at/above this -> participation factor is fully confirmed. */
  volumeIdealRatio: number;
  /** Volume ratio below this vetoes the trade. */
  volumeVetoRatio: number;

  /** Price further than this (in ATR) from EMA(medium) is "extended". */
  entryExtensionMaxAtr: number;
  /** Price within this (in ATR) of the pullback level is an ideal entry. */
  entryPullbackMaxAtr: number;

  /** Minimum reward/risk for the RR factor to score anything. */
  rrMin: number;
  /** Reward/risk at/above which the RR factor is fully satisfied. */
  rrIdeal: number;

  /** Multiplier applied to ATR when estimating stop distance. */
  stopAtrMult: number;
  /** Take-profit as a multiple of the stop distance when no structure level exists. */
  targetRMultiple: number;
  /** Minimum stop distance as a fraction of price (protects against ultra-tight stops). */
  minStopPct: number;
  /** Maximum stop distance as a fraction of price (keeps risk capped). */
  maxStopPct: number;
  /** Distance a stop sits beyond a structural swing, in ATR. */
  stopBeyondStructureAtr: number;

  /** MFI above this is overbought (flow favors the downside / long faded). */
  mfiOverbought: number;
  /** MFI below this is oversold (flow favors the upside). */
  mfiOversold: number;

  /** CCI above this is strong bullish flow. */
  cciBuy: number;
  /** CCI below this is strong bearish flow. */
  cciSell: number;
}

export const TRADENAYA_THRESHOLDS: TradenayaThresholds = {
  minNetScore: 0.4,
  maxNetScore: 1,
  minCandles: 60,

  emaFast: 20,
  emaMedium: 50,
  emaSlow: 200,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  atrPeriod: 14,
  adxPeriod: 14,
  bollingerPeriod: 20,
  bollingerMult: 2,
  supertrendPeriod: 10,
  supertrendMult: 3,
  volumePeriod: 20,

  swingLookback: 2,
  supportResistanceWindow: 40,
  srClusterAtr: 0.35,

  rsiNeutral: 50,
  rsiOverbought: 78,
  rsiOversold: 22,

  adxStrong: 25,
  adxWeak: 15,

  atrPctMin: 0.15,
  atrPctMax: 3,
  atrPctIdealLow: 0.3,
  atrPctIdealHigh: 2,

  volumeMinRatio: 0.8,
  volumeIdealRatio: 1.2,
  volumeVetoRatio: 0.5,

  entryExtensionMaxAtr: 1.5,
  entryPullbackMaxAtr: 1,

  rrMin: 1.5,
  rrIdeal: 2,
  stopAtrMult: 1.5,
  targetRMultiple: 2.5,

  minStopPct: 0.006,
  maxStopPct: 0.06,
  stopBeyondStructureAtr: 0.5,

  mfiOverbought: 80,
  mfiOversold: 20,

  cciBuy: 100,
  cciSell: -100,
};

export interface TradenayaConfig {
  version: string;
  thresholds: TradenayaThresholds;
  weights: FactorWeights;
}

export const TRADENAYA_CONFIG: TradenayaConfig = {
  version: TRADENAYA_VERSION,
  thresholds: TRADENAYA_THRESHOLDS,
  weights: FACTOR_WEIGHTS,
};

/** Stable, documented reason codes emitted by the strategy. */
export const REASON = {
  NOT_ENOUGH_DATA: "insufficient-data",
  REGIME_UP: "regime-htf-up",
  REGIME_DOWN: "regime-htf-down",
  REGIME_FLAT: "regime-htf-flat",
  REGIME_VETO_LONG: "regime-veto-long",
  REGIME_VETO_SHORT: "regime-veto-short",
  TREND_UP: "trend-up",
  TREND_DOWN: "trend-down",
  TREND_FLAT: "trend-flat",
  TREND_WEAK_ADX: "trend-weak-adx",
  TREND_VETO: "trend-veto",
  STRUCTURE_HH_HL: "structure-hh-hl",
  STRUCTURE_LH_LL: "structure-lh-ll",
  STRUCTURE_BREAKOUT_UP: "structure-breakout-up",
  STRUCTURE_BREAKOUT_DOWN: "structure-breakout-down",
  STRUCTURE_CONSOLIDATION: "structure-consolidation",
  MOMENTUM_RSI_UP: "momentum-rsi-up",
  MOMENTUM_RSI_DOWN: "momentum-rsi-down",
  MOMENTUM_RSI_NEUTRAL: "momentum-rsi-neutral",
  MOMENTUM_MACD_UP: "momentum-macd-up",
  MOMENTUM_MACD_DOWN: "momentum-macd-down",
  MOMENTUM_OVERBOUGHT: "momentum-overbought",
  MOMENTUM_OVERSOLD: "momentum-oversold",
  MOMENTUM_VETO: "momentum-veto",
  PARTICIPATION_CONFIRMED: "participation-volume-confirmed",
  PARTICIPATION_WEAK: "participation-volume-weak",
  PARTICIPATION_VETO: "participation-volume-veto",
  VOLATILITY_IDEAL: "volatility-ideal",
  VOLATILITY_HIGH: "volatility-high",
  VOLATILITY_LOW: "volatility-low",
  VOLATILITY_VETO: "volatility-veto",
  ENTRY_PULLBACK: "entry-location-pullback",
  ENTRY_BREAKOUT: "entry-location-breakout",
  ENTRY_EXTENDED: "entry-location-extended",
  RR_OK: "risk-reward-ok",
  RR_LOW: "risk-reward-low",
  FLOW_BULLISH: "flow-bullish",
  FLOW_BEARISH: "flow-bearish",
  FLOW_NEUTRAL: "flow-neutral",
  PATTERN_BULLISH: "pattern-bullish",
  PATTERN_BEARISH: "pattern-bearish",
  SCORE_LONG: "score-long",
  SCORE_SHORT: "score-short",
  SCORE_NO_TRADE: "score-no-trade",
} as const;

export type ReasonCode = (typeof REASON)[keyof typeof REASON];
