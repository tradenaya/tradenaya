import type { MarketCandle } from "@/automation/types";
import { clamp, lastValue } from "@/automation/indicators/series";
import { resampleCandles } from "@/automation/indicators/candle-resampler";
import { normalizeInterval } from "@/automation/market/normalizer";
import { buildMarketView } from "../strategy/tradiaura/factors";
import { runAnalysis } from "../strategy/tradiaura/scoring";
import { DEFAULT_ENTRY_TIMEFRAME, TIMEFRAME_MAP, TRADIAURA_CONFIG } from "../strategy/tradiaura/config";
import { humanizeReason } from "../strategy/tradiaura/humanize";

export interface CoinOpportunityFactors {
  regime: number;
  trend: number;
  structure: number;
  momentum: number;
  participation: number;
  volatility: number;
  entryLocation: number;
  riskReward: number;
}

export interface CoinOpportunity {
  symbol: string;
  timeframe: string;
  price: number;
  signal: "BUY" | "SELL" | "WAIT";
  side: "LONG" | "SHORT" | null;
  confidence: number;
  /** Multi-factor opportunity score 0-100 (higher = better setup to trade now). */
  score: number;
  trend: "UP" | "DOWN" | "SIDEWAYS";
  regime: "UP" | "DOWN" | "SIDEWAYS";
  factors: CoinOpportunityFactors;
  vetoes: string[];
  reasons: string[];
  reasonsText: string;
  atrPct: number | null;
  rsi: number | null;
  adx: number | null;
  volumeRatio: number | null;
  netScore: number;
  longNetScore: number;
  shortNetScore: number;
  entryZone?: number;
  stopLoss?: number;
  takeProfit?: number;
  tradable: boolean;
  /** Populated by the analyzer route from the 24h ticker (not part of the scan). */
  quoteVolume24h?: number;
  change24h?: number;
  fundingRate?: number;
}

export interface ScanOptions {
  /** 24h quote volume (USDT) — used as a liquidity input, not the only factor. */
  quoteVolume24h?: number;
}

/**
 * Opportunity weights — deliberately NOT volume-only. Volume (participation)
 * is one of eight factors and capped at 15% of the score so a quiet-but-trendy
 * coin is never buried, while an illiquid coin is still penalized.
 */
export const OPPORTUNITY_WEIGHTS: CoinOpportunityFactors = {
  regime: 0.05,
  trend: 0.2,
  structure: 0.15,
  momentum: 0.15,
  participation: 0.15,
  volatility: 0.05,
  entryLocation: 0.15,
  riskReward: 0.1,
};

const FACTOR_KEYS: (keyof CoinOpportunityFactors)[] = [
  "regime",
  "trend",
  "structure",
  "momentum",
  "participation",
  "volatility",
  "entryLocation",
  "riskReward",
];

const toFactor = (score: number): number => clamp(Number.isFinite(score) ? score : 0, 0, 1);

/** Map 24h quote volume (USDT) to a 0-1 liquidity score. $1M->0, $1B->1. */
function liquidityScore(quoteVolume24h: number | undefined): number {
  if (quoteVolume24h == null || !Number.isFinite(quoteVolume24h) || quoteVolume24h <= 0) return 0;
  return clamp((Math.log10(quoteVolume24h) - 6) / 3, 0, 1);
}

