import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PaperExchange, type Candle1m, type PaperMarket } from "@/automation/paper/exchange";
import { MemoryPaperStore } from "@/automation/paper/store";
import type { MarketCandle } from "@/automation/types";
import type { MarketSnapshot } from "@/automation/market/types";

/**
 * A simulated CoinSwitch for end-to-end tests.
 *
 *  - Market: REAL historical 1-hour candles (fixtures/candles-1h.json.gz),
 *    replayed against a fake clock. Only CLOSED candles are ever visible, so
 *    nothing can peek into the future. Higher timeframes are built from them
 *    the way the exchange does (UTC-aligned buckets).
 *  - Account: the paper exchange (CoinSwitch response shapes, fees, slippage,
 *    limit trade-through, one stop-loss per position, reduce-only clean-up).
 *  - Instrument rules: realistic minimum order sizes / steps / precision.
 *  - Faults: injected network timeouts, failed placements and cancels at
 *    configurable rates (deterministic, seeded), to prove the bots cope with an
 *    unreliable exchange the way production has to.
 */

const H = 3_600_000;

export type Rows = Record<string, number[][]>; // [t, o, h, l, c, v]

export function loadFixture(): Rows {
  const file = path.join(__dirname, "fixtures", "candles-1h.json.gz");
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as Rows;
}

/** Realistic CoinSwitch-style instrument rules per coin. */
const RULES: Record<string, { minQty: number; step: number; pricePrecision: number; maxLeverage: number }> = {
  BTCUSDT: { minQty: 0.001, step: 0.001, pricePrecision: 1, maxLeverage: 100 },
  ETHUSDT: { minQty: 0.01, step: 0.01, pricePrecision: 2, maxLeverage: 100 },
  SOLUSDT: { minQty: 0.1, step: 0.1, pricePrecision: 3, maxLeverage: 75 },
  XRPUSDT: { minQty: 1, step: 0.1, pricePrecision: 4, maxLeverage: 75 },
  BNBUSDT: { minQty: 0.01, step: 0.01, pricePrecision: 2, maxLeverage: 75 },
  DOGEUSDT: { minQty: 10, step: 1, pricePrecision: 5, maxLeverage: 75 },
  HYPEUSDT: { minQty: 0.1, step: 0.01, pricePrecision: 3, maxLeverage: 50 },
  ZECUSDT: { minQty: 0.01, step: 0.01, pricePrecision: 2, maxLeverage: 50 },
};

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FaultRates {
  /** Share of READ calls that time out (the client's retry must cope). */
  readTimeout: number;
  /** Share of order placements that fail before reaching the exchange. */
  placeFailure: number;
  /** Share of cancels that fail. */
  cancelFailure: number;
}

export const NO_FAULTS: FaultRates = { readTimeout: 0, placeFailure: 0, cancelFailure: 0 };

export class SimMarket {
  private readonly rows: Record<string, MarketCandle[]> = {};

  constructor(data: Rows, readonly symbols = Object.keys(data)) {
    for (const s of symbols) {
      this.rows[s] = data[s].map((r) => ({ timestamp: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], timeframe: "1h" }));
    }
  }

  first(): number {
    return Math.max(...this.symbols.map((s) => this.rows[s][0].timestamp));
  }

  last(): number {
    return Math.min(...this.symbols.map((s) => this.rows[s].at(-1)!.timestamp + H));
  }

  /** Closed 1h candles up to `now`. */
  closed1h(symbol: string, now: number): MarketCandle[] {
    const all = this.rows[symbol.toUpperCase()] ?? [];
    let hi = all.length;
    while (hi > 0 && all[hi - 1].timestamp + H > now) hi--;
    return all.slice(0, hi);
  }

  /** Closed candles of any timeframe (multiple of 1h), UTC-aligned like the exchange. */
  closed(symbol: string, minutes: number, now: number, limit = 300): MarketCandle[] {
    const hourly = this.closed1h(symbol, now);
    if (minutes <= 60) return hourly.slice(-limit);
    const size = minutes * 60_000;
    const out: MarketCandle[] = [];
    for (const c of hourly) {
      const start = Math.floor(c.timestamp / size) * size;
      const last = out[out.length - 1];
      if (last && last.timestamp === start) {
        last.high = Math.max(last.high, c.high);
        last.low = Math.min(last.low, c.low);
        last.close = c.close;
        last.volume += c.volume;
      } else {
        out.push({ ...c, timestamp: start, timeframe: `${minutes}m` });
      }
    }
    // drop the bucket still forming
    while (out.length && out[out.length - 1].timestamp + size > now) out.pop();
    return out.slice(-limit);
  }

  price(symbol: string, now: number): number | null {
    const c = this.closed1h(symbol, now);
    return c.length ? c[c.length - 1].close : null;
  }

  rule(symbol: string) {
    return RULES[symbol.toUpperCase()] ?? { minQty: 1, step: 1, pricePrecision: 4, maxLeverage: 50 };
  }

  /** Coins ranked by 24h quote volume at `now` (what the auto-select scan starts from). */
  eligible(now: number) {
    return this.symbols
      .map((s) => {
        const day = this.closed1h(s, now).slice(-24);
        const quoteVolume24h = day.reduce((a, c) => a + c.volume * c.close, 0);
        const change24h = day.length ? ((day[day.length - 1].close - day[0].open) / day[0].open) * 100 : 0;
        return { symbol: s, quoteVolume24h, change24h, fundingRate: 0 };
      })
      .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
  }

  snapshot(symbol: string, timeframe: string, minutes: number, now: number): MarketSnapshot {
    const candles = this.closed(symbol, minutes, now);
    const price = this.price(symbol, now) ?? candles[candles.length - 1]?.close ?? 0;
    return {
      symbol: symbol.toUpperCase(),
      exchange: "EXCHANGE_2",
      timestamp: now,
      price,
      bid: price,
      ask: price,
      volume: candles[candles.length - 1]?.volume ?? 0,
      candles: { [String(minutes)]: candles, [timeframe]: candles },
      receivedAt: now,
      dataSource: "cache",
      isFresh: "FRESH",
    } as unknown as MarketSnapshot;
  }
}

