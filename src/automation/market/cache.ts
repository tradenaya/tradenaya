import type { MarketCandle, MarketSnapshot } from "@/automation/types";
import type { DataFreshness, MarketTicker, MarketSubscription, SymbolData } from "./types";

export interface FreshnessThresholds {
  /** Ticker considered stale after no update for this long. */
  tickerStaleMs: number;
  /** Ticker considered unavailable after no update for this long. */
  tickerUnavailableMs: number;
  /** Latest candle considered fresh while its close time is within this many interval lengths. */
  candleFreshIntervalMultiplier: number;
  /** No candle data at all for this long → candles unavailable. */
  candleUnavailableMs: number;
}

export const DEFAULT_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
  tickerStaleMs: 10_000,
  tickerUnavailableMs: 60_000,
  candleFreshIntervalMultiplier: 3,
  candleUnavailableMs: 120_000,
};

export interface MarketDataCacheOptions {
  now?: () => number;
  freshness?: Partial<FreshnessThresholds>;
}

/**
 * Server-side cache for short-lived market data. Holds only the latest values
 * per symbol (bounded — no unbounded candle/history growth). The interface is
 * intentionally small so it can later be backed by Redis for multi-server
 * deployments without a rewrite of consumers.
 */
export class MarketDataCache {
  private readonly data = new Map<string, SymbolData>();
  private readonly subscriptions = new Map<string, MarketSubscription>();
  private readonly now: () => number;
  readonly freshness: FreshnessThresholds;

  constructor(options: MarketDataCacheOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.freshness = { ...DEFAULT_FRESHNESS_THRESHOLDS, ...options.freshness };
  }

  get nowMs(): number {
    return this.now();
  }

  // ---- ticker ----

  getTicker(symbol: string): MarketTicker | null {
    return this.data.get(symbol)?.ticker ?? null;
  }

  setTicker(symbol: string, ticker: MarketTicker): void {
    let entry = this.data.get(symbol);
    if (!entry) {
      entry = this.createSymbolData();
      this.data.set(symbol, entry);
    }
    entry.ticker = ticker;
    entry.lastUpdateAt = this.now();
    entry.staleSince = null;
    entry.freshness = "FRESH";
  }

  // ---- candles ----

  /** Replace the cached candles for a symbol/interval (authoritative REST history). */
  setCandles(symbol: string, interval: string, candles: MarketCandle[], maxPerInterval = 200): void {
    if (!Array.isArray(candles) || candles.length === 0) return;
    let entry = this.data.get(symbol);
    if (!entry) {
      entry = this.createSymbolData();
      this.data.set(symbol, entry);
    }
    entry.candles[interval] = this.mergeCandles([], candles, maxPerInterval);
    entry.candlesUpdatedAt[interval] = this.now();
    entry.lastUpdateAt = this.now();
  }

  /** Merge live candles into the cached history for a symbol/interval. */
  upsertCandles(symbol: string, interval: string, candles: MarketCandle[], maxPerInterval = 200): void {
    if (!Array.isArray(candles) || candles.length === 0) return;
    let entry = this.data.get(symbol);
    if (!entry) {
      entry = this.createSymbolData();
      this.data.set(symbol, entry);
    }
    const existing = entry.candles[interval] ?? [];
    entry.candles[interval] = this.mergeCandles(existing, candles, maxPerInterval);
    entry.candlesUpdatedAt[interval] = this.now();
    entry.lastUpdateAt = this.now();
  }

  private mergeCandles(existing: MarketCandle[], incoming: MarketCandle[], maxPerInterval: number): MarketCandle[] {
    const sorted = [...existing, ...incoming].sort((a, b) => a.timestamp - b.timestamp);
    const deduped: MarketCandle[] = [];
    for (const candle of sorted) {
      const last = deduped[deduped.length - 1];
      if (last && last.timestamp === candle.timestamp) {
        if (candle.close > last.close || candle.volume > last.volume) {
          deduped[deduped.length - 1] = candle;
        }
        continue;
      }
      deduped.push(candle);
    }
    return deduped.slice(-maxPerInterval);
  }

