import type { MarketCandle } from "@/automation/types";
import type { BaseStrategy, StrategyContext, StrategyDecision, StrategySignal } from "@/automation/strategy/types";
import { normalizeInterval } from "@/automation/market/normalizer";
import { resampleCandles } from "@/automation/indicators/candle-resampler";
import { lastValue } from "@/automation/indicators/series";
import {
  DEFAULT_ENTRY_TIMEFRAME,
  REASON,
  TIMEFRAME_MAP,
  TRADIAURA_CONFIG,
  TRADIAURA_VERSION,
  type ReasonCode,
} from "./config";
import { buildMarketView, evaluateStructure, participationRatio } from "./factors";
import { runAnalysis } from "./scoring";
import type { TradiAuraAnalysis, TradiAuraSignal } from "./types";

/**
 * TRADIAURA_SMART_V1 — the core trading algorithm.
 *
 * A rule-based, multi-factor strategy combining market structure, trend and
 * momentum. It is strictly a decision engine: it returns LONG_SIGNAL /
 * SHORT_SIGNAL / NO_TRADE (mapped to the codebase's BUY / SELL / WAIT) and
 * proposes an entry zone, stop-loss and take-profit, but never places orders.
 *
 * Multi-timeframe: the higher (e.g. 15m) and medium (e.g. 1h) context candles
 * are derived deterministically from the entry candles by the candle resampler,
 * so live and backtest see identical higher-timeframe data with no look-ahead.
 *
 * Determinism: every factor and the scoring are pure functions of the candles;
 * there is no randomness, no wall-clock dependence and no user risk preference
 * involved in the signal.
 */
export class TradiAuraSmartV1Strategy implements BaseStrategy {
  name = "TradiAuraSmartV1";
  private readonly config = TRADIAURA_CONFIG;

  async analyze(context: StrategyContext): Promise<StrategyDecision> {
    const candles = context.candles;
    const thresholds = this.config.thresholds;
    const report = context.report;

    if (candles.length < thresholds.minCandles) {
      report?.(
        `Not enough data — ${candles.length} candles available, need ≥ ${thresholds.minCandles}.`,
        { candles: candles.length, needed: thresholds.minCandles },
      );
      return this.wait(
        `Insufficient data (${candles.length} candles; need at least ${thresholds.minCandles}).`,
        REASON.NOT_ENOUGH_DATA,
        context,
      );
    }

    const entryLabel = this.label(context.timeframe);
    const timeframes = TIMEFRAME_MAP[entryLabel] ?? TIMEFRAME_MAP[DEFAULT_ENTRY_TIMEFRAME];
    const entryMinutes = normalizeInterval(entryLabel);

    report?.(`Resampling ${entryLabel} candles into ${timeframes.higher} (higher)${timeframes.medium ? ` and ${timeframes.medium} (medium)` : ""} context.`);
    const higherCandles =
      context.higherTimeframeCandles ??
      (entryMinutes != null ? resampleCandles(candles, normalizeInterval(timeframes.higher) ?? entryMinutes, entryMinutes) : candles);
    const mediumCandles =
      context.mediumTimeframeCandles ??
      (timeframes.medium && entryMinutes != null
        ? resampleCandles(candles, normalizeInterval(timeframes.medium) ?? entryMinutes, entryMinutes)
        : []);

    report?.("Building market views — computing trend, structure, momentum and volatility from candles.");
    const entryView = buildMarketView(candles, thresholds);
    const higherView = higherCandles.length > 0 ? buildMarketView(higherCandles, thresholds) : null;
    const mediumView = mediumCandles.length > 0 ? buildMarketView(mediumCandles, thresholds) : null;

    report?.(
      `Entry: price ${round(entryView.price)} · RSI ${roundOpt(lastValue(entryView.rsi))} · ADX ${roundOpt(lastValue(entryView.adx))} · ATR% ${entryView.price > 0 ? round((entryView.atrValue / entryView.price) * 100) : null}`,
      { price: round(entryView.price), rsi: roundOpt(lastValue(entryView.rsi)), adx: roundOpt(lastValue(entryView.adx)) },
    );

    const analysis = runAnalysis(entryView, higherView, mediumView, this.config, report);
    return this.toDecision(analysis, entryView, entryLabel, timeframes.higher, timeframes.medium, context);
  }

  private toDecision(
    analysis: TradiAuraAnalysis,
    entryView: ReturnType<typeof buildMarketView>,
    entryLabel: string,
    higherLabel: string,
    mediumLabel: string | undefined,
    context: StrategyContext,
  ): StrategyDecision {
    const signal = toStrategySignal(analysis.signal);
    const reasons: ReasonCode[] = [...analysis.reasons, ...analysis.vetoes];
    if (reasons.length === 0) reasons.push(REASON.SCORE_NO_TRADE);

    const structure = evaluateStructure(entryView, this.config.thresholds);
    const indicators = this.buildIndicators(analysis, entryView, entryLabel, higherLabel, mediumLabel, structure);

    return {
      signal,
      confidence: analysis.confidence,
      trend: analysis.trend,
      reasons,
      indicators,
      entryZone: analysis.entryZone,
      stopLossSuggestion: analysis.stopLossSuggestion,
      takeProfitSuggestion: analysis.takeProfitSuggestion,
      timestamp: new Date().toISOString(),
    };
  }

