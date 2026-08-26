import { io } from "socket.io-client";
import type { WsCandleMessage, WsTickerMessage } from "./types";
import { normalizeSymbol, normalizeInterval, toApiInterval } from "./normalizer";

export interface SocketLike {
  on<E = unknown>(event: string, handler: (payload: E) => void): void;
  emit(event: string, payload?: Record<string, unknown>): void;
  readonly connected: boolean;
  readonly id?: string;
  disconnect(): void;
  close(): void;
}

export interface MarketDataSocketOptions {
  url?: string;
  path?: string;
  /** base reconnect delay (ms) */
  backoffBaseMs?: number;
  /** max reconnect delay (ms) */
  backoffMaxMs?: number;
  /** max reconnect attempts before giving up (default Infinity) */
  maxReconnectAttempts?: number;
  /** how long to wait for the first data message after (re)connect before flagging DEGRADED */
  verifyTimeoutMs?: number;
  now?: () => number;
  /** injectable socket factory for tests */
  connectImpl?: (url: string, options: Record<string, unknown>) => SocketLike;
}

const WS_EVENT_TICKER = "FETCH_TICKER_INFO_CS_PRO";
const WS_EVENT_CANDLE = "FETCH_CANDLESTICK_CS_PRO";

/**
 * Server-side WebSocket client for CoinSwitch Futures real-time data.
 *
 * Uses the same socket.io protocol as the existing frontend sockets
 * (futuresSocket.ts / futuresTickerSocket.ts) but maintains a SINGLE shared
 * connection with arbitrary symbol subscriptions, managed reconnection with
 * exponential backoff, re-subscription after reconnect and data-flow
 * verification. No credentials are sent on the wire.
 */
export class MarketDataSocket {
  private socket: SocketLike | null = null;
  private readonly desired = new Map<string, { symbol: string; intervals: Set<string> }>();
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly verifyTimeoutMs: number;
  private readonly now: () => number;
  private readonly connectImpl: (url: string, options: Record<string, unknown>) => SocketLike;
  private readonly url: string;
  private readonly path: string;

  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private generation = 0;
  private expectedDisconnect = false;
  private awaitingFirstData = false;
  private lastDataAt: number | null = null;

  private onTickerHandlers: ((tickers: WsTickerMessage[]) => void)[] = [];
  private onCandleHandlers: ((candle: WsCandleMessage) => void)[] = [];
  private onStatusHandlers: ((status: "connected" | "disconnected" | "reconnecting" | "degraded" | "error", message: string) => void)[] = [];

  constructor(options: MarketDataSocketOptions = {}) {
    this.url = options.url ?? "wss://ws.coinswitch.co/exchange_2";
    this.path = options.path ?? "/pro/realtime-rates-socket/futures/exchange_2";
    this.backoffBaseMs = options.backoffBaseMs ?? 1000;
    this.backoffMaxMs = options.backoffMaxMs ?? 60_000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? 15_000;
    this.now = options.now ?? (() => Date.now());
    this.connectImpl = options.connectImpl ?? ((url, opts) => io(url, opts) as unknown as SocketLike);
  }

  // ---- handlers ----

  onTicker(handler: (tickers: WsTickerMessage[]) => void): () => void {
    this.onTickerHandlers.push(handler);
    return () => {
      this.onTickerHandlers = this.onTickerHandlers.filter((h) => h !== handler);
    };
  }

  onCandle(handler: (candle: WsCandleMessage) => void): () => void {
    this.onCandleHandlers.push(handler);
    return () => {
      this.onCandleHandlers = this.onCandleHandlers.filter((h) => h !== handler);
    };
  }

  onStatus(handler: (status: "connected" | "disconnected" | "reconnecting" | "degraded" | "error", message: string) => void): () => void {
    this.onStatusHandlers.push(handler);
    return () => {
      this.onStatusHandlers = this.onStatusHandlers.filter((h) => h !== handler);
    };
  }

  get isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  get attemptCount(): number {
    return this.reconnectAttempt;
  }

  get lastDataAtTime(): number | null {
    return this.lastDataAt;
  }

  get desiredPairs(): string[] {
    const pairs: string[] = [];
    for (const entry of this.desired.values()) {
      for (const interval of entry.intervals) {
        pairs.push(`${entry.symbol}_${interval}`);
      }
      if (entry.intervals.size === 0) pairs.push(entry.symbol);
    }
    return pairs;
  }

  // ---- subscription management (network-level) ----

  /** Request candle + ticker data for a symbol at the given interval (label or minutes). */
  subscribe(symbol: string, interval?: string | number): void {
    const normalized = normalizeSymbol(symbol);
    const existing = this.desired.get(normalized) ?? { symbol: normalized, intervals: new Set<string>() };
    if (interval !== undefined && interval !== null && String(interval) !== "") {
      const minutes = normalizeInterval(interval);
      if (minutes !== null) {
        const api = toApiInterval(minutes) as string;
        existing.intervals.add(api);
      }
    }
    this.desired.set(normalized, existing);

    if (this.isConnected) {
      this.emitCandleSubscription(normalized, existing.intervals);
      this.emitTickerSubscription(normalized);
    }
  }

