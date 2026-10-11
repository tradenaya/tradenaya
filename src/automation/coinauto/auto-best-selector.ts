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
import { closedCandles } from "@/automation/indicators/candle-resampler";
import { passesMomentumFilter } from "@/automation/strategy/tradenaya/momentum-filter";
import { TREND_BREAKOUT_ID } from "@/automation/strategy/catalog";
import { STOP_ATR, analyzeBreakout } from "@/automation/strategy/trend-breakout";
import {
  LEVERAGE_UNSAFE,
  resolveLeverage,
  type InstrumentInfo,
} from "@/automation/coinauto/leverage";

/**
 * "Major coins only" universe: the large, liquid coins the Trend Breakout
 * strategy was tested on. Auto-select scans only these when the bot's
 * coinUniverse is MAJORS (otherwise: top coins by 24h volume).
 */
export const MAJOR_COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT"];

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

/** Why scanned coins did not become candidates — feeds the readable "idle" log line. */
export interface AutoScanSummary {
  timeframe: string;
  scanned: number;
  /** Coins whose strategy found no long/short setup (or below the minimum score). */
  noSetup: number;
  /** Setups skipped by the strong-momentum filter. */
  momentumFiltered: number;
  /** Coins with stale/missing market data or a failed fetch. */
  dataUnavailable: number;
  /** Setups with no liquidation-safe leverage. */
  leverageUnsafe: number;
  /** Set when the scan could not run at all (keys, ticker). */
  error?: string;
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
    const ranked = await this.selectRankedOpportunities(userId, config, 1);
    return ranked[0] ?? null;
  }

  /**
   * Ranked, leverage-safe opportunities (best first), at most `limit`. Lets the
   * analysis cycle fall through to the next coin when the top one fails a
   * later check (planner R:R, exchange minimum, risk) instead of re-selecting
   * the same rejected coin every cycle until its candles change.
   */
  async selectRankedOpportunities(
    userId: number,
    config: AutomationConfig,
    limit = AUTO_SELECTION_UNIVERSE_SIZE,
  ): Promise<AutoBestOpportunity[]> {
    return (await this.scanRanked(userId, config, limit)).ranked;
  }

  /** Ranked opportunities plus a summary of why the other coins were not picked. */
  async scanRanked(
    userId: number,
    config: AutomationConfig,
    limit = AUTO_SELECTION_UNIVERSE_SIZE,
  ): Promise<{ ranked: AutoBestOpportunity[]; summary: AutoScanSummary }> {
    const picked: AutoBestOpportunity[] = [];
    const summary: AutoScanSummary = { timeframe: config.timeframe, scanned: 0, noSetup: 0, momentumFiltered: 0, dataUnavailable: 0, leverageUnsafe: 0 };
    const done = () => ({ ranked: picked, summary });
    console.log(`[AUTO BEST] START userId=${userId}`);
    const keys = await getKeysForUser(userId);
    console.log(`[AUTO BEST] keys userId=${userId} status=${keys?.status ?? "missing"}`);
    if (!keys || keys.status !== "A") {
      summary.error = "CoinSwitch API keys are missing or inactive";
      return done();
    }

    console.log(`[AUTO BEST] TICKERS_FETCH_START userId=${userId}`);
    const fetchCoins =
      this.deps.fetchEligibleCoins ??
      ((apiKey: string, apiSecret: string) => fetchEligibleCoins(apiKey, apiSecret));
    let eligible: EligibleCoin[];
    try {
      eligible = await fetchCoins(keys.apiKey, keys.apiSecret);
    } catch (error) {
      console.error(`[AUTO BEST] TICKERS_FETCH_FAILED userId=${userId}`, error);
      summary.error = "could not load the coin list from CoinSwitch";
      return done();
    }
    console.log(`[AUTO BEST] TICKERS_FETCH_END count=${eligible.length}`);
    if (eligible.length === 0) {
      console.log(`[AUTO BEST] COMPLETE symbol=none reason=empty-universe`);
      summary.error = "CoinSwitch returned no tradable coins";
      return done();
    }

    const universe = (
      config.coinUniverse === "MAJORS" ? eligible.filter((c) => MAJOR_COINS.includes(c.symbol.toUpperCase())) : eligible
    ).slice(0, AUTO_SELECTION_UNIVERSE_SIZE);
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
      async (coin) =>
        config.strategy === TREND_BREAKOUT_ID
          ? this.scanBreakout(coin, adapter, timeframe, candlesKey, summary)
          : this.scanOne(coin, adapter, timeframe, candlesKey, Boolean(config.momentumEntriesOnly), summary),
    );
    summary.scanned = universe.length;
    const scanned = scannedResults.filter((s): s is ScannedOpportunity => s !== null);
    console.log(`[AUTO BEST] SCANNED count=${scanned.length} of=${universe.length}`);
    if (scanned.length === 0) {
      console.log(`[AUTO BEST] COMPLETE symbol=none reason=no-eligible-opportunity`);
      return done();
    }

    // Rank by side-specific strategy score, then liquidity. Coins whose
    // leverage is unsafe are skipped; the first `limit` safe ones are returned.
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
        summary.leverageUnsafe += 1;
        continue;
      }

      picked.push({
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
      });
      if (picked.length >= limit) break;
    }

    console.log(
      picked.length > 0
        ? `[AUTO BEST] COMPLETE ranked=${picked.map((p) => p.symbol).join(",")}`
        : `[AUTO BEST] COMPLETE symbol=none reason=no-safe-leverage`,
    );
    return done();
  }

  /**
   * Trend Breakout scan for one symbol: a coin qualifies only when its last
   * closed candle breaks the 20-candle range with the 200-EMA trend. Ranked by
   * how far the close cleared the range (in ATRs). Failures are isolated.
   */
  private async scanBreakout(
    coin: EligibleCoin,
    adapter: { getSnapshot(symbol: string, timeframe: string): Promise<MarketSnapshot> },
    timeframe: string,
    candlesKey: string,
    summary?: AutoScanSummary,
  ): Promise<ScannedOpportunity | null> {
    try {
      const snapshot = await adapter.getSnapshot(coin.symbol, timeframe);
      if (snapshot.isFresh === "STALE" || snapshot.isFresh === "UNAVAILABLE") {
        if (summary) summary.dataUnavailable += 1;
        return null;
      }
      const candles = closedCandles(
        snapshot.candles[timeframe] ?? snapshot.candles[candlesKey] ?? Object.values(snapshot.candles ?? {})[0] ?? [],
        normalizeInterval(timeframe),
      );
      const result = analyzeBreakout(candles);
      console.log(`[AUTO BEST] BREAKOUT symbol=${coin.symbol} signal=${result?.signal ?? "none"} strength=${result?.strength?.toFixed(2) ?? "n/a"}`);
      if (!result || !result.signal || result.atr == null) {
        if (summary) summary.noSetup += 1;
        return null;
      }
      const side = result.signal === "BUY" ? "LONG" : "SHORT";
      const score = Math.round(Math.min(100, 50 + result.strength * 25));
      // The leverage resolver estimates the stop as ~1.35 ATR; this strategy's
      // stop is STOP_ATR ATRs, so scale the volatility it sees to match.
      const atrPct = (result.atr / result.close) * 100 * (STOP_ATR / 1.35);
      const zero = { regime: 0, trend: 0, structure: 0, momentum: 0, participation: 0, volatility: 0, entryLocation: 0, riskReward: 0, flow: 0 };
      const opportunity: CoinOpportunity = {
        symbol: coin.symbol,
        timeframe,
        price: result.close,
        signal: result.signal,
        side,
        confidence: 0.7,
        score,
        trend: side === "LONG" ? "UP" : "DOWN",
        regime: side === "LONG" ? "UP" : "DOWN",
        factors: zero as CoinOpportunityFactors,
        vetoes: [],
        reasons: [side === "LONG" ? "breakout-up" : "breakout-down"],
        reasonsText: `${side === "LONG" ? "Upside" : "Downside"} breakout with the 200-EMA trend`,
        atrPct,
        rsi: null,
        adx: null,
        volumeRatio: null,
        netScore: score,
        longNetScore: side === "LONG" ? score : 0,
        shortNetScore: side === "SHORT" ? score : 0,
        entryZone: result.close,
        tradable: true,
        quoteVolume24h: coin.quoteVolume24h,
      };
      return { coin, opportunity, side, strategyScore: score };
    } catch (error) {
      console.error(`[AUTO BEST] breakout scan failed symbol=${coin?.symbol ?? "unknown"}`, error);
      if (summary) summary.dataUnavailable += 1;
      return null;
    }
  }

  /** Fetch one symbol's snapshot and run the strategy. Failures are isolated. */
  private async scanOne(
    coin: EligibleCoin,
    adapter: { getSnapshot(symbol: string, timeframe: string): Promise<MarketSnapshot> },
    timeframe: string,
    candlesKey: string,
    momentumEntriesOnly = false,
    summary?: AutoScanSummary,
  ): Promise<ScannedOpportunity | null> {
    try {
      console.log(`[AUTO BEST] SNAPSHOT_START symbol=${coin.symbol}`);
      const snapshot = await adapter.getSnapshot(coin.symbol, timeframe);
      console.log(
        `[AUTO BEST] SNAPSHOT_END symbol=${coin.symbol} fresh=${snapshot.isFresh}`,
      );
      if (snapshot.isFresh === "STALE" || snapshot.isFresh === "UNAVAILABLE") {
        if (summary) summary.dataUnavailable += 1;
        return null;
      }

      const candles = closedCandles(
        snapshot.candles[timeframe] ??
          snapshot.candles[candlesKey] ??
          Object.values(snapshot.candles ?? {})[0] ??
          [],
        normalizeInterval(timeframe),
      );

      const opportunity = scanCandles(coin.symbol, timeframe, candles, {
        quoteVolume24h: coin.quoteVolume24h,
      });
      const tradable = Boolean(opportunity?.tradable && opportunity?.side);
      console.log(
        `[AUTO BEST] SCAN symbol=${coin.symbol} tradable=${tradable} score=${opportunity?.score ?? "n/a"}`,
      );
      // Reject opportunities that are not tradable or have no valid side.
      if (!opportunity || !opportunity.tradable || !opportunity.side) {
        if (summary) summary.noSetup += 1;
        return null;
      }

      const side = opportunity.side;
      const strategyScore =
        side === "LONG" ? opportunity.longNetScore : opportunity.shortNetScore;
      if (!(strategyScore >= TRADENAYA_CONFIG.thresholds.minNetScore)) {
        if (summary) summary.noSetup += 1;
        return null;
      }
      // Same gate the engine applies, so the selector never picks a coin the
      // engine would then reject while another coin qualifies.
      if (momentumEntriesOnly && !passesMomentumFilter(side, opportunity.rsi)) {
        if (summary) summary.momentumFiltered += 1;
        return null;
      }

      return { coin, opportunity, side, strategyScore };
    } catch (error) {
      console.error(`[AUTO BEST] per-symbol scan failed symbol=${coin?.symbol ?? "unknown"}`, error);
      if (summary) summary.dataUnavailable += 1;
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
