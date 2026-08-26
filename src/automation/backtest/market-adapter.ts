import type { MarketCandle, MarketSnapshot } from "@/automation/types";
import type { MarketDataService } from "@/automation/market/market-data-service";
import { normalizeInterval, normalizeSymbol } from "@/automation/market/normalizer";
import { BacktestError } from "./errors";

/**
 * A MarketDataService that serves a point-in-time slice of historical candles.
 *
 * The BacktestingEngine rewinds this adapter to a closed candle before every
 * strategy evaluation. getSnapshot therefore returns ONLY candles up to and
 * including the current simulation point, with the current price equal to the
 * just-closed candle's close — the exact information that would have been
 * available when a live strategy ran. This is the structural guarantee against
 * look-ahead bias: the strategy code can never observe future candles, highs,
 * lows, volume or indicators because they do not exist in the slice yet.
 */
export class HistoricalMarketDataAdapter implements MarketDataService {
  private candles: MarketCandle[] = [];
  /** Exclusive upper bound of the visible slice. */
  private sliceEnd = 0;
  private intervalKey: string | null = null;

  /** Position the simulation at `uptoExclusive` (candles [0, uptoExclusive) visible). */
  setSlice(candles: MarketCandle[], uptoExclusive: number): void {
    this.candles = candles;
    this.sliceEnd = Math.max(0, Math.min(uptoExclusive, candles.length));
    this.intervalKey = null;
  }

  async getSnapshot(symbol: string, timeframe: string): Promise<MarketSnapshot> {
    const normalized = normalizeSymbol(symbol);
    const slice = this.candles.slice(0, this.sliceEnd);
    const last = slice[slice.length - 1];
    if (!last) {
      throw new BacktestError(
        `No historical candles available at simulation point ${this.sliceEnd} for ${normalized}.`,
        "NO_DATA",
      );
    }

    const minutes = normalizeInterval(timeframe);
    const key = minutes !== null ? String(minutes) : timeframe;

    const candlesRecord: Record<string, MarketCandle[]> = { [key]: slice };
    if (key !== timeframe) candlesRecord[timeframe] = slice;

    return {
      symbol: normalized,
      exchange: "EXCHANGE_2",
      timestamp: last.timestamp,
      price: last.close,
      bid: last.close,
      ask: last.close,
      volume: last.volume,
      candles: candlesRecord,
      receivedAt: last.timestamp,
      dataSource: "cache",
      isFresh: "FRESH",
    };
  }
}
