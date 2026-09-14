import type { MarketCandle } from "@/automation/types";
import type { Series, MacdSeries, BollingerSeries, SupertrendSeries } from "@/automation/indicators/series";
import type { StochRsiSeries, KeltnerSeries, IchimokuSeries, AdxSeries } from "@/automation/indicators/rich";
import type { PatternSignal } from "@/automation/indicators/patterns";
import type { ReasonCode } from "./config";

export type TradiAuraSignal = "LONG_SIGNAL" | "SHORT_SIGNAL" | "NO_TRADE";

export type TrendDirection = "UP" | "DOWN" | "SIDEWAYS";

/**
 * A single factor's contribution.
 * `score` is signed: positive favors LONG, negative favors SHORT.
 */
export interface FactorResult {
  code: ReasonCode;
  score: number;
  /** Raw magnitude in [0, 1] for reporting (abs of score when applicable). */
  magnitude: number;
}

export interface SideFactors {
  regime: FactorResult;
  trend: FactorResult;
  structure: FactorResult;
  momentum: FactorResult;
  participation: FactorResult;
  volatility: FactorResult;
  entryLocation: FactorResult;
  riskReward: FactorResult;
  /** Volume-flow / trend-confirmation: OBV slope, MFI zone, CCI. */
  flow: FactorResult;
}

/** Per-side evaluation: signed net score (positive = this side is favored). */
export interface SideEvaluation {
  side: "LONG" | "SHORT";
  netScore: number;
  factors: SideFactors;
  vetoes: ReasonCode[];
}

export interface SupportResistanceLevels {
  support?: number;
  resistance?: number;
  /** Last confirmed swing high and low (raw prices). */
  swingHigh?: number;
  swingLow?: number;
}

export interface MarketView {
  candles: MarketCandle[];
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  emaFast: Series;
  emaMedium: Series;
  emaSlow: Series;
  rsi: Series;
  macd: MacdSeries;
  adx: Series;
  atr: Series;
  bollinger: BollingerSeries;
  supertrend: SupertrendSeries;
  vwap: Series;
  stochRsi: StochRsiSeries;
  keltner: KeltnerSeries;
  ichimoku: IchimokuSeries;
  psar: Series;
  cci: Series;
  mfi: Series;
  obv: Series;
  williamsR: Series;
  adxDetails: AdxSeries;
  roc14: Series;
  roc50: Series;
  volumeAverage: Series;
  swings: { highs: SwingPoint[]; lows: SwingPoint[] };
  levels: SupportResistanceLevels;
  /** Detected candlestick + chart patterns on the current candle. */
  patterns: PatternSignal[];
  price: number;
  atrValue: number;
}

export interface SwingPoint {
  index: number;
  price: number;
}

export interface TradiAuraAnalysis {
  signal: TradiAuraSignal;
  /** Signed net score of the chosen side (positive for LONG). */
  netScore: number;
  confidence: number;
  trend: TrendDirection;
  regime: TrendDirection;
  long: SideEvaluation;
  short: SideEvaluation;
  reasons: ReasonCode[];
  vetoes: ReasonCode[];
  support?: number;
  resistance?: number;
  entryZone?: number;
  stopLossSuggestion?: number;
  takeProfitSuggestion?: number;
  indicators: Record<string, number | string | boolean | null | undefined>;
}
