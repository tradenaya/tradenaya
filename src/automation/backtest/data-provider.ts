import type { MarketCandle } from "@/automation/types";
import type { MarketDataRestClient } from "@/automation/market/rest-client";
import { normalizeInterval, normalizeSymbol } from "@/automation/market/normalizer";
import { BacktestError } from "./errors";
import type { DataQualityReport } from "./types";

export interface HistoricalCandlesRequest {
  symbol: string;
  timeframe: string;
  startTime: number;
  endTime: number;
}

export interface HistoricalMarketDataProvider {
  getCandles(request: HistoricalCandlesRequest): Promise<MarketCandle[]>;
}

export interface RestHistoricalDataProviderOptions {
  restClient: MarketDataRestClient;
  userId: number;
  /** Safety cap on the number of paged requests (default 2000). */
  maxPages?: number;
  pageSize?: number;
}

const DEFAULT_MAX_PAGES = 2000;
const DEFAULT_PAGE_SIZE = 100;

/**
 * Production historical data provider. Fetches candles through the Market Data
 * Service's REST client (never a second CoinSwitch client), paging backwards
 * in time until the requested range is covered. If the exchange cannot produce
 * candles for the full range a clear error is raised — no invented prices.
 */
export class RestHistoricalDataProvider implements HistoricalMarketDataProvider {
  private readonly maxPages: number;
  private readonly pageSize: number;

  constructor(private readonly options: RestHistoricalDataProviderOptions) {
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  async getCandles(request: HistoricalCandlesRequest): Promise<MarketCandle[]> {
    const symbol = normalizeSymbol(request.symbol);
    const intervalMs = this.intervalMs(request.timeframe);
    if (!intervalMs) throw new BacktestError(`Unsupported timeframe: ${request.timeframe}`, "INVALID_CONFIG");

    if (!(request.endTime > request.startTime)) {
      throw new BacktestError("Backtest end time must be after start time", "INVALID_CONFIG");
    }

    const pages: MarketCandle[][] = [];
    let cursorEnd = request.endTime;
    let progress = false;

    for (let page = 0; page < this.maxPages; page += 1) {
      const batch = await this.options.restClient.getHistoricalCandles(this.options.userId, symbol, request.timeframe, {
        startTime: request.startTime,
        endTime: cursorEnd,
        limit: this.pageSize,
      });

      if (batch.length === 0) break;

      const earliest = Math.min(...batch.map((c) => c.timestamp));
      pages.push(batch);
      progress = earliest < cursorEnd;

      if (earliest <= request.startTime) {
        progress = true;
        break;
      }

      const nextEnd = earliest - intervalMs;
      if (nextEnd >= cursorEnd) {
        // The exchange returned no older data despite the time hint (or the
        // exchange ignores time parameters). Stop to avoid an infinite loop.
        break;
      }
      cursorEnd = nextEnd;
    }

    const merged = this.merge(pages, symbol, intervalMs, request);

    if (merged.length === 0) {
      throw new BacktestError(
        `No historical candle data available for ${symbol} between ${new Date(request.startTime).toISOString()} and ${new Date(request.endTime).toISOString()}.`,
        "NO_DATA",
      );
    }

    const first = merged[0].timestamp;
    const lastClose = merged[merged.length - 1].timestamp + intervalMs;
    const toleranceMs = intervalMs * 1.5;

    if (!progress || first > request.startTime + toleranceMs) {
      throw new BacktestError(
        `Historical data for ${symbol} does not extend back to the requested start time (earliest candle ${new Date(first).toISOString()}).`,
        "DATA_UNAVAILABLE",
      );
    }

    if (lastClose < request.endTime - toleranceMs) {
      throw new BacktestError(
        `Historical data for ${symbol} does not reach the requested end time (last candle closes ${new Date(lastClose).toISOString()}).`,
        "DATA_UNAVAILABLE",
      );
    }

    return merged;
  }

  private intervalMs(timeframe: string): number | null {
    const minutes = normalizeInterval(timeframe);
    return minutes === null ? null : minutes * 60_000;
  }

  private merge(pages: MarketCandle[][], symbol: string, intervalMs: number, request: HistoricalCandlesRequest): MarketCandle[] {
    const byTimestamp = new Map<number, MarketCandle>();
    for (const page of pages) {
      for (const candle of page) {
        if (candle.timestamp < request.startTime) continue;
        if (candle.timestamp > request.endTime) continue;
        byTimestamp.set(candle.timestamp, candle);
      }
    }
    const sorted = Array.from(byTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp);
    // Normalize interval on every candle so consumers never see mismatched timeframes.
    return sorted.map((candle) => ({
      ...candle,
      timeframe: String(intervalMs / 60_000),
      symbol,
    }));
  }
}

export interface CandleQualityCheckOptions {
  /** Expected candle interval in milliseconds (for gap detection). */
  intervalMs: number;
}

/**
 * Validate historical candles before simulation. Detects missing/duplicate
 * candles, invalid OHLC, invalid timestamps, incorrect ordering and gaps, and
 * reports them in a DataQualityReport. Serious problems are flagged so the
 * caller can decide to refuse the backtest.
 */
export function validateCandleQuality(candles: MarketCandle[], options: CandleQualityCheckOptions): DataQualityReport {
  let duplicateCandles = 0;
  let invalidCandles = 0;
  let outOfOrder = 0;
  let gaps = 0;
  const gapDetails: DataQualityReport["gapDetails"] = [];
  const seen = new Set<number>();

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    if (!isValidCandle(candle)) {
      invalidCandles += 1;
      continue;
    }
    if (seen.has(candle.timestamp)) {
      duplicateCandles += 1;
      continue;
    }
    seen.add(candle.timestamp);

    if (i > 0 && candles[i - 1] && candle.timestamp < candles[i - 1].timestamp) {
      outOfOrder += 1;
      continue;
    }

    if (i > 0 && candles[i - 1]) {
      const expected = candles[i - 1].timestamp + options.intervalMs;
      if (candle.timestamp > expected) {
        const gapMs = candle.timestamp - expected;
        gaps += 1;
        if (gapDetails.length < 10) gapDetails.push({ at: candles[i - 1].timestamp, gapMs });
      }
    }
  }

  const first = candles.length > 0 ? Math.min(...candles.map((c) => c.timestamp)) : 0;
  const last = candles.length > 0 ? Math.max(...candles.map((c) => c.timestamp)) : 0;

  return {
    totalCandles: candles.length,
    startTime: first,
    endTime: last,
    missingCandles: gaps,
    duplicateCandles,
    invalidCandles,
    outOfOrder,
    gaps,
    gapDetails,
    seriousProblems: invalidCandles > 0 || duplicateCandles > 0 || outOfOrder > 0 || gaps > 0,
  };
}

function isValidCandle(candle: MarketCandle): boolean {
  if (!Number.isFinite(candle.timestamp) || candle.timestamp <= 0) return false;
  const prices = [candle.open, candle.high, candle.low, candle.close];
  if (prices.some((p) => !Number.isFinite(p) || p <= 0)) return false;
  if (candle.high < candle.low) return false;
  return true;
}
