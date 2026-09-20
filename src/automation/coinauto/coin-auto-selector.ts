import type { AutomationConfig } from "@/automation/types";
import type { CoinSwitchClient } from "@/automation/executor/client";
import type { MarketSnapshot } from "@/automation/types";
import { coinSwitchRequest } from "@/lib/coinswitch";
import { getKeysForUser } from "@/lib/coinswitch.store";
import { scanCandles, type CoinOpportunity } from "@/automation/opportunity/scanner";
import { TRADIAURA_CONFIG } from "@/automation/strategy/tradiaura/config";
import { normalizeInterval } from "@/automation/market/normalizer";
import {
  SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT,
  SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT,
} from "@/automation/risk/liquidation-safety";

export interface TickerRow {
  symbol?: string;
  last_price?: string;
  price_24h_pcnt?: string;
  quote_asset_volume_24h?: string;
  funding_rate?: string;
}

/** A candidate "eligible coin" surfaced from the exchange ticker, ranked by liquidity. */
export interface EligibleCoin {
  symbol: string;
  quoteVolume24h: number;
  change24h: number;
  fundingRate: number;
}

export interface SelectedOpportunity {
  symbol: string;
  side: "LONG" | "SHORT";
  instrument: InstrumentInfo | null;
  opportunity: CoinOpportunity;
  /** Effective leverage computed for this coin + config. */
  leverage: number;
}

export interface RankedOpportunityResult {
  /** Ranked candidate list (score descending) to try in order. */
  candidates: SelectedOpportunity[];
  /** Number of symbols fetched from the exchange ticker (before scanning). */
  fetchedCount: number;
  /** Number that produced a fresh snapshot and were scanned. */
  scannedCount: number;
  /** Number that emitted a tradable, directional opportunity. */
  eligibleCount: number;
  /** Human-readable description of the ranking criteria. */
  rankingCriteria: string;
  /** Trade count requested (per-scan candidate budget). */
  requestedCount: number;
}

export interface InstrumentLeverageRules {
  minLeverage: number;
  maxLeverage: number;
}

type InstrumentInfo = Record<string, unknown>;

const num = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Sentinel returned by `resolveLeverage` when NO leverage for the coin is
 * liquidation-safe (the safe maximum is below the exchange minimum). Callers
 * must treat this as "reject / WAIT" and never clamp leverage upward into an
 * unsafe range.
 */
export const LEVERAGE_UNSAFE = 0;

/**
 * Fetch the exchange's full ticker for all-pairs and return the eligible
 * coins sorted by 24h quote volume (liquidity proxy). Mirrors the
 * analyze-coins route so the bot and the UI rank the same universe.
 */
export async function fetchEligibleCoins(
  apiKey: string,
  apiSecret: string,
  // limit is intentionally ignored — return the full universe the exchange
  // provides and let the caller decide filtering/ranking. Passing a limit is
  // deprecated and will be ignored.
  _limit?: number,
): Promise<EligibleCoin[]> {
  const ticker = await coinSwitchRequest("/futures/all-pairs/ticker", "GET", apiKey, apiSecret, undefined, {
    exchange: "EXCHANGE_2",
  });
  const rows = (ticker.data ?? {}) as Record<string, TickerRow>;
  return Object.entries(rows)
    .map(([symbol, value]) => ({
      symbol,
      quoteVolume24h: num(value.quote_asset_volume_24h) ?? 0,
      change24h: num(value.price_24h_pcnt) ?? 0,
      fundingRate: num(value.funding_rate) ?? 0,
    }))
    .filter((c) => c.symbol.length >= 5 && c.quoteVolume24h > 0)
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
    // Do not truncate the fetched universe here. Return all eligible symbols
    // sorted by quote volume to let callers build a complete ranked list.
    ;
}

