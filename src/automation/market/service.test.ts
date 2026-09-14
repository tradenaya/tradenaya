import { describe, it, expect } from "vitest";
import { ServerMarketDataService } from "./service";
import { MarketDataCache } from "./cache";
import { MarketDataSubscriptionManager } from "./subscription-manager";
import { MarketDataEventBus } from "./event-bus";
import { MarketDataRestClient } from "./rest-client";
import type { MarketDataSocketLike, SocketStatus, WsCandleMessage, WsTickerMessage } from "./types";

const NOW = 1_700_000_000_000;

class FakeSocket implements MarketDataSocketLike {
  connected = false;
  subscribed: string[] = [];
  private tickerHandlers: ((tickers: WsTickerMessage[]) => void)[] = [];
  private candleHandlers: ((candle: WsCandleMessage) => void)[] = [];
  private statusHandlers: ((status: SocketStatus, message: string) => void)[] = [];

  get isConnected(): boolean {
    return this.connected;
  }

  get attemptCount(): number {
    return 0;
  }

  connect(): void {
    this.connected = true;
    for (const handler of this.statusHandlers) handler("connected", "fake connected");
  }

  close(): void {
    this.connected = false;
  }

  subscribe(symbol: string, interval?: string | number): void {
    const pair = interval !== undefined && interval !== null && String(interval) !== ""
      ? `${symbol}_${String(interval)}`
      : symbol;
    if (!this.subscribed.includes(pair)) this.subscribed.push(pair);
  }

  unsubscribe(): void {}

  onTicker(handler: (tickers: WsTickerMessage[]) => void): () => void {
    this.tickerHandlers.push(handler);
    return () => {
      this.tickerHandlers = this.tickerHandlers.filter((h) => h !== handler);
    };
  }

  onCandle(handler: (candle: WsCandleMessage) => void): () => void {
    this.candleHandlers.push(handler);
    return () => {
      this.candleHandlers = this.candleHandlers.filter((h) => h !== handler);
    };
  }

  onStatus(handler: (status: SocketStatus, message: string) => void): () => void {
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
    };
  }

  pushTicker(payload: Record<string, WsTickerMessage>): void {
    for (const handler of this.tickerHandlers) handler(Object.values(payload));
  }

  pushCandle(candle: WsCandleMessage): void {
    for (const handler of this.candleHandlers) handler(candle);
  }

  drop(): void {
    this.connected = false;
    for (const handler of this.statusHandlers) handler("disconnected", "transport closed");
  }
}

function buildService(options: { restTicker?: unknown; klines?: unknown[] } = {}) {
  const socket = new FakeSocket();
  const events = new MarketDataEventBus();
  const cache = new MarketDataCache({ now: () => NOW });
  const subscriptions = new MarketDataSubscriptionManager(() => NOW);
  const restClient = new MarketDataRestClient({
    now: () => NOW,
    getTicker: async () => options.restTicker ?? null,
    getKline: async () => options.klines ?? [],
  });

  const service = new ServerMarketDataService({
    socket,
    restClient,
    cache,
    subscriptions,
    events,
    unsubscribeGraceMs: 0,
  });
  return { service, socket, events, cache, subscriptions };
}

const klineRow = (timestamp: number, close: number) => [timestamp, close - 2, close + 2, close - 1, close, 100];

