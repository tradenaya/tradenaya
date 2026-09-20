import type { AutomationConfig, MarketSnapshot } from "@/automation/types";
import type { CoinSwitchClient } from "@/automation/executor/client";
import { coinSwitchRequest } from "@/lib/coinswitch";
import { getKeysForUser } from "@/lib/coinswitch.store";
import {
  scanCandles,
  type CoinOpportunity,
  type CoinOpportunityFactors,
} from "@/automation/opportunity/scanner";
import { TRADENAYA_CONFIG } from "@/automation/strategy/tradenaya/config";
import { normalizeInterval } from "@/automation/market/normalizer";
import {
  LEVERAGE_UNSAFE,
  resolveLeverage,
  type InstrumentInfo,
} from "@/automation/coinauto/leverage";

/** Only this many top-liquidity symbols are ever scanned for AUTO selection. */
export const AUTO_SELECTION_UNIVERSE_SIZE = 10;

/** Max in-flight snapshot requests while scanning the universe. */
const AUTO_SELECTION_CONCURRENCY = 4;

/** A single eligible coin surfaced from the exchange ticker, ranked by liquidity. */
export interface EligibleCoin {
  symbol: string;
  quoteVolume24h: number;
  change24h: number;
  fundingRate: number;
}

interface TickerRow {
  symbol?: string;
  last_price?: string;
  price_24h_pcnt?: string;
  quote_asset_volume_24h?: string;
  funding_rate?: string;
}

/**
 * The ONE best currently-tradable opportunity returned by the AUTO selector.
 * This is the entire public surface — never a ranked candidate list.
 */
export interface AutoBestOpportunity {
  symbol: string;
  side: "LONG" | "SHORT";
  /** Strategy net-score used to rank the opportunity (TRADENAYA threshold applied). */
  score: number;
  confidence: number;
  price: number;
  atrPct: number | null;
  trend: "UP" | "DOWN" | "SIDEWAYS";
  factors: CoinOpportunityFactors;
  leverage: number;
  instrument: InstrumentInfo | null;
}

export interface AutoBestSelectorDeps {
  client: CoinSwitchClient;
  /** Returns the per-user market data adapter (`getSnapshot`). */
  marketData: (userId: number) => {
    getSnapshot(symbol: string, timeframe: string): Promise<MarketSnapshot>;
  };
  /** Override for the ticker universe provider (used in tests). */
  fetchEligibleCoins?: (apiKey: string, apiSecret: string) => Promise<EligibleCoin[]>;
}

const num = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Fetch the exchange's full Futures ticker and return the eligible USDT pairs
 * sorted by 24h quote volume (liquidity proxy). Never truncates the returned
 * universe — the caller decides how many symbols to scan.
 */
export async function fetchEligibleCoins(
  apiKey: string,
  apiSecret: string,
): Promise<EligibleCoin[]> {
  const ticker = await coinSwitchRequest(
    "/futures/all-pairs/ticker",
    "GET",
    apiKey,
    apiSecret,
    undefined,
    { exchange: "EXCHANGE_2" },
  );

  const rawRows = ticker.data ?? {};
  const rows = Array.isArray(rawRows)
    ? rawRows.reduce<Record<string, TickerRow>>((acc, row) => {
        const candidate = (row ?? {}) as TickerRow;
        const symbol = typeof candidate.symbol === "string" ? candidate.symbol.trim() : "";
        if (!symbol) return acc;
        acc[symbol] = candidate;
        return acc;
      }, {})
    : ((rawRows as Record<string, TickerRow> | null) ?? {});

  return Object.entries(rows)
    .map(([symbol, value]) => {
      const row = (value ?? {}) as TickerRow;
      const normalizedSymbol =
        typeof symbol === "string"
          ? symbol.trim()
          : typeof row.symbol === "string"
            ? row.symbol.trim()
            : "";
      return {
        symbol: normalizedSymbol,
        quoteVolume24h: num(row.quote_asset_volume_24h) ?? 0,
        change24h: num(row.price_24h_pcnt) ?? 0,
        fundingRate: num(row.funding_rate) ?? 0,
      };
    })
    .filter((c) => c.symbol && c.symbol.length >= 5 && c.quoteVolume24h > 0)
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
}