/** Extract a valid leverage number for a symbol from its instrument rules. */
export function leverageFromInstrument(
  instrument: InstrumentInfo | null,
  fallback = 1,
): InstrumentLeverageRules {
  const minL = Number(instrument?.min_leverage);
  const maxL = Number(instrument?.max_leverage);
  return {
    minLeverage: Number.isFinite(minL) && minL >= 1 ? Math.floor(minL) : 1,
    maxLeverage: Number.isFinite(maxL) && maxL >= 1 ? Math.floor(maxL) : Math.max(fallback, 1),
  };
}

/** Valid leverage increment for a symbol; the exchange enforces multiples of it. */
export function leverageStepOf(instrument: InstrumentInfo | null): number {
  const step = Number(instrument?.leverage_step);
  return Number.isFinite(step) && step >= 1 ? Math.floor(step) : 1;
}

/**
 * Per-symbol maintenance-margin rate (as a percent of notional) when the
 * exchange publishes it, otherwise the trusted system fallback constant from
 * the liquidation-safety module. Reuses the SAME constant the planner/executor
 * pre-entry gate uses so the leverage cap and the gate cannot disagree.
 */
export function maintenanceMarginPctOf(instrument: InstrumentInfo | null): number {
  const m = Number(instrument?.maint_margin_rate);
  if (Number.isFinite(m) && m > 0) return m;
  return SYSTEM_LIQUIDATION_MAINTENANCE_MARGIN_PCT;
}

/**
 * Worst-case stop distance (fraction of price) the planner can legally place.
 *
 * The planner (`DefaultStopLossPlanner`) clamps its stop between
 * [minDistance, maxDistance] where
 *   minDistance = max(atr*1.35, price*minStopDistancePct*1.01)
 *   maxDistance = max(price*maxStopDistancePct, minDistance)
 *
 * To guarantee the selected leverage is compatible with ANY planner SL we must
 * be conservative and assume the WIDEST stop the planner may produce; a wider
 * stop needs lower leverage to stay liquidation-safe.
 */
export function conservativeStopDistanceFraction(
  config: AutomationConfig,
  atrPct: number,
): number {
  const minStopDistancePct = Number(config.minStopDistancePct);
  const maxStopDistancePct = Number(config.maxStopDistancePct);
  const minStop =
    Number.isFinite(minStopDistancePct) && minStopDistancePct > 0 ? minStopDistancePct : 0.008;
  const maxStop =
    Number.isFinite(maxStopDistancePct) && maxStopDistancePct > 0 ? maxStopDistancePct : 0.05;
  const atrStop = (Math.max(0, atrPct) / 100) * 1.35;
  return Math.max(maxStop, atrStop, minStop * 1.01);
}

/**
 * Liquidation-safe leverage ceiling for AUTO selection. Rooted in the SAME
 * invariant enforced by the planner/executor liquidation-safety gate:
 *
 *   stopDistanceFraction + maintenanceMarginFraction + safetyBufferFraction < 1 / leverage
 *
 * so the largest safe integer leverage is
 *
 *   floor(1 / (stopDistanceFraction + maintenanceMarginFraction + safetyBufferFraction))
 *
 * This is an EARLIER optimization/cap for the auto-leverage resolver, NOT a
 * replacement for the planner/executor gates (those still run unconditionally).
 */
export function liquidationSafeMaxLeverage(
  config: AutomationConfig,
  opportunity: Pick<CoinOpportunity, "atrPct"> | null,
  maintenanceMarginPct: number,
): number | null {
  const atrPct = Number.isFinite(opportunity?.atrPct as number | undefined)
    ? Math.max(0, Number(opportunity?.atrPct) || 0)
    : 0;
  const stopDistanceFraction = conservativeStopDistanceFraction(config, atrPct);
  const maintenanceMarginFraction = maintenanceMarginPct / 100;
  const safetyBufferFraction = SYSTEM_LIQUIDATION_SAFETY_BUFFER_PCT / 100;
  const denominator = stopDistanceFraction + maintenanceMarginFraction + safetyBufferFraction;
  if (!(denominator > 0)) return null;
  return Math.floor(1 / denominator);
}

