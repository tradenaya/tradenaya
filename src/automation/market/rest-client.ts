import { MarketDataError } from "./types";
import { normalizeSymbol, normalizeInterval, toApiInterval } from "./normalizer";
import { parseCandleRow, parseTickerRow } from "./validator";
import type { MarketCandle, MarketTicker } from "@/automation/types";

export interface HistoricalCandlesOptions {
  limit?: number;
  /** optional client-side filter */
  startTime?: number;
  endTime?: number;
}

export interface MarketDataRestClientOptions {
  now?: () => number;
  /** injectable client for tests */
  getTicker?: (userId: number, symbol: string) => Promise<unknown>;
  getKline?: (
    userId: number,
    symbol: string,
    interval: string,
    limit: number,
    options?: { startTime?: number; endTime?: number },
  ) => Promise<unknown>;
}

/**
 * Server-side REST client for market data. Mirrors the coinSwitchClient usage
 * in the existing controllers (coin-switch.controller.ts) but returns
 * validated, normalized types and never throws for a miss (returns null/[]).
 */
export class MarketDataRestClient {
  private readonly now: () => number;
  private readonly getTickerImpl?: (userId: number, symbol: string) => Promise<unknown>;
  private readonly getKlineImpl?: (
    userId: number,
    symbol: string,
    interval: string,
    limit: number,
    options?: { startTime?: number; endTime?: number },
  ) => Promise<unknown>;

  constructor(options: MarketDataRestClientOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.getTickerImpl = options.getTicker;
    this.getKlineImpl = options.getKline;
  }

  async getTicker(userId: number, symbol: string): Promise<MarketTicker | null> {
    const normalized = normalizeSymbol(symbol);
    try {
      const row = this.getTickerImpl
        ? await this.getTickerImpl(userId, normalized)
        : await this.fetchTicker(userId, normalized);
      return parseTickerRow(row as Record<string, unknown>, "rest", this.now());
    } catch {
      return null;
    }
  }

  async getHistoricalCandles(
    userId: number,
    symbol: string,
    timeframe: string,
    options: HistoricalCandlesOptions = {},
  ): Promise<MarketCandle[]> {
    const normalized = normalizeSymbol(symbol);
    const minutes = normalizeInterval(timeframe);
    if (minutes === null) {
      throw new MarketDataError(`Unsupported timeframe: ${timeframe}`, "INVALID_DATA");
    }
    const apiInterval = toApiInterval(minutes);
    if (apiInterval === null) {
      throw new MarketDataError(`Unsupported interval for REST: ${timeframe}`, "INVALID_DATA");
    }

    const limit = options.limit ?? 100;
    // Transient exchange failures can surface as an empty/unparseable response
    // while the cache still holds only the live candle. Retry once so a single
    // flake does not silently drop a valid symbol out of analysis.
    let candles: MarketCandle[] = [];
    for (let attempt = 0; attempt < 2 && candles.length === 0; attempt++) {
      candles = await this.fetchCandlesOnce(userId, normalized, apiInterval, limit, options);
    }

    if (options.startTime !== undefined || options.endTime !== undefined) {
      const start = options.startTime ?? -Infinity;
      const end = options.endTime ?? Infinity;
      return candles.filter((c) => c.timestamp >= start && c.timestamp <= end);
    }
    return candles;
  }

  private async fetchCandlesOnce(
    userId: number,
    symbol: string,
    apiInterval: string,
    limit: number,
    options: HistoricalCandlesOptions,
  ): Promise<MarketCandle[]> {
    try {
      const rows = this.getKlineImpl
        ? await this.getKlineImpl(userId, symbol, apiInterval, limit, {
            startTime: options.startTime,
            endTime: options.endTime,
          })
        : await this.fetchKline(userId, symbol, apiInterval, limit, {
            startTime: options.startTime,
            endTime: options.endTime,
          });
      if (!Array.isArray(rows)) return [];

      return rows
        .map((row) => parseCandleRow(row, apiInterval))
        .filter((c): c is MarketCandle => c !== null)
        .sort((a, b) => a.timestamp - b.timestamp);
    } catch {
      return [];
    }
  }

  private async fetchTicker(userId: number, symbol: string): Promise<unknown> {
    const { coinswitchClient } = await import("@/automation/executor/client");
    return coinswitchClient.getTicker(userId, symbol);
  }

  private async fetchKline(
    userId: number,
    symbol: string,
    interval: string,
    limit: number,
    options?: { startTime?: number; endTime?: number },
  ): Promise<unknown> {
    const { coinswitchClient } = await import("@/automation/executor/client");
    return coinswitchClient.getKline(userId, symbol, interval, limit, options);
  }
}