function toSignal(signal: "LONG_SIGNAL" | "SHORT_SIGNAL" | "NO_TRADE"): "BUY" | "SELL" | "WAIT" {
  if (signal === "LONG_SIGNAL") return "BUY";
  if (signal === "SHORT_SIGNAL") return "SELL";
  return "WAIT";
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Analyze a single symbol's candles with the full TradiAura factor stack and
 * produce a ranked "opportunity" record. Pure function of the candles (plus an
 * optional liquidity hint) — deterministic and safe to unit test.
 */
export function scanCandles(
  symbol: string,
  timeframe: string,
  candles: MarketCandle[],
  options: ScanOptions = {},
): CoinOpportunity | null {
  const thresholds = TRADIAURA_CONFIG.thresholds;
  if (!candles || candles.length < thresholds.minCandles) {
    return {
      symbol,
      timeframe,
      price: 0,
      signal: "WAIT",
      side: null,
      confidence: 0,
      score: 0,
      trend: "SIDEWAYS",
      regime: "SIDEWAYS",
      factors: { regime: 0, trend: 0, structure: 0, momentum: 0, participation: 0, volatility: 0, entryLocation: 0, riskReward: 0 },
      vetoes: [],
      reasons: ["not enough market data yet"],
      reasonsText: "not enough market data yet",
      atrPct: null,
      rsi: null,
      adx: null,
      volumeRatio: null,
      netScore: 0,
      longNetScore: 0,
      shortNetScore: 0,
      tradable: false,
    };
  }

  const entryLabel =
    TIMEFRAME_MAP[timeframe] ? timeframe : DEFAULT_ENTRY_TIMEFRAME;
  const entryMinutes = normalizeInterval(entryLabel);
  const timeframes = TIMEFRAME_MAP[entryLabel] ?? TIMEFRAME_MAP[DEFAULT_ENTRY_TIMEFRAME];

  const entryView = buildMarketView(candles, thresholds);

  const higherCandles =
    entryMinutes != null
      ? resampleCandles(candles, normalizeInterval(timeframes.higher) ?? entryMinutes, entryMinutes)
      : candles;
  const mediumCandles =
    timeframes.medium && entryMinutes != null
      ? resampleCandles(candles, normalizeInterval(timeframes.medium) ?? entryMinutes, entryMinutes)
      : [];

  const higherView = higherCandles.length > 0 ? buildMarketView(higherCandles, thresholds) : null;
  const mediumView = mediumCandles.length > 0 ? buildMarketView(mediumCandles, thresholds) : null;

  const analysis = runAnalysis(entryView, higherView, mediumView, TRADIAURA_CONFIG);

  const longValid = analysis.long.vetoes.length === 0 && analysis.long.netScore >= thresholds.minNetScore;
  const shortValid = analysis.short.vetoes.length === 0 && analysis.short.netScore >= thresholds.minNetScore;

  let lead = analysis.long;
  if (longValid && shortValid) {
    lead = analysis.long.netScore >= analysis.short.netScore ? analysis.long : analysis.short;
  } else if (longValid) {
    lead = analysis.long;
  } else if (shortValid) {
    lead = analysis.short;
  } else {
    // Neither side cleared the threshold — still rank by whichever side scores
    // higher so quiet markets can surface a direction to watch.
    lead = analysis.long.netScore >= analysis.short.netScore ? analysis.long : analysis.short;
  }

  const liquidity = liquidityScore(options.quoteVolume24h);

  let weighted = 0;
  for (const key of FACTOR_KEYS) {
    if (key === "participation") {
      const participation = toFactor(lead.factors.participation.score) * 0.6 + liquidity * 0.4;
      weighted += OPPORTUNITY_WEIGHTS.participation * participation;
    } else {
      weighted += OPPORTUNITY_WEIGHTS[key] * toFactor(lead.factors[key].score);
    }
  }
  const vetoPenalty = lead.vetoes.length > 0 ? Math.pow(0.8, lead.vetoes.length) : 1;
  const score = round1(clamp(weighted * vetoPenalty * 100, 0, 100));

  const reasons = [...new Set([...analysis.reasons, ...lead.vetoes])].map(humanizeReason);
  const volumes = entryView.volumes;
  const volumeAverage = lastValue(entryView.volumeAverage);
  const lastVolume = volumes.length > 0 ? volumes[volumes.length - 1] : null;
  const volumeRatio =
    volumeAverage != null && volumeAverage > 0 && lastVolume != null ? lastVolume / volumeAverage : null;

  const atrPct = entryView.price > 0 ? (entryView.atrValue / entryView.price) * 100 : null;
  const chosen = longValid || shortValid ? lead : null;

  return {
    symbol,
    timeframe: entryLabel,
    price: entryView.price,
    signal: toSignal(chosen ? (lead.side === "LONG" ? "LONG_SIGNAL" : "SHORT_SIGNAL") : "NO_TRADE"),
    side: chosen ? lead.side : null,
    confidence: chosen ? analysis.confidence : 0,
    score,
    trend: analysis.trend,
    regime: analysis.regime,
    factors: {
      regime: round1(lead.factors.regime.score),
      trend: round1(lead.factors.trend.score),
      structure: round1(lead.factors.structure.score),
      momentum: round1(lead.factors.momentum.score),
      participation: round1(lead.factors.participation.score),
      volatility: round1(lead.factors.volatility.score),
      entryLocation: round1(lead.factors.entryLocation.score),
      riskReward: round1(lead.factors.riskReward.score),
    },
    vetoes: lead.vetoes.map(humanizeReason),
    reasons,
    reasonsText: reasons.slice(0, 4).join(", "),
    atrPct: atrPct != null ? round1(atrPct) : null,
    rsi: lastValue(entryView.rsi) != null ? round1(lastValue(entryView.rsi)!) : null,
    adx: lastValue(entryView.adx) != null ? round1(lastValue(entryView.adx)!) : null,
    volumeRatio: volumeRatio != null ? round1(volumeRatio) : null,
    netScore: round1(analysis.netScore),
    longNetScore: round1(analysis.long.netScore),
    shortNetScore: round1(analysis.short.netScore),
    entryZone: analysis.entryZone != null ? round1(analysis.entryZone) : undefined,
    stopLoss: analysis.stopLossSuggestion != null ? round1(analysis.stopLossSuggestion) : undefined,
    takeProfit: analysis.takeProfitSuggestion != null ? round1(analysis.takeProfitSuggestion) : undefined,
    tradable: true,
  };
}
