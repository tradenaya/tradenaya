import type { MarketCandle } from "@/automation/types";

export interface AggregatedTrade {
  symbol: string;
  price: number;
  size: number;
  time: number;
}

/**
 * Folds a stream of price updates (ticks/trades) into in-progress candles.
 *
 * The WS candle feed is authoritative; this is a fallback so that when the
 * exchange is slow to emit a candle we can still serve a live "current" candle
 * built from the ticker price. Bounded memory — at most one in-progress candle
 * per (symbol, interval).
 */
type StoredCandle = Omit<MarketCandle, "timeframe">;

export class CandleAggregator {
  private current = new Map<string, StoredCandle>();

  private key(symbol: string, intervalMinutes: number): string {
    return `${symbol}_${intervalMinutes}`;
  }

  /**
   * Fold a price update. When the update starts a new interval period, the
   * just-closed candle is returned (so callers can publish it); otherwise null.
   */
  fold(trade: AggregatedTrade, intervalMinutes: number): MarketCandle | null {
    const key = this.key(trade.symbol, intervalMinutes);
    const intervalMs = intervalMinutes * 60_000;
    const bucket = Math.floor(trade.time / intervalMs) * intervalMs;

    const existing = this.current.get(key);
    if (existing && existing.timestamp === bucket) {
      const next = {
        ...existing,
        high: Math.max(existing.high, trade.price),
        low: Math.min(existing.low, trade.price),
        close: trade.price,
        volume: existing.volume + trade.size,
      };
      this.current.set(key, next);
      return null;
    }

    const closed = existing ? { ...existing, timeframe: String(intervalMinutes) } : null;
    this.current.set(key, {
      timestamp: bucket,
      open: trade.price,
      high: trade.price,
      low: trade.price,
      close: trade.price,
      volume: trade.size,
    });
    return closed;
  }

  /** Current in-progress candle, if any. */
  peek(symbol: string, intervalMinutes: number): MarketCandle | null {
    const existing = this.current.get(this.key(symbol, intervalMinutes));
    return existing ? { ...existing, timeframe: String(intervalMinutes) } : null;
  }

  clear(symbol?: string, intervalMinutes?: number): void {
    if (symbol === undefined) {
      this.current.clear();
      return;
    }
    if (intervalMinutes !== undefined) {
      this.current.delete(this.key(symbol, intervalMinutes));
    } else {
      const prefix = `${symbol}_`;
      for (const key of Array.from(this.current.keys())) {
        if (key.startsWith(prefix)) this.current.delete(key);
      }
    }
  }
}
