import type { MarketCandle, MarketSnapshot } from "@/automation/types";

export type { MarketCandle, MarketSnapshot };

/** Raw candle message as pushed by the CoinSwitch futures WebSocket (FETCH_CANDLESTICK_CS_PRO). */
export interface WsCandleMessage {
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  q: string;
  /** symbol, e.g. "DOGEUSDT" */
  s: string;
  /** interval in minutes, e.g. "5" */
  i: string;
  /** true when this candle is closed/final */
  x: boolean;
  /** candle start time (ms) */
  t: number;
  /** candle close time (ms) */
  T: number;
  /** time of most recent trade in this candle (ms) */
  ts: number;
}

/** Raw ticker message as pushed by the CoinSwitch futures WebSocket (FETCH_TICKER_INFO_CS_PRO). */
export interface WsTickerMessage {
  s: string;
  e: string;
  E: number;
  o: string;
  h: string;
  l: string;
  c: string;
  bv: string;
  qv: string;
  P: string;
  b: string;
  a: string;
  T: number;
  p: number;
  i: number;
  r: number;
  oi: string;
  oiv: string;
  bs: string;
  as: string;
}

/** Normalized, validated ticker used across the service. */
export interface MarketTicker {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  high24h: number | null;
  low24h: number | null;
  openPrice: number | null;
  volume24h: number | null;
  quoteVolume24h: number | null;
  changePct24h: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  exchangeTimestamp: number | null;
  receivedAt: number;
  source: "websocket" | "rest";
}

/** Latest validated data held for a symbol. */
export interface SymbolData {
  ticker: MarketTicker | null;
  /** Latest candle per timeframe (minutes), keyed by interval string. */
  candles: Record<string, MarketCandle[]>;
  candlesUpdatedAt: Record<string, number>;
  snapshot: MarketSnapshot | null;
  snapshotUpdatedAt: number | null;
  lastUpdateAt: number | null;
  staleSince: number | null;
  freshness: DataFreshness;
}

export type ConnectionState = "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "RECONNECTING" | "RECONNECTING_AUTH" | "ERROR";

export type ServiceHealthState = "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "RECOVERING" | "ERROR";

export type DataFreshness = "FRESH" | "STALE" | "UNAVAILABLE";

export type MarketDataSource = "websocket" | "rest" | "cache";

export interface MarketSubscription {
  symbol: string;
  consumerIds: string[];
  createdAt: number;
  lastRefreshedAt: number;
  websocketSubscribed: boolean;
}

export interface MarketDataHealth {
  state: ServiceHealthState;
  connection: ConnectionState;
  connectedAt: number | null;
  lastDisconnectAt: number | null;
  lastError: string | null;
  reconnectAttempt: number;
  nextReconnectAt: number | null;
  subscribedSymbols: string[];
  symbols: Record<string, { freshness: DataFreshness; lastUpdateAt: number | null }>;
  updatedAt: number;
}

export type MarketDataEventType =
  | "CONNECTED"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "RECONNECTED"
  | "SUBSCRIBED"
  | "UNSUBSCRIBED"
  | "DUPLICATE_SUBSCRIPTION_PREVENTED"
  | "TICKER"
  | "CANDLE"
  | "SNAPSHOT_REFRESHED"
  | "DATA_STALE"
  | "DATA_FRESH"
  | "DATA_UNAVAILABLE"
  | "REST_FAILURE"
  | "INVALID_DATA_REJECTED"
  | "RECOVERY_COMPLETED";

export interface MarketDataEvent {
  type: MarketDataEventType;
  symbol: string;
  timestamp: number;
  data?: unknown;
}

export interface CandleHistoryOptions {
  /** inclusive start time (ms) */
  startTime?: number;
  /** inclusive end time (ms) */
  endTime?: number;
  /** max rows requested from the exchange (default 100) */
  limit?: number;
}

export type MarketDataErrorCode =
  | "NETWORK"
  | "AUTH"
  | "INVALID_DATA"
  | "SUBSCRIPTION"
  | "API"
  | "WEBSOCKET"
  | "INTERNAL";

export class MarketDataError extends Error {
  constructor(
    message: string,
    public readonly code: MarketDataErrorCode,
    public readonly symbol?: string,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

export interface MarketHealth {
  state: ServiceHealthState;
  connection: ConnectionState;
  ready: boolean;
  dataFresh: boolean;
  degraded: boolean;
  message: string;
  details: {
    connected: boolean;
    connecting: boolean;
    reconnecting: boolean;
    recovering: boolean;
    subscriptionsActive: number;
    dataGaps: boolean;
    symbolsWithGaps: string[];
    lastDataAt: number | null;
  };
}

export interface MarketDataRecoveryDeps {
  /** rebuild the subscribed symbol set after restart */
  botService: { getBotsByDesiredStatus(statuses: string[]): Promise<Array<{ symbol: string }>> };
  positionStore: { getActivePositions(): Promise<Array<{ symbol: string }>> };
  /** (re)subscribe a symbol after restart */
  subscribe: (symbol: string) => Promise<void>;
  /** prime the cache with a fresh REST snapshot for a symbol */
  prime: (symbol: string) => Promise<void>;
}

export type SocketStatus = "connected" | "disconnected" | "reconnecting" | "degraded" | "error";

/** Narrow WebSocket interface the service consumes (implemented by MarketDataSocket). */
export interface MarketDataSocketLike {
  connect(): void;
  close(): void;
  subscribe(symbol: string, interval?: string | number): void;
  unsubscribe(symbol: string): void;
  onTicker(handler: (tickers: WsTickerMessage[]) => void): () => void;
  onCandle(handler: (candle: WsCandleMessage) => void): () => void;
  onStatus(handler: (status: SocketStatus, message: string) => void): () => void;
  readonly isConnected: boolean;
  readonly attemptCount: number;
}