export interface SimStats {
  calls: Record<string, number>;
  injected: { readTimeouts: number; placeFailures: number; cancelFailures: number };
}

/** The account side + fault injection, answering exactly what the real client's `send()` receives. */
export class SimExchange {
  readonly paper: PaperExchange;
  readonly store = new MemoryPaperStore();
  readonly stats: SimStats = { calls: {}, injected: { readTimeouts: 0, placeFailures: 0, cancelFailures: 0 } };
  faults: FaultRates;
  private readonly random: () => number;

  constructor(readonly market: SimMarket, opts: { seed?: number; faults?: FaultRates } = {}) {
    this.faults = opts.faults ?? NO_FAULTS;
    this.random = rng(opts.seed ?? 1);
    const paperMarket: PaperMarket = {
      candles: async (_u, symbol, since) =>
        this.market.closed1h(symbol, Date.now()).filter((c) => c.timestamp >= since).map((c): Candle1m => ({ start: c.timestamp, high: c.high, low: c.low, close: c.close })),
      price: async (_u, symbol) => this.market.price(symbol, Date.now()),
    };
    this.paper = new PaperExchange(this.store, paperMarket, () => Date.now());
  }

  async setBalance(userId: number, usdt: number) {
    await this.store.saveWallet({ userId, balance: usdt, initialBalance: usdt });
  }

  /** Drop-in for CoinSwitchClient#send (one attempt; the client's own retry wraps it). */
  send = async (method: "GET" | "POST" | "DELETE", endpoint: string, params: Record<string, unknown>, userId: number): Promise<unknown> => {
    const key = `${method} ${endpoint}`;
    this.stats.calls[key] = (this.stats.calls[key] ?? 0) + 1;
    const isPlace = method === "POST" && endpoint === "/futures/order";
    const isCancel = method === "DELETE" && endpoint === "/futures/order";
    const isRead = !isPlace && !isCancel && !(method === "POST" && endpoint === "/futures/leverage");

    if (isRead && this.random() < this.faults.readTimeout) {
      this.stats.injected.readTimeouts++;
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ETIMEDOUT" } });
    }
    if (isPlace && this.random() < this.faults.placeFailure) {
      this.stats.injected.placeFailures++;
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } });
    }
    if (isCancel && this.random() < this.faults.cancelFailure) {
      this.stats.injected.cancelFailures++;
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } });
    }

    const now = Date.now();
    if (endpoint === "/futures/all-pairs/ticker") {
      const data: Record<string, unknown> = {};
      for (const c of this.market.eligible(now)) {
        data[c.symbol] = { s: c.symbol, c: String(this.market.price(c.symbol, now)), quote_asset_volume_24h: String(c.quoteVolume24h), price_24h_pcnt: String(c.change24h), funding_rate: "0" };
      }
      return { data };
    }
    if (endpoint === "/futures/instrument_info") {
      const data: Record<string, unknown> = {};
      for (const s of this.market.symbols) {
        const r = this.market.rule(s);
        data[s] = {
          symbol: s, status: "TRADING", min_base_quantity: String(r.minQty), base_quantity_step_size: String(r.step), lot_size: String(r.step),
          quantity_precision: Math.max(0, -Math.floor(Math.log10(r.step))), price_precision: r.pricePrecision,
          min_leverage: "1", max_leverage: String(r.maxLeverage), leverage_step: "1",
        };
      }
      return { data };
    }
    if (endpoint === "/futures/klines") {
      const minutes = Number(params.interval) || 60;
      return { data: this.market.closed(String(params.symbol), minutes, now, Number(params.limit) || 300).map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume]) };
    }

    // Real exchange validation the paper exchange doesn't model: order size rules.
    if (isPlace) {
      const r = this.market.rule(String(params.symbol));
      const q = Number(params.quantity);
      if (!(q >= r.minQty - 1e-12)) throw Object.assign(new Error(`Quantity ${q} is below the minimum ${r.minQty}`), { httpStatus: 400 });
      const steps = q / r.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-6) throw Object.assign(new Error(`Quantity ${q} is not a multiple of the step ${r.step}`), { httpStatus: 400 });
    }

    const res = await this.paper.handle(method, endpoint, params, userId);
    if (!res) throw Object.assign(new Error(`sim: unsupported endpoint ${key}`), { httpStatus: 404 });
    if (res.status >= 400) {
      const body = res.body as { message?: string };
      throw Object.assign(new Error(body?.message ?? `HTTP ${res.status}`), { httpStatus: res.status });
    }
    return res.body;
  };
}