  /** Remove all network-level subscriptions for a symbol. */
  unsubscribe(symbol: string): void {
    const normalized = normalizeSymbol(symbol);
    this.desired.delete(normalized);
    // The exchange protocol demonstrated by the existing client only shows
    // subscribe; there is no observed unsubscribe event, so the exchange-side
    // subscription is left in place and the service simply stops consuming it.
  }

  // ---- connection lifecycle ----

  connect(): void {
    // A socket object exists while a connection is in flight OR connected; a
    // dead socket always has a pending reconnect timer, and giving up nulls it.
    // Either way, opening a second connection would be a duplicate.
    if (this.socket || this.reconnectTimer) return;
    this.open();
  }

  private open(): void {
    const currentGeneration = this.generation;
    const socket = this.connectImpl(this.url, {
      path: this.path,
      transports: ["websocket"],
      reconnection: false,
      timeout: 5000,
    });
    this.socket = socket;

    socket.on("connect", () => {
      if (currentGeneration !== this.generation) return;
      this.reconnectAttempt = 0;
      this.emitStatus("connected", "WebSocket connected");
      this.resubscribeAll();
      this.beginDataVerification();
    });

    socket.on("disconnect", (reason: string) => {
      if (currentGeneration !== this.generation) return;
      this.emitStatus("disconnected", `WebSocket disconnected: ${reason ?? "unknown"}`);
      this.scheduleReconnect();
    });

    socket.on("connect_error", (error: Error) => {
      if (currentGeneration !== this.generation) return;
      this.emitStatus("error", `WebSocket error: ${error?.message ?? "unknown"}`);
      if (!socket.connected) this.scheduleReconnect();
    });

    socket.on(WS_EVENT_TICKER, (payload: Record<string, WsTickerMessage>) => {
      if (currentGeneration !== this.generation) return;
      this.noteDataReceived();
      if (!payload || typeof payload !== "object") return;
      const tickers = Object.values(payload);
      for (const handler of this.onTickerHandlers) handler(tickers);
    });

    socket.on(WS_EVENT_CANDLE, (candle: WsCandleMessage) => {
      if (currentGeneration !== this.generation) return;
      this.noteDataReceived();
      if (!candle || typeof candle !== "object") return;
      for (const handler of this.onCandleHandlers) handler(candle);
    });
  }

  /** Close the connection and cancel any pending reconnect. */
  close(): void {
    this.expectedDisconnect = true;
    this.generation += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.disconnect();
    this.socket?.close();
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (this.expectedDisconnect) return;
    if (this.reconnectTimer) return;

    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > this.maxReconnectAttempts) {
      this.generation += 1;
      this.socket?.disconnect();
      this.socket?.close();
      this.socket = null;
      this.emitStatus("error", `WebSocket reconnect gave up after ${this.reconnectAttempt - 1} attempts`);
      return;
    }

    const base = this.backoffBaseMs * 2 ** Math.min(this.reconnectAttempt - 1, 10);
    const delay = Math.min(base, this.backoffMaxMs);
    this.emitStatus("reconnecting", `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.expectedDisconnect) return;
      // invalidate the failed socket's handlers and release it before reopening
      this.generation += 1;
      this.socket?.disconnect();
      this.socket?.close();
      this.socket = null;
      this.open();
    }, delay);
  }

  private resubscribeAll(): void {
    for (const entry of this.desired.values()) {
      this.emitCandleSubscription(entry.symbol, entry.intervals);
      this.emitTickerSubscription(entry.symbol);
    }
  }

  private emitCandleSubscription(symbol: string, intervals: Set<string>): void {
    for (const interval of intervals) {
      this.socket?.emit(WS_EVENT_CANDLE, { event: "subscribe", pair: `${symbol}_${interval}` });
    }
  }

  private emitTickerSubscription(symbol: string): void {
    this.socket?.emit(WS_EVENT_TICKER, { event: "subscribe", pair: symbol });
  }

  private noteDataReceived(): void {
    this.lastDataAt = this.now();
    this.awaitingFirstData = false;
  }

  private beginDataVerification(): void {
    this.awaitingFirstData = this.desired.size > 0;
    if (!this.awaitingFirstData) return;
    const timer = setTimeout(() => {
      if (this.awaitingFirstData) {
        this.emitStatus("degraded", "Connected but no market data received yet — data may be sparse; staying connected");
      }
      this.awaitingFirstData = false;
    }, this.verifyTimeoutMs);
    // keep the process alive only while relevant
    if (typeof timer.unref === "function") timer.unref();
  }

  private emitStatus(status: "connected" | "disconnected" | "reconnecting" | "degraded" | "error", message: string): void {
    for (const handler of this.onStatusHandlers) handler(status, message);
  }
}