/** Bounded-concurrency map that never fires an uncontrolled `Promise.all`. */
async function mapConcurrently<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        results[current] = await fn(items[current]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

interface ScannedOpportunity {
  coin: EligibleCoin;
  opportunity: CoinOpportunity;
  side: "LONG" | "SHORT";
  /** Side-specific strategy net-score used for ranking. */
  strategyScore: number;
}

export class AutoBestSelector {
  constructor(private readonly deps: AutoBestSelectorDeps) {}

  /**
   * Find the single best currently-tradable opportunity for a user.
   *
   * Scans at most `AUTO_SELECTION_UNIVERSE_SIZE` top-liquidity symbols, runs the
   * existing `scanCandles()` strategy on each, then resolves the instrument +
   * liquidation-safe leverage for the winning opportunity only (falling through
   * to the next-best already-scanned opportunity when the winner is unsafe).
   *
   * Returns exactly one opportunity, or null when nothing qualifies.
   */
  async selectBestOpportunity(
    userId: number,
    config: AutomationConfig,
  ): Promise<AutoBestOpportunity | null> {
    console.log(`[AUTO BEST] START userId=${userId}`);
    const keys = await getKeysForUser(userId);
    console.log(`[AUTO BEST] keys userId=${userId} status=${keys?.status ?? "missing"}`);
    if (!keys || keys.status !== "A") return null;

    console.log(`[AUTO BEST] TICKERS_FETCH_START userId=${userId}`);
    const fetchCoins =
      this.deps.fetchEligibleCoins ??
      ((apiKey: string, apiSecret: string) => fetchEligibleCoins(apiKey, apiSecret));
    let eligible: EligibleCoin[];
    try {
      eligible = await fetchCoins(keys.apiKey, keys.apiSecret);
    } catch (error) {
      console.error(`[AUTO BEST] TICKERS_FETCH_FAILED userId=${userId}`, error);
      return null;
    }
    console.log(`[AUTO BEST] TICKERS_FETCH_END count=${eligible.length}`);
    if (eligible.length === 0) {
      console.log(`[AUTO BEST] COMPLETE symbol=none reason=empty-universe`);
      return null;
    }

    const universe = eligible.slice(0, AUTO_SELECTION_UNIVERSE_SIZE);
    for (const coin of universe) {
      console.log(
        `[AUTO BEST] UNIVERSE symbol=${coin.symbol} quoteVolume24h=${coin.quoteVolume24h}`,
      );
    }

    const adapter = this.deps.marketData(userId);
    const timeframe = config.timeframe;
    const candlesKey = String(normalizeInterval(timeframe) ?? "") || timeframe;

    const scannedResults = await mapConcurrently(
      universe,
      AUTO_SELECTION_CONCURRENCY,
      async (coin) => this.scanOne(coin, adapter, timeframe, candlesKey),
    );
    const scanned = scannedResults.filter((s): s is ScannedOpportunity => s !== null);
    console.log(`[AUTO BEST] SCANNED count=${scanned.length} of=${universe.length}`);
    if (scanned.length === 0) {
      console.log(`[AUTO BEST] COMPLETE symbol=none reason=no-eligible-opportunity`);
      return null;
    }

    // Rank by side-specific strategy score, then liquidity. Only ONE result is
    // ever returned; the ordered list is used purely to fall through when the
    // top opportunity's leverage is unsafe.
    scanned.sort(
      (a, b) =>
        b.strategyScore - a.strategyScore ||
        b.coin.quoteVolume24h - a.coin.quoteVolume24h,
    );

    for (const candidate of scanned) {
      const { coin, opportunity, side, strategyScore } = candidate;
      console.log(
        `[AUTO BEST] BEST symbol=${coin.symbol} side=${side} score=${strategyScore}`,
      );
      console.log(`[AUTO BEST] INSTRUMENT_START symbol=${coin.symbol}`);
      let instrument: InstrumentInfo | null = null;
      try {
        instrument = await this.deps.client.getInstrumentInfo(userId, coin.symbol);
      } catch (error) {
        console.error(`[AUTO BEST] instrument lookup failed symbol=${coin.symbol}`, error);
        instrument = null;
      }
      console.log(`[AUTO BEST] INSTRUMENT_END symbol=${coin.symbol}`);

      const opportunityForSide: CoinOpportunity = { ...opportunity, side };
      const leverage = resolveLeverage(config, instrument, opportunityForSide);
      if (leverage === LEVERAGE_UNSAFE) {
        console.log(
          `[AUTO BEST] REJECT symbol=${coin.symbol} reason=leverage-unsafe`,
        );
        continue;
      }

      console.log(`[AUTO BEST] COMPLETE symbol=${coin.symbol}`);
      return {
        symbol: coin.symbol,
        side,
        score: strategyScore,
        confidence: opportunity.confidence,
        price: opportunity.price,
        atrPct: opportunity.atrPct,
        trend: opportunity.trend,
        factors: opportunity.factors,
        leverage,
        instrument,
      };
    }

    console.log(`[AUTO BEST] COMPLETE symbol=none reason=no-safe-leverage`);
    return null;
  }

  /** Fetch one symbol's snapshot and run the strategy. Failures are isolated. */
  private async scanOne(
    coin: EligibleCoin,
    adapter: { getSnapshot(symbol: string, timeframe: string): Promise<MarketSnapshot> },
    timeframe: string,
    candlesKey: string,
  ): Promise<ScannedOpportunity | null> {
    try {
      console.log(`[AUTO BEST] SNAPSHOT_START symbol=${coin.symbol}`);
      const snapshot = await adapter.getSnapshot(coin.symbol, timeframe);
      console.log(
        `[AUTO BEST] SNAPSHOT_END symbol=${coin.symbol} fresh=${snapshot.isFresh}`,
      );
      if (snapshot.isFresh === "STALE" || snapshot.isFresh === "UNAVAILABLE") {
        return null;
      }

      const candles =
        snapshot.candles[timeframe] ??
        snapshot.candles[candlesKey] ??
        Object.values(snapshot.candles ?? {})[0] ??
        [];

      const opportunity = scanCandles(coin.symbol, timeframe, candles, {
        quoteVolume24h: coin.quoteVolume24h,
      });
      const tradable = Boolean(opportunity?.tradable && opportunity?.side);
      console.log(
        `[AUTO BEST] SCAN symbol=${coin.symbol} tradable=${tradable} score=${opportunity?.score ?? "n/a"}`,
      );
      // Reject opportunities that are not tradable or have no valid side.
      if (!opportunity || !opportunity.tradable || !opportunity.side) return null;

      const side = opportunity.side;
      const strategyScore =
        side === "LONG" ? opportunity.longNetScore : opportunity.shortNetScore;
      if (!(strategyScore >= TRADENAYA_CONFIG.thresholds.minNetScore)) return null;

      return { coin, opportunity, side, strategyScore };
    } catch (error) {
      console.error(`[AUTO BEST] per-symbol scan failed symbol=${coin?.symbol ?? "unknown"}`, error);
      return null;
    }
  }
}

export function createAutoBestSelector(
  client: CoinSwitchClient,
  marketData: AutoBestSelectorDeps["marketData"],
): AutoBestSelector {
  return new AutoBestSelector({ client, marketData });
}