  getCandles(symbol: string, interval: string): MarketCandle[] {
    return this.data.get(symbol)?.candles[interval] ?? [];
  }

  // ---- snapshot ----

  getSnapshot(symbol: string): MarketSnapshot | null {
    return this.data.get(symbol)?.snapshot ?? null;
  }

  setSnapshot(symbol: string, snapshot: MarketSnapshot): void {
    let entry = this.data.get(symbol);
    if (!entry) {
      entry = this.createSymbolData();
      this.data.set(symbol, entry);
    }
    entry.snapshot = snapshot;
    entry.snapshotUpdatedAt = this.now();
    entry.lastUpdateAt = this.now();
    entry.staleSince = null;
    entry.freshness = "FRESH";
  }

  // ---- freshness ----

  /** Freshness of the real-time ticker for a symbol. */
  freshnessOf(symbol: string): DataFreshness {
    const entry = this.data.get(symbol);
    if (!entry || !entry.ticker) return "UNAVAILABLE";
    const age = this.now() - entry.ticker.receivedAt;
    if (age <= this.freshness.tickerStaleMs) return "FRESH";
    if (age <= this.freshness.tickerUnavailableMs) return "STALE";
    return "UNAVAILABLE";
  }

  /** Freshness of the latest candle for a symbol/interval. */
  candleFreshness(symbol: string, interval: string): DataFreshness {
    const entry = this.data.get(symbol);
    const candles = entry?.candles[interval];
    const lastCandle = candles && candles.length > 0 ? candles[candles.length - 1] : null;
    if (!lastCandle) return "UNAVAILABLE";

    const intervalMs = Number(interval) * 60_000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return "UNAVAILABLE";

    const closeAge = this.now() - (lastCandle.timestamp + intervalMs);
    if (closeAge <= intervalMs * this.freshness.candleFreshIntervalMultiplier) return "FRESH";
    return "STALE";
  }

  markStale(symbol: string): void {
    const entry = this.data.get(symbol);
    if (!entry) return;
    entry.freshness = "STALE";
    entry.staleSince = entry.staleSince ?? this.now();
  }

  markUnavailable(symbol: string): void {
    const entry = this.data.get(symbol);
    if (!entry) return;
    entry.freshness = "UNAVAILABLE";
    entry.staleSince = entry.staleSince ?? this.now();
  }

  // ---- subscriptions ----

  getSubscription(symbol: string): MarketSubscription | null {
    return this.subscriptions.get(symbol) ?? null;
  }

  getSubscriptions(): MarketSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  addConsumer(symbol: string, consumerId: string): MarketSubscription {
    const existing = this.subscriptions.get(symbol);
    if (existing) {
      if (!existing.consumerIds.includes(consumerId)) {
        existing.consumerIds.push(consumerId);
      }
      return existing;
    }
    const subscription: MarketSubscription = {
      symbol,
      consumerIds: [consumerId],
      createdAt: this.now(),
      lastRefreshedAt: this.now(),
      websocketSubscribed: false,
    };
    this.subscriptions.set(symbol, subscription);
    return subscription;
  }

  removeConsumer(symbol: string, consumerId: string): boolean {
    const existing = this.subscriptions.get(symbol);
    if (!existing) return false;
    existing.consumerIds = existing.consumerIds.filter((id) => id !== consumerId);
    if (existing.consumerIds.length === 0) {
      this.subscriptions.delete(symbol);
      return true;
    }
    return false;
  }

  consumerCount(symbol: string): number {
    return this.subscriptions.get(symbol)?.consumerIds.length ?? 0;
  }

  getSymbols(): string[] {
    return Array.from(this.data.keys());
  }

  clear(): void {
    this.data.clear();
    this.subscriptions.clear();
  }

  private createSymbolData(): SymbolData {
    return {
      ticker: null,
      candles: {},
      candlesUpdatedAt: {},
      snapshot: null,
      snapshotUpdatedAt: null,
      lastUpdateAt: null,
      staleSince: null,
      freshness: "UNAVAILABLE",
    };
  }
}
