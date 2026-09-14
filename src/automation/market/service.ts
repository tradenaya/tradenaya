import type { MarketCandle, MarketSnapshot } from "@/automation/types";
import { MarketDataCache } from "./cache";
import { CandleAggregator } from "./candle-aggregator";
import { MarketDataEventBus } from "./event-bus";
import { computeHealth } from "./health-monitor";
import { normalizeInterval, normalizeSymbol } from "./normalizer";
import { MarketDataRecovery } from "./recovery";
import { MarketDataRestClient } from "./rest-client";
import { MarketDataSocket } from "./socket";
import { MarketDataSubscriptionManager } from "./subscription-manager";
import type { MarketDataService } from "./market-data-service";
import type {
  ConnectionState,
  MarketDataEvent,
  MarketDataHealth,
  MarketDataSocketLike,
  MarketHealth,
  MarketSubscription,
  MarketTicker,
} from "./types";
import { parseCandleMessage, parseTickerPayload, validateSnapshot } from "./validator";
import type { DesiredBotStatus } from "@/automation/service/bot-lifecycle";

export interface ServerMarketDataServiceOptions {
  socket?: MarketDataSocketLike;
  restClient?: MarketDataRestClient;
  cache?: MarketDataCache;
  subscriptions?: MarketDataSubscriptionManager;
  events?: MarketDataEventBus;
  aggregator?: CandleAggregator;
  /** if provided, a single userId used as fallback for REST calls */
  defaultUserId?: number;
  /** enable periodic snapshot refresh (ms) */
  snapshotRefreshIntervalMs?: number;
  /** how long to keep a symbol subscribed after its last consumer leaves (ms) */
  unsubscribeGraceMs?: number;
}

/**
 * Server-side, real-time market data service.
 *
 * Owns the single WebSocket connection, validates every inbound payload,
 * maintains a bounded per-symbol cache, reference-counts subscriptions across
 * consumers, backfills from REST on cold starts / gaps and reports health so
 * the automation layer can refuse to trade on stale or missing data.
 *
 * Implements MarketDataService so it can be dropped in wherever the old
 * per-request CoinSwitchMarketDataService was used.
 */
export class ServerMarketDataService {
  readonly cache: MarketDataCache;
  readonly events: MarketDataEventBus;
  readonly subscriptions: MarketDataSubscriptionManager;
  private readonly socket: MarketDataSocketLike;
  private readonly restClient: MarketDataRestClient;
  private readonly aggregator: CandleAggregator;
  private readonly recovery: MarketDataRecovery;
  private readonly defaultUserId?: number;
  private readonly snapshotRefreshIntervalMs?: number;
  private readonly unsubscribeGraceMs: number;

  private connectionState: ConnectionState = "DISCONNECTED";
  private recovering = false;
  private started = false;
  private lastError: string | null = null;
  private connectedAt: number | null = null;
  private lastDisconnectAt: number | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  /** first-seen userId per symbol — used only for REST backfill */
  private readonly userIdsBySymbol = new Map<string, number>();
  /** candle intervals requested per symbol (for WS candle subscription) */
  private readonly candleIntervals = new Map<string, Set<string>>();

  constructor(options: ServerMarketDataServiceOptions = {}) {
    this.socket = options.socket ?? new MarketDataSocket();
    this.restClient = options.restClient ?? new MarketDataRestClient();
    this.cache = options.cache ?? new MarketDataCache();
    this.subscriptions = options.subscriptions ?? new MarketDataSubscriptionManager();
    this.events = options.events ?? new MarketDataEventBus();
    this.aggregator = options.aggregator ?? new CandleAggregator();
    this.defaultUserId = options.defaultUserId;
    this.snapshotRefreshIntervalMs = options.snapshotRefreshIntervalMs;
    this.unsubscribeGraceMs = options.unsubscribeGraceMs ?? 60_000;

    this.recovery = new MarketDataRecovery({
      botService: this.recoveryBotService,
      positionStore: this.recoveryPositionStore,
      subscribe: async (symbol) => {
        const userId = this.userIdFor(symbol);
        if (userId !== null) this.subscribe(userId, symbol, "recovery");
      },
      prime: async (symbol) => {
        const userId = this.userIdFor(symbol);
        if (userId !== null) await this.primeSymbol(userId, symbol);
      },
    });

    this.wireSocket();
  }

  // ---- lifecycle ----

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.seedUserIdsFromRecoverySources();
    this.socket.connect();
    await this.recovery.recover();
    if (this.snapshotRefreshIntervalMs && this.snapshotRefreshIntervalMs > 0) {
      this.refreshTimer = setInterval(
        () => void this.refreshAllSnapshots().catch((error) => console.error("MarketData: snapshot refresh failed", error)),
        this.snapshotRefreshIntervalMs,
      );
      if (typeof this.refreshTimer.unref === "function") this.refreshTimer.unref();
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.socket.close();
  }