describe("ServerMarketDataService", () => {
  it("subscribes once for a symbol and prevents duplicates", () => {
    const { service, socket, events } = buildService();
    const seen: string[] = [];
    events.on("SUBSCRIBED", (e) => seen.push(e.symbol));
    events.on("DUPLICATE_SUBSCRIPTION_PREVENTED", (e) => seen.push(`dup:${e.symbol}`));

    service.subscribe(1, "BTCUSDT", "bot-1");
    service.subscribe(1, "BTCUSDT", "bot-2");

    expect(socket.subscribed).toContain("BTCUSDT");
    expect(socket.subscribed.filter((s) => s === "BTCUSDT")).toHaveLength(1);
    expect(seen).toContain("BTCUSDT");
    expect(seen).toContain("dup:BTCUSDT");
    expect(service.subscriptions.consumerCount("BTCUSDT")).toBe(2);
  });

  it("releases the symbol only when the last consumer unsubscribes", () => {
    const { service } = buildService();
    service.subscribe(1, "BTCUSDT", "a");
    service.subscribe(1, "BTCUSDT", "b");
    service.unsubscribe("BTCUSDT", "a");
    expect(service.subscriptions.hasConsumers("BTCUSDT")).toBe(true);
    service.unsubscribe("BTCUSDT", "b");
    expect(service.subscriptions.hasConsumers("BTCUSDT")).toBe(false);
  });

  it("serves a FRESH snapshot via REST fallback on a cold cache", async () => {
    const { service, cache } = buildService({
      restTicker: { s: "BTCUSDT", c: "100", b: "99", a: "101" },
      klines: [klineRow(NOW - 60_000, 100), klineRow(NOW - 360_000, 98)],
    });

    const snapshot = await service.getSnapshot(1, "BTCUSDT", "5m");

    expect(snapshot.symbol).toBe("BTCUSDT");
    expect(snapshot.price).toBe(100);
    expect(snapshot.isFresh).toBe("FRESH");
    expect(snapshot.dataSource).toBe("rest");
    expect(snapshot.candles["5"]).toHaveLength(2);
    expect(cache.getSnapshot("BTCUSDT")).not.toBeNull();
  });

  it("keeps REST history when a live WebSocket candle arrives", async () => {
    const { service, socket } = buildService({
      restTicker: { s: "BTCUSDT", c: "100", b: "99", a: "101" },
      klines: [
        klineRow(NOW - 600_000, 98),
        klineRow(NOW - 360_000, 99),
        klineRow(NOW - 120_000, 100),
      ],
    });

    const before = await service.getSnapshot(1, "BTCUSDT", "5m");
    expect(before.candles["5"]).toHaveLength(3);

    // live WS update for the in-progress candle (same bucket key "5")
    socket.pushCandle({
      s: "BTCUSDT", i: "5", o: "100", h: "102", l: "99", c: "101",
      v: "5", q: "", x: false, t: NOW - 60_000, T: NOW + 120_000, ts: NOW,
    });

    const after = await service.getSnapshot(1, "BTCUSDT", "5m");
    expect(after.candles["5"].length).toBeGreaterThanOrEqual(4);
    expect(after.candles["5"].length).toBeLessThanOrEqual(5);
    expect(after.candles["5"].map((c) => c.timestamp)).toContain(NOW - 60_000);
  });

  it("returns STALE when the cache is old and REST fails", async () => {
    const { service, cache } = buildService();
    // prime cache with an old ticker and old candles
    cache.setTicker("BTCUSDT", {
      symbol: "BTCUSDT", lastPrice: 100, bidPrice: 99, askPrice: 101,
      high24h: null, low24h: null, openPrice: null, volume24h: null,
      quoteVolume24h: null, changePct24h: null, markPrice: null, indexPrice: null,
      fundingRate: null, openInterest: null, exchangeTimestamp: null,
      receivedAt: NOW - 30_000, source: "websocket",
    });
    cache.setCandles("BTCUSDT", "5", [klineRow(NOW - 3_600_000, 100)].map((r) => ({
      timestamp: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], timeframe: "5",
    })));

    const snapshot = await service.getSnapshot(1, "BTCUSDT", "5");
    expect(snapshot.isFresh).toBe("STALE");
  });

  it("re-backfills a stale cached series when REST recovers", async () => {
    const { service, cache } = buildService({
      restTicker: { s: "BTCUSDT", c: "100", b: "99", a: "101" },
      klines: [klineRow(NOW - 60_000, 100), klineRow(NOW - 360_000, 98)],
    });
    // Simulate a long-lived process that cached candles hours ago and lost the
    // exchange stream: count ≥ 2 so the old gate would have skipped REST.
    cache.setCandles("BTCUSDT", "5", [klineRow(NOW - 3_600_000, 50)].map((r) => ({
      timestamp: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], timeframe: "5",
    })));
    expect(cache.candleFreshness("BTCUSDT", "5")).toBe("STALE");

    const snapshot = await service.getSnapshot(1, "BTCUSDT", "5");
    expect(snapshot.isFresh).toBe("FRESH");
    expect(snapshot.candles["5"]).toHaveLength(2);
    expect(cache.candleFreshness("BTCUSDT", "5")).toBe("FRESH");
  });

  it("publishes validated tickers from the WebSocket into the cache", () => {
    const { socket, cache, events } = buildService();
    const tickerEvents: string[] = [];
    events.on("TICKER", (e) => tickerEvents.push(e.symbol));

    socket.pushTicker({
      BTCUSDT: { s: "BTCUSDT", c: "105", b: "104", a: "106" },
    } as unknown as Record<string, WsTickerMessage>);

    const cached = cache.getTicker("BTCUSDT");
    expect(cached).not.toBeNull();
    expect(cached!.lastPrice).toBe(105);
    expect(cached!.source).toBe("websocket");
    expect(tickerEvents).toContain("BTCUSDT");
  });

  it("rejects invalid candle messages from the WebSocket", () => {
    const { socket, events } = buildService();
    const rejected: string[] = [];
    events.on("INVALID_DATA_REJECTED", (e) => rejected.push(e.symbol));

    socket.pushCandle({ s: "BTCUSDT", i: "5", o: "0", h: "2", l: "0.5", c: "1.5", v: "10", q: "", x: false, t: 1000, T: 1300, ts: 1200 });
    socket.pushCandle({ s: "ETHUSDT", i: "5", o: "1", h: "2", l: "0.5", c: "1.5", v: "10", q: "", x: false, t: 1000, T: 1300, ts: 1200 });

    expect(rejected).toContain("BTCUSDT");
    expect(rejected).not.toContain("ETHUSDT");
  });

  it("tracks health from socket status transitions", () => {
    const { service, socket } = buildService();
    expect(service.getHealth().state).toBe("DISCONNECTED");

    socket.connect();
    expect(service.getHealth().state).toBe("CONNECTED");
    expect(service.getHealth().ready).toBe(true);

    socket.drop();
    expect(service.getHealth().state).toBe("DISCONNECTED");
    expect(service.getHealth().ready).toBe(false);
  });

  it("adapterFor returns a MarketDataService bound to a userId", async () => {
    const { service } = buildService({
      restTicker: { s: "BTCUSDT", c: "100", b: "99", a: "101" },
      klines: [klineRow(NOW - 60_000, 100), klineRow(NOW - 360_000, 98)],
    });
    const adapter = service.adapterFor(42);
    const snapshot = await adapter.getSnapshot("BTCUSDT", "5");
    expect(snapshot.price).toBe(100);
    // userId 42 was recorded for future REST fallbacks
    const userIds = (service as unknown as { userIdsBySymbol: Map<string, number> }).userIdsBySymbol;
    expect(userIds.get("BTCUSDT")).toBe(42);
  });
});
