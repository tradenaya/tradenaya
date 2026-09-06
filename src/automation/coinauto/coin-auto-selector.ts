import type { AutomationConfig } from "@/automation/types";
import type { CoinSwitchClient } from "@/automation/executor/client";
import type { MarketSnapshot } from "@/automation/types";
import { coinSwitchRequest } from "@/lib/coinswitch";
import { getKeysForUser } from "@/lib/coinswitch.store";
import { scanCandles, type CoinOpportunity } from "@/automation/opportunity/scanner";
import { normalizeInterval } from "@/automation/market/normalizer";

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
 * Fetch the exchange's full ticker for all-pairs and return the eligible
 * coins sorted by 24h quote volume (liquidity proxy). Mirrors the
 * analyze-coins route so the bot and the UI rank the same universe.
 */
export async function fetchEligibleCoins(
  apiKey: string,
  apiSecret: string,
  limit = 30,
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
    .slice(0, Math.max(5, Math.min(100, limit)));
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

/**
 * Resolve the effective leverage for a coin+config.
 *
 * MANUAL mode: selectedLeverage = maxLeverage × leveragePercent / 100,
 * rounded and clamped to the exchange's valid [min, max] range.
 *
 * AUTO mode: a volatility/risk-scaled fraction of the coin's max leverage.
 * The scaling is deterministic: it uses the strategy-lite info available at
 * selection time (opportunity volatility, trend strength, confidence, ATR)
 * plus the existing per-trade risk limit, and NEVER exceeds the exchange cap.
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

  const auto = clampLeverage(Math.round(effective), minLeverage, maxLeverage);
  // "Never choose unnecessarily tiny leverage when the coin supports a
  // reasonable higher one" — enforce a ~25% of max floor when max ≥ 4x.
  if (maxLeverage >= 4) {
    const floor = Math.max(minLeverage, Math.round(maxLeverage * 0.25));
    return Math.max(auto, floor);
  }
  return auto;
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
    await mapConcurrently(candidates, 4, async (candidate) => {
      try {
        const snapshot = await adapter.getSnapshot(candidate.symbol, timeframe);
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
    scanned.sort((a, b) => b.score - a.score);

    const best = scanned[0];
    const instrument = await this.deps.client.getInstrumentInfo(userId, best.symbol).catch(() => null);
    const leverage = resolveLeverage(config, instrument, best);

    return {
      symbol: best.symbol,
      side: best.side as "LONG" | "SHORT",
      instrument,
      opportunity: best,
      leverage,
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