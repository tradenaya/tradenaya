import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MarketDataSocket, type SocketLike } from "./socket";
import type { WsCandleMessage, WsTickerMessage } from "./types";

class FakeSocket implements SocketLike {
  connected = false;
  id: string | undefined;
  emitted: Array<{ event: string; payload?: Record<string, unknown> }> = [];
  private handlers = new Map<string, (payload?: unknown) => void>();

  on<E = unknown>(event: string, handler: (payload: E) => void): void {
    this.handlers.set(event, handler as unknown as (payload?: unknown) => void);
  }

  emit(event: string, payload?: Record<string, unknown>): void {
    this.emitted.push({ event, payload });
  }

  disconnect(): void {
    this.connected = false;
  }

  close(): void {
    this.connected = false;
  }

  fire(event: string, payload?: unknown): void {
    if (event === "connect") this.connected = true;
    if (event === "disconnect") this.connected = false;
    this.handlers.get(event)?.(payload);
  }
}

function makeSocket(options: { backoffBaseMs?: number; backoffMaxMs?: number; verifyTimeoutMs?: number; maxReconnectAttempts?: number } = {}) {
  const created: FakeSocket[] = [];
  const socket = new MarketDataSocket({
    backoffBaseMs: options.backoffBaseMs ?? 100,
    backoffMaxMs: options.backoffMaxMs ?? 200,
    maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
    verifyTimeoutMs: options.verifyTimeoutMs ?? 1000,
    connectImpl: () => {
      const fake = new FakeSocket();
      created.push(fake);
      return fake;
    },
  });
  return { socket, created, current: () => created[created.length - 1] };
}

describe("MarketDataSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a single connection and reuses it for repeated subscribe calls", () => {
    const { socket, created } = makeSocket();
    socket.connect();
    socket.subscribe("BTCUSDT", "5");
    socket.subscribe("BTCUSDT", "5");
    socket.subscribe("BTCUSDT");
    expect(created).toHaveLength(1);
    expect(socket.desiredPairs).toContain("BTCUSDT_5");
  });

  it("subscribes after connect and re-subscribes after reconnect", () => {
    const { socket, current } = makeSocket();
    socket.connect();
    socket.subscribe("BTCUSDT", "5");
    socket.subscribe("ETHUSDT");

    const first = current();
    first.fire("connect");
    const candleSubs = first.emitted.filter((e) => e.event === "FETCH_CANDLESTICK_CS_PRO").map((e) => e.payload?.pair);
    const tickerSubs = first.emitted.filter((e) => e.event === "FETCH_TICKER_INFO_CS_PRO").map((e) => e.payload?.pair);
    expect(candleSubs).toContain("BTCUSDT_5");
    expect(tickerSubs).toContain("ETHUSDT");
    expect(socket.isConnected).toBe(true);

    // simulate a drop
    first.disconnect();
    first.fire("disconnect", "transport close");
    expect(socket.isConnected).toBe(false);
    expect(socket.attemptCount).toBe(1);

    vi.advanceTimersByTime(100);
    const second = current();
    expect(second).not.toBe(first);
    second.fire("connect");

    const resubscribedCandles = second.emitted
      .filter((e) => e.event === "FETCH_CANDLESTICK_CS_PRO")
      .map((e) => e.payload?.pair);
    const resubscribedTickers = second.emitted
      .filter((e) => e.event === "FETCH_TICKER_INFO_CS_PRO")
      .map((e) => e.payload?.pair);
    expect(resubscribedCandles).toContain("BTCUSDT_5");
    expect(resubscribedTickers).toContain("ETHUSDT");
    expect(socket.attemptCount).toBe(0);
  });

  it("does not open a second socket while connected or while reconnecting", () => {
    const { socket, current, created } = makeSocket({ backoffBaseMs: 100 });
    socket.connect();
    socket.connect();
    current().fire("connect");
    socket.connect();
    expect(created).toHaveLength(1);

    current().disconnect();
    current().fire("disconnect", "x");
    socket.connect();
    expect(created).toHaveLength(1); // reconnect timer pending, no new socket yet
    vi.advanceTimersByTime(100);
    expect(created).toHaveLength(2);
  });

  it("stops reconnecting after maxReconnectAttempts", () => {
    const { socket, current, created } = makeSocket({ backoffBaseMs: 10, backoffMaxMs: 200, maxReconnectAttempts: 2 });
    socket.connect();
    // initial connection never succeeds
    current().fire("connect_error", new Error("boom"));
    vi.advanceTimersByTime(1000);
    current().fire("connect_error", new Error("boom"));
    vi.advanceTimersByTime(1000);
    current().fire("connect_error", new Error("boom"));

    // initial + 2 reconnect attempts, then give up
    expect(created).toHaveLength(3);
    expect(socket.attemptCount).toBe(3);

    // no further reconnects scheduled
    vi.advanceTimersByTime(5000);
    expect(created).toHaveLength(3);
  });

  it("forwards ticker and candle events to handlers", () => {
    const { socket, current } = makeSocket();
    const tickers: WsTickerMessage[][] = [];
    const candles: WsCandleMessage[] = [];
    socket.onTicker((t) => tickers.push(t));
    socket.onCandle((c) => candles.push(c));

    socket.connect();
    const fake = current();
    fake.fire("connect");

    fake.fire("FETCH_TICKER_INFO_CS_PRO", { BTCUSDT: { s: "BTCUSDT", c: "100", b: "99", a: "101" } });
    fake.fire("FETCH_CANDLESTICK_CS_PRO", { s: "BTCUSDT", i: "5", o: "1", h: "2", l: "0.5", c: "1.5", v: "10", q: "", x: false, t: 1000, T: 1300, ts: 1200 });

    expect(tickers).toHaveLength(1);
    expect(tickers[0][0].c).toBe("100");
    expect(candles).toHaveLength(1);
    expect(candles[0].s).toBe("BTCUSDT");
  });

  it("ignores events from a stale socket after close", () => {
    const { socket, current } = makeSocket();
    const statuses: string[] = [];
    socket.onStatus((s) => statuses.push(s));
    socket.connect();
    const first = current();
    socket.close();
    // stale events must not trigger reconnects
    first.fire("disconnect", "x");
    vi.advanceTimersByTime(1000);
    expect(socket.isConnected).toBe(false);
    expect(statuses).not.toContain("reconnecting");
  });
});