  private buildIndicators(
    analysis: TradiAuraAnalysis,
    view: ReturnType<typeof buildMarketView>,
    entryLabel: string,
    higherLabel: string,
    mediumLabel: string | undefined,
    structure: { code: ReasonCode; score: number },
  ): Record<string, number | string | boolean | null | undefined> {
    const chosen = analysis.signal === "LONG_SIGNAL" ? analysis.long : analysis.signal === "SHORT_SIGNAL" ? analysis.short : null;
    const factorScore = (key: keyof typeof analysis.long.factors): number => {
      const f = chosen ? chosen.factors[key] : analysis.long.factors[key];
      return round(f.magnitude * Math.sign(f.score || 1));
    };

    const flags = structureFlags(structure.code);
    const volumeCurrent = view.volumes[view.volumes.length - 1];
    const volumeAverage = lastValue(view.volumeAverage);
    const participation = participationRatio(view, this.config.thresholds);

    return {
      version: TRADIAURA_VERSION,
      signal: analysis.signal,
      referencePrice: round(view.price),
      timeframe: entryLabel,
      higherTimeframe: higherLabel,
      mediumTimeframe: mediumLabel ?? null,

      ema20: roundOpt(lastValue(view.emaFast)),
      ema50: roundOpt(lastValue(view.emaMedium)),
      ema200: roundOpt(lastValue(view.emaSlow)),
      rsi: roundOpt(lastValue(view.rsi)),
      macd: roundOpt(lastValue(view.macd.macd)),
      macdSignal: roundOpt(lastValue(view.macd.signal)),
      macdHistogram: roundOpt(lastValue(view.macd.histogram)),
      adx: roundOpt(lastValue(view.adx)),
      atr: roundOpt(lastValue(view.atr)),
      atrPct: roundOpt(view.price > 0 ? (view.atrValue / view.price) * 100 : null),
      vwap: roundOpt(lastValue(view.vwap)),
      bollingerUpper: roundOpt(lastValue(view.bollinger.upper)),
      bollingerMiddle: roundOpt(lastValue(view.bollinger.middle)),
      bollingerLower: roundOpt(lastValue(view.bollinger.lower)),
      supertrend: roundOpt(lastValue(view.supertrend.value)),
      supertrendDirection: lastValue(view.supertrend.direction) ?? null,
      volumeCurrent: roundOpt(volumeCurrent),
      volumeAverage: roundOpt(volumeAverage),
      volumeRatio: participation.ratio != null ? round(participation.ratio) : null,

      support: roundOpt(view.levels.support),
      resistance: roundOpt(view.levels.resistance),
      regime: analysis.regime,
      marketStructure: structure.code,

      trendScore: factorScore("trend"),
      structureScore: factorScore("structure"),
      momentumScore: factorScore("momentum"),
      participationScore: factorScore("participation"),
      volatilityScore: factorScore("volatility"),
      entryLocationScore: factorScore("entryLocation"),
      riskRewardScore: factorScore("riskReward"),
      netScore: round(analysis.netScore),
      longNetScore: round(analysis.long.netScore),
      shortNetScore: round(analysis.short.netScore),

      breakout: flags.breakout,
      higherHighs: flags.higherHighs,
      higherLows: flags.higherLows,
      lowerHighs: flags.lowerHighs,
      lowerLows: flags.lowerLows,
    };
  }

  private wait(reason: string, code: ReasonCode, context: StrategyContext): StrategyDecision {
    return {
      signal: "WAIT",
      confidence: 0,
      trend: "SIDEWAYS",
      reasons: [code],
      indicators: { version: TRADIAURA_VERSION, signal: "NO_TRADE", reason },
      timestamp: new Date().toISOString(),
    };
  }

  private label(timeframe: string): string {
    const normalized = String(timeframe ?? "").trim().toLowerCase();
    if (TIMEFRAME_MAP[normalized]) return normalized;
    const minutes = normalizeInterval(normalized);
    if (minutes != null) {
      const found = Object.keys(TIMEFRAME_MAP).find((key) => normalizeInterval(key) === minutes);
      if (found) return found;
    }
    return DEFAULT_ENTRY_TIMEFRAME;
  }
}

function toStrategySignal(signal: TradiAuraSignal): StrategySignal {
  if (signal === "LONG_SIGNAL") return "BUY";
  if (signal === "SHORT_SIGNAL") return "SELL";
  return "WAIT";
}

function structureFlags(code: ReasonCode): {
  breakout: boolean;
  higherHighs: boolean;
  higherLows: boolean;
  lowerHighs: boolean;
  lowerLows: boolean;
} {
  if (code === REASON.STRUCTURE_HH_HL) return { breakout: false, higherHighs: true, higherLows: true, lowerHighs: false, lowerLows: false };
  if (code === REASON.STRUCTURE_LH_LL) return { breakout: false, higherHighs: false, higherLows: false, lowerHighs: true, lowerLows: true };
  if (code === REASON.STRUCTURE_BREAKOUT_UP) return { breakout: true, higherHighs: true, higherLows: false, lowerHighs: false, lowerLows: false };
  if (code === REASON.STRUCTURE_BREAKOUT_DOWN) return { breakout: true, higherHighs: false, higherLows: false, lowerHighs: true, lowerLows: true };
  return { breakout: false, higherHighs: false, higherLows: false, lowerHighs: false, lowerLows: false };
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function roundOpt(value: number | null | undefined): number | null | undefined {
  return value == null ? value : round(value);
}

export { TRADIAURA_CONFIG, TRADIAURA_VERSION };
export type { TradiAuraConfig } from "./config";
