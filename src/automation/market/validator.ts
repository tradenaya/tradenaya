import type { MarketCandle, MarketSnapshot, MarketTicker } from "@/automation/types";
import type { WsCandleMessage } from "./types";
import { normalizeSymbol, toApiSymbol } from "./normalizer";

/** Parse a numeric value (number|string) without ever producing NaN/Infinity. */
function toFiniteNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isPositive(value: number | null): boolean {
  return value !== null && value > 0;
}

function validTimestamp(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Build a normalized MarketTicker from a raw ticker-like row. Returns null when invalid. */
export function parseTickerRow(
  row: Record<string, unknown>,
  source: "websocket" | "rest" = "rest",
  receivedAt: number = Date.now(),
): MarketTicker | null {
  if (!row || typeof row !== "object") return null;

  const symbol = normalizeSymbol(String(row.s ?? row.symbol ?? row.pair ?? ""));
  if (!symbol) return null;

  const lastPrice = toFiniteNumber(row.c ?? row.last ?? row.close ?? row.last_price);
  if (!isPositive(lastPrice)) return null;

  const high24h = toFiniteNumber(row.h ?? row.high ?? row.high_price_24h);
  const low24h = toFiniteNumber(row.l ?? row.low ?? row.low_price_24h);
  if (high24h !== null && low24h !== null && high24h < low24h) return null;

  const exchangeTimestamp = toFiniteNumber(row.E ?? row.timestamp);

  return {
    symbol,
    lastPrice: lastPrice as number,
    bidPrice: toFiniteNumber(row.b ?? row.bid ?? row.best_bid_price) ?? 0,
    askPrice: toFiniteNumber(row.a ?? row.ask ?? row.best_ask_price) ?? 0,
    high24h,
    low24h,
    openPrice: toFiniteNumber(row.o ?? row.open ?? row.open_price),
    volume24h: toFiniteNumber(row.bv ?? row.volume ?? row.baseVolume ?? row.base_asset_volume_24h),
    quoteVolume24h: toFiniteNumber(row.qv ?? row.quoteVolume ?? row.quote_asset_volume_24h),
    changePct24h: toFiniteNumber(row.P ?? row.changePct ?? row.price_24h_pcnt),
    markPrice: toFiniteNumber(row.p ?? row.mark_price),
    indexPrice: toFiniteNumber(row.i ?? row.index_price),
    fundingRate: toFiniteNumber(row.r ?? row.funding_rate),
    openInterest: toFiniteNumber(row.oi ?? row.openInterest ?? row.open_interest),
    exchangeTimestamp: validTimestamp(exchangeTimestamp ?? 0) ? exchangeTimestamp : null,
    receivedAt,
    source,
  };
}

/**
 * Parse a WebSocket ticker payload. The exchange can push either a single
 * ticker object or a map keyed by symbol. Returns only valid tickers.
 */
export function parseTickerPayload(payload: unknown, receivedAt: number = Date.now()): MarketTicker[] {
  if (!payload || typeof payload !== "object") return [];

  if (Array.isArray(payload)) {
    return payload.map((row) => parseTickerRow(row as Record<string, unknown>, "websocket", receivedAt)).filter((t): t is MarketTicker => t !== null);
  }

  const record = payload as Record<string, unknown>;

  // Map keyed by symbol: { BTCUSDT: {...}, ETHUSDT: {...} }
  if ("s" in record || "symbol" in record || "pair" in record) {
    const ticker = parseTickerRow(record, "websocket", receivedAt);
    return ticker ? [ticker] : [];
  }

  const tickers: MarketTicker[] = [];
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (!value || typeof value !== "object") continue;
    const ticker = parseTickerRow(value as Record<string, unknown>, "websocket", receivedAt);
    if (ticker) tickers.push(ticker);
  }
  return tickers;
}

/**
 * Parse a WebSocket candle message into a validated MarketCandle.
 * Rejects: missing symbol, invalid prices, high < low, close outside high/low,
 * negative volume, invalid timestamps.
 */
export function parseCandleMessage(msg: WsCandleMessage): MarketCandle | null {
  if (!msg || typeof msg !== "object") return null;

  const symbol = normalizeSymbol(msg.s);
  if (!symbol) return null;

  const open = toFiniteNumber(msg.o);
  const high = toFiniteNumber(msg.h);
  const low = toFiniteNumber(msg.l);
  const close = toFiniteNumber(msg.c);
  const volume = toFiniteNumber(msg.v, 0);
  const timestamp = toFiniteNumber(msg.t);
  const timeframe = toFiniteNumber(msg.i);

  if (open === null || high === null || low === null || close === null) return null;
  if (!isPositive(open) || !isPositive(high) || !isPositive(low) || !isPositive(close)) return null;
  if (high < low) return null;
  if (close < low || close > high) return null;
  if ((volume ?? 0) < 0) return null;
  if (!validTimestamp(timestamp ?? 0)) return null;

  return {
    timestamp: timestamp as number,
    open: open as number,
    high: high as number,
    low: low as number,
    close: close as number,
    volume: volume ?? 0,
    timeframe: String(timeframe),
  };
}

/**
 * Parse a REST kline row into a validated MarketCandle.
 * The kline endpoint historically returns rows as either objects
 * (start_time/o/h/l/c/v) or arrays ([t, o, h, l, c, v]); both are supported.
 */
export function parseCandleRow(row: unknown, timeframe: string = ""): MarketCandle | null {
  if (!row) return null;

  if (Array.isArray(row)) {
    if (row.length < 5) return null;
    const timestamp = toFiniteNumber(row[0]);
    const open = toFiniteNumber(row[1]);
    const high = toFiniteNumber(row[2]);
    const low = toFiniteNumber(row[3]);
    const close = toFiniteNumber(row[4]);
    const volume = toFiniteNumber(row[5], 0);
    return assembleCandle(timestamp, open, high, low, close, volume, timeframe);
  }

  if (typeof row !== "object") return null;

  const record = row as Record<string, unknown>;
  const timestamp = toFiniteNumber(record.start_time ?? record.timestamp ?? record.t ?? record.time);
  const open = toFiniteNumber(record.o ?? record.open);
  const high = toFiniteNumber(record.h ?? record.high);
  const low = toFiniteNumber(record.l ?? record.low);
  const close = toFiniteNumber(record.c ?? record.close);
  const volume = toFiniteNumber(record.v ?? record.volume, 0);
  return assembleCandle(timestamp, open, high, low, close, volume, timeframe);
}

function assembleCandle(
  timestamp: number | null,
  open: number | null,
  high: number | null,
  low: number | null,
  close: number | null,
  volume: number | null,
  timeframe: string,
): MarketCandle | null {
  if (timestamp === null || open === null || high === null || low === null || close === null) return null;
  if (!validTimestamp(timestamp)) return null;
  if (!isPositive(open) || !isPositive(high) || !isPositive(low) || !isPositive(close)) return null;
  if (high < low) return null;
  if (close < low || close > high) return null;
  if ((volume ?? 0) < 0) return null;
  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: volume ?? 0,
    timeframe,
  };
}

/** Validate a fully-assembled snapshot (used before publishing to consumers). */
export function validateSnapshot(snapshot: MarketSnapshot): boolean {
  if (!snapshot) return false;
  if (!normalizeSymbol(snapshot.symbol)) return false;
  if (!isPositive(snapshot.price)) return false;
  if (!validTimestamp(snapshot.timestamp)) return false;
  if (snapshot.bid > 0 && snapshot.ask > 0 && snapshot.bid > snapshot.ask) return false;
  return true;
}

export { toApiSymbol };
