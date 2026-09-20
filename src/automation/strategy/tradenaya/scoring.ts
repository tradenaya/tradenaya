import { clamp } from "@/automation/indicators/series";
import { REASON, type ReasonCode, type TradenayaConfig } from "./config";
import { humanizeFactor } from "./humanize";
import {
  evaluateEntryLocation,
  evaluateFlow,
  evaluateMomentum,
  evaluateParticipation,
  evaluateRegime,
  evaluateRiskReward,
  evaluateStructure,
  evaluateTrend,
  evaluateVolatility,
  type RegimeResult,
} from "./factors";
import type {
  FactorResult,
  MarketView,
  SideEvaluation,
  SideFactors,
  TradenayaAnalysis,
  TrendDirection,
} from "./types";

/**
 * Deterministic scoring for TRADENAYA_SMART_V1.
 *
 * Each side (LONG/SHORT) is evaluated independently. A side's net score is the
 * weighted sum of its factor contributions. Factors that are directional
 * (regime, trend, structure, momentum) contribute positively when they agree
 * with the tested side and negatively when they oppose it. Participation and
 * volatility are symmetric confirmation factors. Entry location and reward/risk
 * are computed specifically for the tested side.
 *
 * A side is blocked by a veto (opposing regime/trend, extreme RSI, dead volume,
 * or dangerously high volatility) regardless of its score, then must clear the
 * minimum net score. The strongest valid side wins; otherwise NO_TRADE.
 */

const FACTOR_ORDER: (keyof SideFactors)[] = [
  "regime",
  "trend",
  "structure",
  "momentum",
  "participation",
  "volatility",
  "entryLocation",
  "riskReward",
  "flow",
];

function evaluateSide(
  side: "LONG" | "SHORT",
  view: MarketView,
  regime: RegimeResult,
  config: TradenayaConfig,
  report?: (message: string, detail?: Record<string, unknown>) => void,
): SideEvaluation {
  const { thresholds, weights } = config;
  const vetoes: ReasonCode[] = [];
  const factors = {} as SideFactors;
  let netScore = 0;

  if (side === "LONG" && regime.direction === -1) vetoes.push(REASON.REGIME_VETO_LONG);
  if (side === "SHORT" && regime.direction === 1) vetoes.push(REASON.REGIME_VETO_SHORT);
  const regimeScore = side === "LONG" ? regime.direction : -regime.direction;
  factors.regime = { code: regime.code, score: regimeScore, magnitude: Math.abs(regime.direction) };
  netScore += weights.regime * regimeScore;
  report?.(`${side} · Regime: ${humanizeFactor(regime.code)}${regimeScore < 0 ? ` — vetoes ${side}` : ""}.`);

  const trend = evaluateTrend(view, thresholds);
  if (side === "LONG" && trend.score < -0.2) vetoes.push(REASON.TREND_VETO);
  if (side === "SHORT" && trend.score > 0.2) vetoes.push(REASON.TREND_VETO);
  const trendScore = side === "LONG" ? trend.score : -trend.score;
  factors.trend = { code: trend.code, score: trendScore, magnitude: Math.abs(trend.score) };
  netScore += weights.trend * trendScore;
  report?.(`${side} · Trend: ${humanizeFactor(trend.code)} (${round(trendScore)}).`);

  const structure = evaluateStructure(view);
  const structureScore = side === "LONG" ? structure.score : -structure.score;
  factors.structure = { code: structure.code, score: structureScore, magnitude: Math.abs(structure.score) };
  netScore += weights.structure * structureScore;
  report?.(`${side} · Structure: ${humanizeFactor(structure.code)} (${round(structureScore)}).`);

  const momentum = evaluateMomentum(view, thresholds);
  // A trend-following entry must not fight momentum: veto when the momentum
  // factor strongly opposes the tested side.
  if (side === "LONG" && momentum.score < -0.5) vetoes.push(REASON.MOMENTUM_VETO);
  if (side === "SHORT" && momentum.score > 0.5) vetoes.push(REASON.MOMENTUM_VETO);
  const momentumScore = side === "LONG" ? momentum.score : -momentum.score;
  factors.momentum = { code: momentum.code, score: momentumScore, magnitude: Math.abs(momentum.score) };
  netScore += weights.momentum * momentumScore;
  report?.(`${side} · Momentum: ${humanizeFactor(momentum.code)} (${round(momentumScore)}).`);

  const participation = evaluateParticipation(view, thresholds);
  if (participation.dead) vetoes.push(REASON.PARTICIPATION_VETO);
  factors.participation = { code: participation.code, score: participation.score, magnitude: participation.score };
  netScore += weights.participation * participation.score;
  report?.(`${side} · Volume: ${humanizeFactor(participation.code)} (${round(participation.score)}).`);

  const volatility = evaluateVolatility(view, thresholds);
  if (volatility.tooHigh) vetoes.push(REASON.VOLATILITY_VETO);
  factors.volatility = { code: volatility.code, score: volatility.score, magnitude: volatility.score };
  netScore += weights.volatility * volatility.score;
  report?.(`${side} · Volatility: ${humanizeFactor(volatility.code)} (${round(volatility.score)}).`);

  const entryLocation = evaluateEntryLocation(view, side, thresholds);
  factors.entryLocation = entryLocation;
  netScore += weights.entryLocation * entryLocation.score;
  report?.(`${side} · Entry location: ${humanizeFactor(entryLocation.code)} (${round(entryLocation.score)}).`);

  const riskReward = evaluateRiskReward(view, side, thresholds);
  factors.riskReward = riskReward;
  netScore += weights.riskReward * riskReward.score;
  report?.(`${side} · Risk/Reward: ${humanizeFactor(riskReward.code)} (${round(riskReward.score)}).`);

  const flow = evaluateFlow(view, thresholds);
  const flowScore = side === "LONG" ? flow.score : -flow.score;
  factors.flow = { code: flow.code, score: flowScore, magnitude: flow.magnitude };
  netScore += weights.flow * flowScore;
  report?.(`${side} · Flow: ${humanizeFactor(flow.code)} (${round(flowScore)}).`);

  report?.(`${side} net score: ${round(netScore)} (threshold ${thresholds.minNetScore}).`);
  return { side, netScore, factors, vetoes };
}