/**
 * Resolve the effective leverage for a coin+config.
 *
 * MANUAL mode: selectedLeverage = maxLeverage × leveragePercent / 100,
 * rounded and clamped to the exchange's valid [min, max] range.
 *
 * AUTO mode: a volatility/risk-scaled fraction of the coin's max leverage,
 * then capped by the liquidation-safe ceiling for the coin+stop distance.
 * The scaling is deterministic: it uses the strategy-lite info available at
 * selection time (opportunity volatility, trend strength, confidence, ATR)
 * plus the existing per-trade risk limit, and NEVER exceeds the exchange cap.
 *
 * The liquidation cap mirrors the mandatory planner/executor gate: it assumes
 * the widest stop the planner may place and uses the per-symbol maintenance
 * margin (or the trusted system fallback) plus the safety buffer. Leverage is
 * always rounded DOWN to a valid exchange step, never up. When even the
 * exchange minimum leverage would be unsafe, `LEVERAGE_UNSAFE` is returned and
 * the caller MUST reject/WAIT the trade.
 */
export function resolveLeverage(
  config: AutomationConfig,
  instrument: InstrumentInfo | null,
  opportunity: Pick<
    CoinOpportunity,
    "atrPct" | "confidence" | "trend" | "factors" | "score"
  > | null = null,
): number {
  const { minLeverage, maxLeverage } = leverageFromInstrument(instrument, config.leverage);

  // Manual percentage mapping — the user's preference travels with the coin.
  if (config.leverageMode === "manual") {
    const pct = Number(config.leveragePercent) || 0;
    if (pct <= 0) return clampLeverage(minLeverage, minLeverage, maxLeverage);
    const raw = maxLeverage * (pct / 100);
    return clampLeverage(Math.round(raw), minLeverage, maxLeverage);
  }

  // AUTO — pick a sensible fraction of max leverage for this coin given the
  // current setup. Base ratio starts high for liquid, low-vol coins and
  // shrinks as risk rises, but never drops below a floor that still lets the
  // bot trade meaningfully.
  const atrPct = Number.isFinite(opportunity?.atrPct as number | undefined)
    ? Math.max(0, Number(opportunity?.atrPct) || 0)
    : 0;
  const confidence = Number(opportunity?.confidence) || 0;
  const volFactor = opportunity?.factors?.volatility ?? 0;

  // Higher hourly ATR → more cautious leverage. 2%+ ATR is risky; <0.6% is calm.
  let riskRatio;
  if (atrPct >= 2) riskRatio = 0.25;
  else if (atrPct >= 1.2) riskRatio = 0.4;
  else if (atrPct >= 0.6) riskRatio = 0.6;
  else riskRatio = 0.8;

  // Scale down further when the local volatility factor is already elevated.
  const volAdjustment = 1 - clampLeverage(volFactor, 0, 1) * 0.35;
  // Confidence adds modest upside (strong setups can afford the higher side).
  const confidenceBoost = 1 + clampLeverage(confidence, 0, 1) * 0.25;

  const effective = maxLeverage * riskRatio * volAdjustment * confidenceBoost;

  // "Never choose unnecessarily tiny leverage when the coin supports a
  // reasonable higher one" — enforce a ~25% of max floor when max ≥ 4x.
  // This floor is a preference, NOT a hard bound: it can never lift leverage
  // above the liquidation-safe ceiling.
  const floor = maxLeverage >= 4 ? Math.max(minLeverage, Math.round(maxLeverage * 0.25)) : minLeverage;
  const desired = Math.max(effective, floor);

  // Liquidation-aware ceiling for THIS coin + stop distance, using the same
  // constants as the planner/executor liquidation-safety gate.
  const maintenanceMarginPct = maintenanceMarginPctOf(instrument);
  const maxSafe = liquidationSafeMaxLeverage(config, opportunity, maintenanceMarginPct);

  if (maxSafe == null || maxSafe < minLeverage) {
    // Even the exchange's minimum leverage is not liquidation-safe → the coin
    // cannot be traded at any valid leverage right now. Reject/WAIT rather
    // than clamping upward into an unsafe range.
    return LEVERAGE_UNSAFE;
  }

  const step = leverageStepOf(instrument);
  const capped = Math.min(Math.min(desired, maxLeverage), maxSafe);
  // Always round DOWN to a valid exchange step, never up.
  const stepped = Math.floor(capped / step) * step;
  // Honour the exchange minimum (already verified ≤ maxSafe above).
  const resolved = Math.max(stepped, minLeverage);
  if (resolved > maxSafe) return LEVERAGE_UNSAFE;
  return resolved;
}