  // ---- subscriptions ----

  /** Register a consumer for a symbol. Reuses an existing subscription if present. */
  subscribe(userId: number, symbol: string, consumerId: string): MarketSubscription {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) throw new Error(`Invalid symbol: ${symbol}`);

    if (userId > 0) this.userIdsBySymbol.set(normalized, userId);

    const subscription = this.subscriptions.subscribe(normalized, consumerId);
    const isNew = subscription.consumerIds.length === 1;

    this.socket.subscribe(normalized);
    this.ensureCandleInterval(normalized, this.defaultIntervalFor());

    if (isNew) {
      this.events.emit({ type: "SUBSCRIBED", symbol: normalized, timestamp: Date.now(), data: { consumerId, consumerCount: subscription.consumerIds.length } });
    } else {
      this.events.emit({ type: "DUPLICATE_SUBSCRIPTION_PREVENTED", symbol: normalized, timestamp: Date.now(), data: { consumerId } });
    }
    return subscription;
  }

  /** Remove a consumer. The WS subscription is released when the last consumer leaves. */
  unsubscribe(symbol: string, consumerId: string): void {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return;
    const released = this.subscriptions.unsubscribe(normalized, consumerId);
    this.events.emit({ type: "UNSUBSCRIBED", symbol: normalized, timestamp: Date.now(), data: { consumerId } });
    if (released) {
      // keep the network subscription briefly to avoid reconnect churn for
      // rapid re-subscribes; the socket dedupes anyway
      setTimeout(() => {
        if (!this.subscriptions.hasConsumers(normalized)) {
          this.socket.unsubscribe(normalized);
        }
      }, this.unsubscribeGraceMs);
    }
  }

  // ---- data access ----

  async getTicker(userId: number, symbol: string): Promise<MarketTicker | null> {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return null;

    const cached = this.cache.getTicker(normalized);
    const age = cached ? Date.now() - cached.receivedAt : Infinity;
    if (cached && age <= this.cache.freshness.tickerStaleMs) return cached;

    if (userId > 0) this.userIdsBySymbol.set(normalized, userId);
    const fresh = await this.restClient.getTicker(userId, normalized);
    if (fresh) {
      this.cache.setTicker(normalized, { ...fresh, source: "rest" });
      this.emit("SNAPSHOT_REFRESHED", normalized, { source: "rest" });
    }
    return fresh;
  }

  async getCandles(
    userId: number,
    symbol: string,
    timeframe: string,
    options: { startTime?: number; endTime?: number; limit?: number } = {},
  ): Promise<MarketCandle[]> {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return [];
    const minutes = normalizeInterval(timeframe);
    if (minutes === null) return [];

    if (userId > 0) this.userIdsBySymbol.set(normalized, userId);

    let candles = this.cache.getCandles(normalized, String(minutes));
    // Backfill whenever the cached series is missing OR stale: a count-only gate
    // lets old candles linger forever, re-selecting the same phantom coin.
    const needBackfill =
      candles.length < 2 ||
      this.cache.candleFreshness(normalized, String(minutes)) !== "FRESH" ||
      (options.startTime !== undefined && candles[0].timestamp > options.startTime);

    if (needBackfill) {
      const history = await this.restClient.getHistoricalCandles(userId, normalized, String(minutes), {
        startTime: options.startTime,
        endTime: options.endTime,
        limit: options.limit,
      });
      if (history.length > 0) {
        this.cache.setCandles(normalized, String(minutes), history);
        candles = this.cache.getCandles(normalized, String(minutes));
      }
    }

    // merge the live in-progress candle from the aggregator (WS price fallback)
    candles = this.mergeAggregatedCandle(normalized, minutes, candles);
    this.ensureCandleInterval(normalized, String(minutes));
    return candles;
  }

  async getSnapshot(userId: number, symbol: string, timeframe: string): Promise<MarketSnapshot> {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) throw new Error(`Invalid symbol: ${symbol}`);
    if (userId > 0) this.userIdsBySymbol.set(normalized, userId);

    let ticker = this.cache.getTicker(normalized);
    const tickerAge = ticker ? Date.now() - ticker.receivedAt : Infinity;
    if (!ticker || tickerAge > this.cache.freshness.tickerStaleMs) {
      const restTicker = await this.restClient.getTicker(userId, normalized);
      if (restTicker) {
        ticker = { ...restTicker, source: "rest" };
        this.cache.setTicker(normalized, ticker);
      }
    }

    const candles = await this.getCandles(userId, normalized, timeframe);

    const minutes = normalizeInterval(timeframe);
    const interval = minutes !== null ? String(minutes) : timeframe;
    const candleFreshness = this.cache.candleFreshness(normalized, interval);
    const tickerFreshness = this.cache.freshnessOf(normalized);

    let isFresh: "FRESH" | "STALE" | "UNAVAILABLE";
    if (tickerFreshness === "UNAVAILABLE" || candleFreshness === "UNAVAILABLE") isFresh = "UNAVAILABLE";
    else if (tickerFreshness === "STALE" || candleFreshness === "STALE") isFresh = "STALE";
    else isFresh = "FRESH";

    const snapshot: MarketSnapshot = {
      symbol: normalized,
      exchange: "EXCHANGE_2",
      timestamp: Date.now(),
      price: ticker?.lastPrice ?? 0,
      bid: ticker?.bidPrice ?? 0,
      ask: ticker?.askPrice ?? 0,
      volume: ticker?.volume24h ?? 0,
      candles: { [interval]: candles },
      high24h: ticker?.high24h ?? undefined,
      low24h: ticker?.low24h ?? undefined,
      volume24h: ticker?.quoteVolume24h ?? undefined,
      exchangeTimestamp: ticker?.exchangeTimestamp ?? undefined,
      receivedAt: Date.now(),
      dataSource: ticker?.source ?? "rest",
      isFresh,
    };

    if (validateSnapshot(snapshot)) {
      this.cache.setSnapshot(normalized, snapshot);
      this.emit("SNAPSHOT_REFRESHED", normalized, { isFresh, dataSource: snapshot.dataSource });
    }
    return snapshot;
  }

  async getCurrentPrice(userId: number, symbol: string): Promise<number | null> {
    const ticker = await this.getTicker(userId, symbol);
    return ticker?.lastPrice ?? null;
  }

  // ---- health ----

  getHealth(): MarketHealth {
    return computeHealth({
      getConnectionState: () => this.connectionState,
      isRecovering: () => this.recovering,
      hasDataGaps: () =>
        this.subscriptions.getSymbols().some((symbol) => this.cache.freshnessOf(symbol) !== "FRESH"),
      freshnessOf: (symbol) => this.cache.freshnessOf(symbol),
      subscribedSymbols: () => this.subscriptions.getSymbols(),
    });
  }

  getDetailedHealth(): MarketDataHealth {
    const health = this.getHealth();
    const symbols: MarketDataHealth["symbols"] = {};
    for (const symbol of this.subscriptions.getSymbols()) {
      symbols[symbol] = {
        freshness: this.cache.freshnessOf(symbol),
        lastUpdateAt: this.cache.getTicker(symbol)?.receivedAt ?? null,
      };
    }
    return {
      state: health.state,
      connection: this.connectionState,
      connectedAt: this.connectedAt,
      lastDisconnectAt: this.lastDisconnectAt,
      lastError: this.lastError,
      reconnectAttempt: this.socket.attemptCount,
      nextReconnectAt: null,
      subscribedSymbols: this.subscriptions.getSymbols(),
      symbols,
      updatedAt: Date.now(),
    };
  }

  /** Returns a MarketDataService adapter bound to a userId (per-bot). */
  adapterFor(userId: number): MarketDataService {
    return {
      getSnapshot: (symbol, timeframe) => this.getSnapshot(userId, symbol, timeframe),
    };
  }

  on(type: MarketDataEvent["type"], handler: (event: MarketDataEvent) => void): () => void {
    return this.events.on(type, handler);
  }

  getTickerCache(symbol: string): MarketTicker | null {
    return this.cache.getTicker(normalizeSymbol(symbol));
  }

  // ---- internal ----

  private wireSocket(): void {
    this.socket.onStatus((status, message) => {
      switch (status) {
        case "connected":
          this.connectionState = "CONNECTED";
          this.connectedAt = Date.now();
          this.lastError = null;
          this.recovering = false;
          this.emit("CONNECTED", "", { message });
          break;
        case "disconnected":
          this.connectionState = "DISCONNECTED";
          this.lastDisconnectAt = Date.now();
          this.recovering = true;
          this.emit("DISCONNECTED", "", { message });
          break;
        case "reconnecting":
          this.connectionState = "RECONNECTING";
          this.recovering = true;
          this.emit("RECONNECTING", "", { message });
          break;
        case "degraded":
          this.emit("DATA_STALE", "", { message });
          break;
        case "error":
          this.lastError = message;
          this.emit("DATA_UNAVAILABLE", "", { message });
          break;
      }
    });

    this.socket.onTicker((tickers) => {
      for (const raw of tickers) {
        const parsed = parseTickerPayload(raw);
        for (const ticker of parsed) {
          this.cache.setTicker(ticker.symbol, ticker);
          this.aggregator.fold({ symbol: ticker.symbol, price: ticker.lastPrice, size: 0, time: Date.now() }, 1);
          this.subscriptions.markSubscribed(ticker.symbol, true);
          this.emit("TICKER", ticker.symbol, ticker);
        }
      }
    });

    this.socket.onCandle((msg) => {
      const candle = parseCandleMessage(msg);
      const symbol = normalizeSymbol(msg?.s ?? "");
      if (!candle) {
        this.emit("INVALID_DATA_REJECTED", symbol, { source: "candle", message: String(msg?.s ?? "") });
        return;
      }
      if (!symbol) return;
      this.cache.upsertCandles(symbol, candle.timeframe, [candle]);
      this.subscriptions.markSubscribed(symbol, true);
      this.emit("CANDLE", symbol, candle);
    });
  }

  private async primeSymbol(userId: number, symbol: string): Promise<void> {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return;
    const ticker = await this.restClient.getTicker(userId, normalized);
    if (ticker) {
      this.cache.setTicker(normalized, { ...ticker, source: "rest" });
      this.emit("SNAPSHOT_REFRESHED", normalized, { source: "rest", priming: true });
    }
  }

  private ensureCandleInterval(symbol: string, interval: string): void {
    if (!interval) return;
    const normalized = normalizeSymbol(symbol);
    const set = this.candleIntervals.get(normalized) ?? new Set<string>();
    if (set.has(interval)) return;
    set.add(interval);
    this.candleIntervals.set(normalized, set);
    this.socket.subscribe(normalized, interval);
  }

  private mergeAggregatedCandle(symbol: string, minutes: number, candles: MarketCandle[]): MarketCandle[] {
    const current = this.aggregator.peek(symbol, minutes);
    if (!current) return candles;
    const last = candles[candles.length - 1];
    if (last && last.timestamp === current.timestamp) {
      // prefer the authoritative WS/REST candle; only fill gaps
      const updated = [...candles];
      updated[updated.length - 1] = last;
      return updated;
    }
    if (last && current.timestamp < last.timestamp) return candles;
    return [...candles, current];
  }

  private async refreshAllSnapshots(): Promise<void> {
    const symbols = this.subscriptions.getSymbols();
    for (const symbol of symbols) {
      const userId = this.userIdFor(symbol);
      const intervals = Array.from(this.candleIntervals.get(symbol) ?? []);
      const interval = intervals[0] ?? "5";
      if (userId !== null) {
        await this.getSnapshot(userId, symbol, interval).catch(() => undefined);
      }
    }
  }

  private userIdFor(symbol: string): number | null {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return null;
    return this.userIdsBySymbol.get(normalized) ?? this.defaultUserId ?? null;
  }

  private defaultIntervalFor(): string {
    return "5";
  }

  private emit(type: MarketDataEvent["type"], symbol: string, data?: unknown): void {
    this.events.emit({ type, symbol, timestamp: Date.now(), data });
  }

  private recoveryBotService = {
    getBotsByDesiredStatus: async (statuses: string[]): Promise<Array<{ symbol: string; userId?: number }>> => {
      const { BotLifecycleService } = await import("@/automation/service/bot-lifecycle");
      const bots = await new BotLifecycleService().getBotsByDesiredStatus(statuses as DesiredBotStatus[]);
      return bots.map((bot) => ({ symbol: bot.symbol, userId: bot.userId }));
    },
  };

  private recoveryPositionStore = {
    getActivePositions: async () => {
      const { PositionStore } = await import("@/automation/position/PositionStore");
      return new PositionStore().getActivePositions();
    },
  };

  private async seedUserIdsFromRecoverySources(): Promise<void> {
    try {
      const bots = await this.recoveryBotService.getBotsByDesiredStatus(["RUNNING", "PAUSED"]);
      for (const bot of bots) {
        const symbol = normalizeSymbol(bot.symbol);
        const userId = Number(bot.userId);
        if (symbol && userId > 0) this.userIdsBySymbol.set(symbol, userId);
      }
    } catch {
      // non-fatal
    }
    try {
      const positions = await this.recoveryPositionStore.getActivePositions();
      for (const position of positions) {
        const symbol = normalizeSymbol(position.symbol);
        if (symbol && position.userId > 0) this.userIdsBySymbol.set(symbol, position.userId);
      }
    } catch {
      // non-fatal
    }
  }
}

/** Process-wide shared market data service. Started by the scheduler/instrumentation. */
export const serverMarketDataService = new ServerMarketDataService();