function confidenceFromScore(netScore: number, minNetScore: number): number {
  return clamp(0.55 + (netScore - minNetScore) * 0.5, 0.55, 0.92);
}

function trendDirection(view: MarketView, thresholds: TradenayaConfig["thresholds"]): TrendDirection {
  const score = evaluateTrend(view, thresholds).score;
  if (score > 0.05) return "UP";
  if (score < -0.05) return "DOWN";
  return "SIDEWAYS";
}

function buildSuggestions(
  chosen: SideEvaluation,
  view: MarketView,
  config: TradenayaConfig,
): { entryZone?: number; stopLossSuggestion?: number; takeProfitSuggestion?: number } {
  const { thresholds } = config;
  const price = view.price;
  const atr = view.atrValue;
  const riskReward = evaluateRiskReward(view, chosen.side, thresholds);
  const stop = riskReward.stop;
  const target = riskReward.target;
  const emaFast = last(view.emaFast);
  const { support, resistance } = view.levels;

  if (stop == null || target == null) return {};

  if (chosen.side === "LONG") {
    const entryZone = Math.min(price, Math.max(emaFast ?? support ?? price - atr, (support ?? price - 2 * atr) + 0.2 * atr));
    return { entryZone, stopLossSuggestion: stop, takeProfitSuggestion: target };
  }

  const entryZone = Math.max(price, Math.min(emaFast ?? resistance ?? price + atr, (resistance ?? price + 2 * atr) - 0.2 * atr));
  return { entryZone, stopLossSuggestion: stop, takeProfitSuggestion: target };
}

function last(series: (number | null)[]): number | null {
  return series.length > 0 ? series[series.length - 1] : null;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function collectReasons(chosen: SideEvaluation | null, config: TradenayaConfig): ReasonCode[] {
  if (!chosen) return [];
  const reasons = FACTOR_ORDER.map((key) => chosen.factors[key].code);
  if (chosen.vetoes.length === 0) {
    reasons.push(chosen.side === "LONG" ? REASON.SCORE_LONG : REASON.SCORE_SHORT);
  }
  return reasons;
}

/**
 * Combine the higher and medium timeframe regimes into one consensus. A flat
 * higher regime is flat. A disagreement between the two contexts downgrades to
 * a flat (mixed) regime so the strategy never trades against conflicting
 * higher-timeframe context.
 */
function resolveRegime(
  higherView: MarketView | null,
  mediumView: MarketView | null,
  thresholds: TradenayaConfig["thresholds"],
): RegimeResult {
  if (!higherView) return { direction: 0, code: REASON.REGIME_FLAT, htfEma: null };
  const higher = evaluateRegime(higherView, thresholds);
  if (!mediumView) return higher;
  const medium = evaluateRegime(mediumView, thresholds);
  if (higher.direction !== 0 && medium.direction !== 0 && higher.direction !== medium.direction) {
    return { direction: 0, code: REASON.REGIME_FLAT, htfEma: higher.htfEma };
  }
  return higher;
}

export function runAnalysis(
  entryView: MarketView,
  higherView: MarketView | null,
  mediumView: MarketView | null,
  config: TradenayaConfig,
  report?: (message: string, detail?: Record<string, unknown>) => void,
): TradenayaAnalysis {
  const regime = resolveRegime(higherView, mediumView, config.thresholds);
  report?.(`Higher timeframe regime: ${humanizeFactor(regime.code)}.`);
  const long = evaluateSide("LONG", entryView, regime, config, report);
  const short = evaluateSide("SHORT", entryView, regime, config, report);

  const longValid = long.vetoes.length === 0 && long.netScore >= config.thresholds.minNetScore;
  const shortValid = short.vetoes.length === 0 && short.netScore >= config.thresholds.minNetScore;

  let chosen: SideEvaluation | null = null;
  if (longValid && shortValid) {
    chosen = long.netScore >= short.netScore ? long : short;
  } else if (longValid) {
    chosen = long;
  } else if (shortValid) {
    chosen = short;
  }

  const signal = chosen ? (chosen.side === "LONG" ? "LONG_SIGNAL" : "SHORT_SIGNAL") : "NO_TRADE";
  const netScore = chosen ? (chosen.side === "LONG" ? chosen.netScore : -chosen.netScore) : 0;
  const confidence = chosen ? confidenceFromScore(chosen.netScore, config.thresholds.minNetScore) : 0;

  const regimeDirection: TrendDirection = regime.direction === 1 ? "UP" : regime.direction === -1 ? "DOWN" : "SIDEWAYS";

  const trend: TrendDirection = trendDirection(entryView, config.thresholds);
  const suggestions = chosen ? buildSuggestions(chosen, entryView, config) : {};
  const vetoes = chosen ? chosen.vetoes : [...long.vetoes, ...short.vetoes];

  return {
    signal,
    netScore,
    confidence,
    trend,
    regime: regimeDirection,
    long,
    short,
    reasons: collectReasons(chosen, config),
    vetoes,
    support: entryView.levels.support,
    resistance: entryView.levels.resistance,
    entryZone: suggestions.entryZone,
    stopLossSuggestion: suggestions.stopLossSuggestion,
    takeProfitSuggestion: suggestions.takeProfitSuggestion,
    indicators: {},
  };
}

export type { FactorResult };