function clampLeverage(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

async function mapConcurrently<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface CoinAutoSelectorDeps {
  client: CoinSwitchClient;
  /** Returns the per-user market data adapter (getSnapshot). */
  marketData: (userId: number) => {
    getSnapshot(symbol: string, timeframe: string): Promise<MarketSnapshot>;
  };
  /** Override for the candidate list provider (used in tests). */
  fetchEligibleCoins?: (
    apiKey: string,
    apiSecret: string,
    limit?: number,
  ) => Promise<EligibleCoin[]>;
}

/**
 * Server-side coin auto-selector. Runs the SAME scanning logic as the
 * analyze-coins route against the live market and picks the strongest current
 * tradable opportunity (LONG or SHORT) for a bot.
 *
 * The selection is deliberately NOT hardcoded and re-runs every analysis cycle,
 * which is what powers coin rotation after cancelled orders or closed positions.
 */
export class CoinAutoSelector {
  constructor(private readonly deps: CoinAutoSelectorDeps) {}

  async selectBestOpportunity(
    userId: number,
    config: AutomationConfig,
    options: { limit?: number } = {},
  ): Promise<SelectedOpportunity | null> {
        console.log(`[AUTO SELECTOR] selectBestOpportunity ENTER userId=${userId} limit=${options.limit ?? "n/a"}`);
    const ranked = await this.selectRankedOpportunities(userId, config, { limit: options.limit, count: 1 });
    return ranked?.candidates[0] ?? null;
  }

  /**
   * Scan the eligible symbol universe and return a RANKED list of candidates
   * (highest opportunity score first) instead of a single best coin. Cheap
   * eligibility filters run first (24h quote-volume ranking + fresh snapshot +
   * min-candles guard), then the full TradiAura factor stack runs only on the
   * remaining candidates, then the top-N by score are resolved to concrete
   * tradable specs (leverage recomputed per coin). This powers the "try
   * candidate #1, on failure try #2…" scanning loop in the analysis cycle.
   */
  async selectRankedOpportunities(
    userId: number,
    config: AutomationConfig,
    options: { limit?: number; count?: number } = {},
  ): Promise<RankedOpportunityResult | null> {
        console.log(`[AUTO SELECTOR] selectRankedOpportunities ENTER userId=${userId} limit=${options.limit ?? "n/a"} count=${options.count ?? "n/a"}`);
    const keys = await getKeysForUser(userId);
    if (!keys || keys.status !== "A") return null;

    const fetchCandidates =
      this.deps.fetchEligibleCoins ??
      ((apiKey: string, secret: string, limit?: number) => fetchEligibleCoins(apiKey, secret, limit));
    const candidates = await fetchCandidates(keys.apiKey, keys.apiSecret, options.limit ?? 30);
    if (candidates.length === 0) return null;

    const adapter = this.deps.marketData(userId);
    const timeframe = config.timeframe;
    const candlesKey =
      String(normalizeInterval(timeframe) ?? "") ||
      timeframe;

    const scanned: CoinOpportunity[] = [];
    let scannedCount = 0;
    await mapConcurrently(candidates, 4, async (candidate) => {
      try {
        const snapshot = await adapter.getSnapshot(candidate.symbol, timeframe);
        if (snapshot.isFresh === "STALE" || snapshot.isFresh === "UNAVAILABLE") {
          return;
        }
        scannedCount += 1;
        const candles =
          snapshot.candles[timeframe] ??
          snapshot.candles[candlesKey] ??
          Object.values(snapshot.candles ?? {})[0] ??
          [];
        const opportunity = scanCandles(candidate.symbol, timeframe, candles, {
          quoteVolume24h: candidate.quoteVolume24h,
        });
        if (opportunity && opportunity.tradable && opportunity.side) {
          scanned.push({
            ...opportunity,
            symbol: candidate.symbol,
            quoteVolume24h: candidate.quoteVolume24h,
            change24h: candidate.change24h,
            fundingRate: candidate.fundingRate,
          });
        }
      } catch {
        // A single coin's market data failing must not kill the whole scan.
      }
    });

    if (scanned.length === 0) return null;

    // Expand per-symbol opportunities into side-specific candidates so a
    // single symbol can produce both LONG and SHORT candidates. Use the
    // strategy's configured minimum net-score to decide which side(s) are
    // considered "valid" opportunities.
    const minNet = TRADIAURA_CONFIG.thresholds.minNetScore;
    const expanded: (CoinOpportunity & { sideToUse: "LONG" | "SHORT" })[] = [];
    for (const s of scanned) {
      if (s.longNetScore >= minNet) {
        expanded.push({ ...s, sideToUse: "LONG", score: s.longNetScore });
      }
      if (s.shortNetScore >= minNet) {
        expanded.push({ ...s, sideToUse: "SHORT", score: s.shortNetScore });
      }
    }

    if (expanded.length === 0) return null;

    // Rank all expanded opportunities by their side-specific score and liquidity.
    expanded.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0));

    const candidatesResolved: SelectedOpportunity[] = [];
    for (const best of expanded) {
      const instrument = await this.deps.client.getInstrumentInfo(userId, best.symbol).catch(() => null);
      // Use the side-specific candidate details: prefer the score & side we
      // computed above rather than the original opportunity.lead side.
      const opportunityForSide: CoinOpportunity = { ...best, side: best.sideToUse } as CoinOpportunity;
      const leverage = resolveLeverage(config, instrument, opportunityForSide);
      if (leverage === LEVERAGE_UNSAFE) {
        // No liquidation-safe leverage exists for this opportunity — skip this
        // candidate but keep evaluating the rest of the ranked list.
        continue;
      }
      candidatesResolved.push({
        symbol: best.symbol,
        side: best.sideToUse as "LONG" | "SHORT",
        instrument,
        opportunity: { ...best, side: best.sideToUse, score: best.score } as CoinOpportunity,
        leverage,
      });
    }

    if (candidatesResolved.length === 0) return null;

        console.log(`[AUTO SELECTOR] selectRankedOpportunities COMPLETE userId=${userId} resolved=${candidatesResolved.map((c) => c.symbol).join(",")}`);
    return {
      candidates: candidatesResolved,
      fetchedCount: candidates.length,
      scannedCount,
      eligibleCount: scanned.length,
      rankingCriteria: `${scanned.length} tradable, directional opportunities ranked by opportunity score (descending)`,
      requestedCount: options.count ?? 0,
    };
  }

  /**
   * Produce the effective AutomationConfig for this cycle when auto-select is
   * enabled: overrides symbol + leverage to the best current opportunity.
   */
  async resolveConfig(
    userId: number,
    config: AutomationConfig,
    options: { limit?: number } = {},
  ): Promise<{ config: AutomationConfig; opportunity: SelectedOpportunity } | null> {
    const selected = await this.selectBestOpportunity(userId, config, options);
    if (!selected) return null;
    return {
      config: { ...config, symbol: selected.symbol, leverage: selected.leverage },
      opportunity: selected,
    };
  }
}

// Convenience singleton wired to the shared client + market service.
// Imported lazily to avoid circular imports at module load time.
export function createCoinAutoSelector(
  client: CoinSwitchClient,
  marketData: CoinAutoSelectorDeps["marketData"],
): CoinAutoSelector {
  return new CoinAutoSelector({ client, marketData });
}