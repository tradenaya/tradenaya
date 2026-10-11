import crypto from "crypto";
import type { PaperOrder, PaperPosition, PaperStore, PaperWallet } from "./store";
import { MySqlPaperStore } from "./store";

/**
 * Paper futures exchange.
 *
 * Answers the CoinSwitch account endpoints (/futures/order, /positions,
 * /orders/open, /orders/closed, /wallet_balance, /transactions, /leverage) in
 * the SAME raw response shape as CoinSwitch, so every caller — the order
 * executor, position monitor, close accounting, the dashboard routes — works
 * unchanged. Orders fill against REAL market data:
 *
 *  - LIMIT entries fill when a 1-minute candle that started AFTER the order
 *    was placed trades through the limit (no look-ahead), at the limit price,
 *    maker fee. A limit already through the market fills immediately (taker).
 *  - MARKET orders fill at the live price, taker fee.
 *  - STOP_MARKET / TAKE_PROFIT_MARKET (reduce-only) trigger when a candle
 *    reaches the trigger, fill at the trigger, taker fee. If a stop and a
 *    target are both reached in one candle the stop is assumed first.
 *  - A position is liquidated (whole margin lost) if price reaches the
 *    estimated liquidation price before its stop.
 *  - When a position goes flat its remaining reduce-only orders are cancelled.
 *
 * Fees match CoinSwitch futures: maker 0.024%, taker 0.065%. No funding.
 */
export const MAKER_FEE = 0.00024;
export const TAKER_FEE = 0.00065;
export const DEFAULT_PAPER_BALANCE = 100;
/** Maintenance-margin rate used for the liquidation estimate. */
const MMR = 0.005;
const MINUTE = 60_000;
/** Matching never looks further back than this (e.g. after a long server stop). */
const MAX_LOOKBACK_MS = 6 * 60 * MINUTE;

export interface Candle1m {
  start: number;
  high: number;
  low: number;
  close: number;
}

export interface PaperMarket {
  /** Closed + forming 1-minute candles with start >= sinceMs, oldest first. */
  candles(userId: number, symbol: string, sinceMs: number): Promise<Candle1m[]>;
  price(userId: number, symbol: string): Promise<number | null>;
}

export interface PaperResponse {
  status: number;
  body: unknown;
}

const upper = (s: unknown) => String(s ?? "").toUpperCase();
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const round8 = (v: number) => Math.round(v * 1e8) / 1e8;

export function liquidationPrice(side: "LONG" | "SHORT", entry: number, leverage: number): number {
  const lev = Math.max(1, leverage);
  return side === "LONG" ? entry * (1 - 1 / lev + MMR) : entry * (1 + 1 / lev - MMR);
}

class Mutex {
  private tail = new Map<number, Promise<unknown>>();
  run<T>(key: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.tail.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.tail.set(key, next.catch(() => undefined));
    return next;
  }
}

export class PaperExchange {
  private readonly lock = new Mutex();
  private readonly lastMatched = new Map<string, number>();

  constructor(
    private readonly store: PaperStore,
    private readonly market: PaperMarket,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- wallet --

  async wallet(userId: number): Promise<PaperWallet> {
    const existing = await this.store.getWallet(userId);
    if (existing) return existing;
    const created = { userId, balance: DEFAULT_PAPER_BALANCE, initialBalance: DEFAULT_PAPER_BALANCE };
    await this.store.saveWallet(created);
    return created;
  }

  /** Reset the simulated wallet to `amount` USDT. Refused while paper positions/orders are open. */
  async resetWallet(userId: number, amount: number): Promise<PaperWallet> {
    if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter a paper balance greater than zero.");
    return this.lock.run(userId, async () => {
      const [positions, orders] = await Promise.all([this.store.listPositions(userId), this.store.listOrders(userId, { status: "OPEN" })]);
      if (positions.length > 0 || orders.length > 0) {
        throw new Error("Close your open paper positions and orders (stop the paper bots) before resetting the paper wallet.");
      }
      const wallet = { userId, balance: round8(amount), initialBalance: round8(amount) };
      await this.store.saveWallet(wallet);
      return wallet;
    });
  }

  async snapshot(userId: number) {
    const [wallet, positions, openOrders] = await Promise.all([this.wallet(userId), this.store.listPositions(userId), this.store.listOrders(userId, { status: "OPEN" })]);
    let unrealized = 0;
    let positionMargin = 0;
    for (const p of positions) {
      const price = (await this.market.price(userId, p.symbol).catch(() => null)) ?? p.entryPrice;
      unrealized += (p.side === "LONG" ? 1 : -1) * (price - p.entryPrice) * p.quantity;
      positionMargin += (p.entryPrice * p.quantity) / p.leverage;
    }
    const orderMargin = openOrders
      .filter((o) => !o.reduceOnly && o.orderType === "LIMIT" && o.price != null)
      .reduce((sum, o) => sum + ((o.price as number) * o.quantity) / o.leverage, 0);
    const available = Math.max(0, wallet.balance - positionMargin - orderMargin + Math.min(0, unrealized));
    return {
      balance: round8(wallet.balance),
      initialBalance: wallet.initialBalance,
      available: round8(available),
      positionMargin: round8(positionMargin),
      orderMargin: round8(orderMargin),
      unrealizedPnl: round8(unrealized),
      equity: round8(wallet.balance + unrealized),
    };
  }

  // --------------------------------------------------------------- routing --

  /**
   * Handle one CoinSwitch request. Returns null for endpoints the paper
   * exchange does not own (market data) so the caller uses the real API.
   */
  async handle(method: "GET" | "POST" | "DELETE", endpoint: string, params: Record<string, unknown>, userId: number): Promise<PaperResponse | null> {
    const ok = (data: unknown): PaperResponse => ({ status: 200, body: { data } });
    const fail = (status: number, message: string): PaperResponse => ({ status, body: { message } });
    const sym = params?.symbol ? upper(params.symbol) : undefined;

    try {
      switch (endpoint) {
        case "/futures/order": {
          if (method === "POST") return ok(this.orderJson(await this.placeOrder(userId, params)));
          if (method === "DELETE") return ok(this.orderJson(await this.cancelOrder(userId, String(params.order_id ?? ""))));
          await this.match(userId);
          const order = await this.store.getOrder(userId, String(params.order_id ?? ""));
          return order ? ok({ order: this.orderJson(order) }) : fail(400, "Order not found");
        }
        case "/futures/leverage": {
          if (method === "GET") {
            return ok({ symbol: upper(params.symbol), leverage: (await this.store.getLeverage(userId, upper(params.symbol))) ?? 1 });
          }
          const leverage = Math.max(1, Math.round(Number(params.leverage) || 1));
          await this.store.setLeverage(userId, upper(params.symbol), leverage);
          return ok({ symbol: upper(params.symbol), leverage });
        }
        case "/futures/positions": {
          await this.match(userId);
          const positions = (await this.store.listPositions(userId)).filter((p) => !sym || p.symbol === sym);
          return ok(await Promise.all(positions.map((p) => this.positionJson(userId, p))));
        }
        case "/futures/orders/open": {
          await this.match(userId);
          const orders = await this.store.listOrders(userId, { status: "OPEN", symbol: sym });
          return ok({ orders: orders.map((o) => this.orderJson(o)) });
        }
        case "/futures/orders/closed": {
          await this.match(userId);
          const from = num(params.from_time);
          const to = num(params.to_time);
          const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 50);
          const orders = (await this.store.listOrders(userId, { symbol: sym }))
            .filter((o) => o.status !== "OPEN" && (from == null || o.updatedAt >= from) && (to == null || o.updatedAt <= to))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, limit);
          return ok({ orders: orders.map((o) => this.orderJson(o)), cursor: null });
        }
        case "/futures/wallet_balance": {
          await this.match(userId);
          const s = await this.snapshot(userId);
          return ok({
            base_asset_balances: [
              {
                base_asset: "USDT",
                balances: {
                  total_balance: String(s.balance),
                  total_available_balance: String(s.available),
                  total_blocked_balance: String(round8(s.positionMargin + s.orderMargin)),
                  total_position_margin: String(s.positionMargin),
                  total_open_order_margin: String(s.orderMargin),
                  total_unrealised_pnl: String(s.unrealizedPnl),
                  equity: String(s.equity),
                },
              },
            ],
            paper: true,
            initial_balance: s.initialBalance,
          });
        }
        case "/futures/transactions": {
          await this.match(userId);
          const type = params.type ? upper(params.type) : undefined;
          const rows = await this.store.listTransactions(userId, { symbol: sym, type, from: num(params.start_time) ?? undefined, to: num(params.end_time) ?? undefined });
          return ok(rows.map((t) => ({ type: t.type, symbol: t.symbol, amount: t.amount, order_id: t.orderId, created_at: t.createdAt, timestamp: t.createdAt })));
        }
        default:
          return null; // market data: instrument_info, klines, ticker
      }
    } catch (error) {
      return fail(400, error instanceof Error ? error.message : String(error));
    }
  }

  // ---------------------------------------------------------------- orders --

  async placeOrder(userId: number, params: Record<string, unknown>): Promise<PaperOrder> {
    return this.lock.run(userId, async () => {
      const symbol = upper(params.symbol);
      const side = upper(params.side) === "SELL" ? "SELL" : "BUY";
      const orderType = upper(params.order_type) as PaperOrder["orderType"];
      const quantity = Number(params.quantity);
      const reduceOnly = params.reduce_only === true || String(params.reduce_only) === "true";
      if (!symbol) throw new Error("symbol is required");
      if (!["MARKET", "LIMIT", "STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(orderType)) throw new Error(`Unsupported order type ${orderType}`);
      if (!(quantity > 0)) throw new Error("Quantity must be greater than zero");

      const price = await this.market.price(userId, symbol);
      if (price == null) throw new Error(`No live price for ${symbol}`);
      const leverage = (await this.store.getLeverage(userId, symbol)) ?? 1;
      const ts = this.now();
      const order: PaperOrder = {
        orderId: `paper-${crypto.randomUUID()}`,
        clientOrderId: params.client_order_id ? String(params.client_order_id) : null,
        userId,
        symbol,
        side,
        orderType,
        quantity,
        price: num(params.price),
        triggerPrice: num(params.trigger_price),
        reduceOnly,
        leverage,
        status: "OPEN",
        execQuantity: 0,
        avgExecutionPrice: null,
        executionFee: null,
        realisedPnl: null,
        createdAt: ts,
        updatedAt: ts,
      };

      if (orderType === "LIMIT" && !(order.price && order.price > 0)) throw new Error("price is required for LIMIT orders");
      if ((orderType === "STOP_MARKET" || orderType === "TAKE_PROFIT_MARKET") && !(order.triggerPrice && order.triggerPrice > 0)) {
        throw new Error("trigger_price is required for stop / take-profit orders");
      }
      // Same rejections as the exchange: a trigger that would fire immediately.
      if (orderType === "STOP_MARKET") {
        if (side === "SELL" && (order.triggerPrice as number) >= price) throw new Error("Stop price would trigger immediately");
        if (side === "BUY" && (order.triggerPrice as number) <= price) throw new Error("Stop price would trigger immediately");
      }
      if (orderType === "TAKE_PROFIT_MARKET") {
        if (side === "SELL" && (order.triggerPrice as number) <= price) throw new Error("Take-profit price would trigger immediately");
        if (side === "BUY" && (order.triggerPrice as number) >= price) throw new Error("Take-profit price would trigger immediately");
      }

      if (!reduceOnly) {
        const s = await this.snapshot(userId);
        const entry = orderType === "LIMIT" ? (order.price as number) : price;
        const needed = (entry * quantity) / leverage + entry * quantity * TAKER_FEE;
        if (needed > s.available + 1e-9) {
          throw new Error(`Insufficient balance: this order needs ~${needed.toFixed(4)} USDT margin, paper wallet has ${s.available.toFixed(4)} USDT available`);
        }
      }

      await this.store.saveOrder(order);

      const marketable =
        orderType === "MARKET" || (orderType === "LIMIT" && (side === "BUY" ? (order.price as number) >= price : (order.price as number) <= price));
      if (marketable) {
        await this.fill(order, orderType === "MARKET" ? price : side === "BUY" ? Math.min(price, order.price as number) : Math.max(price, order.price as number), TAKER_FEE, ts);
      }
      return (await this.store.getOrder(userId, order.orderId)) as PaperOrder;
    });
  }

  async cancelOrder(userId: number, orderId: string): Promise<PaperOrder> {
    return this.lock.run(userId, async () => {
      const order = await this.store.getOrder(userId, orderId);
      if (!order) throw new Error("Order not found");
      if (order.status !== "OPEN") throw new Error(`Order is already ${order.status.toLowerCase()}`);
      order.status = "CANCELLED";
      order.updatedAt = this.now();
      await this.store.saveOrder(order);
      return order;
    });
  }

  // -------------------------------------------------------------- matching --

  /** Advance every open order / position of `userId` through the market since the last check. */
  async match(userId: number): Promise<void> {
    await this.lock.run(userId, async () => {
      const [open, positions] = await Promise.all([this.store.listOrders(userId, { status: "OPEN" }), this.store.listPositions(userId)]);
      const symbols = [...new Set([...open.map((o) => o.symbol), ...positions.map((p) => p.symbol)])];
      for (const symbol of symbols) await this.matchSymbol(userId, symbol);
    });
  }

  private async matchSymbol(userId: number, symbol: string): Promise<void> {
    const key = `${userId}:${symbol}`;
    const now = this.now();
    const orders = await this.store.listOrders(userId, { status: "OPEN", symbol });
    const position = (await this.store.listPositions(userId)).find((p) => p.symbol === symbol) ?? null;
    const earliest = Math.min(...orders.map((o) => o.createdAt), position?.updatedAt ?? Infinity, now);
    const since = Math.max(this.lastMatched.get(key) ?? earliest, now - MAX_LOOKBACK_MS);

    const candles = await this.market.candles(userId, symbol, since - MINUTE).catch(() => [] as Candle1m[]);
    const live = await this.market.price(userId, symbol).catch(() => null);
    const steps: Array<{ candle: Candle1m; live: boolean }> = candles.filter((c) => c.start + MINUTE > since).map((candle) => ({ candle, live: false }));
    if (live != null) steps.push({ candle: { start: now, high: live, low: live, close: live }, live: true });

    for (const step of steps) {
      await this.processCandle(userId, symbol, step.candle, step.live);
    }
    this.lastMatched.set(key, now);
  }

  private async processCandle(userId: number, symbol: string, c: Candle1m, live: boolean): Promise<void> {
    const at = live ? c.start : Math.min(c.start + MINUTE - 1, this.now());
    // A historical candle only counts for an order placed BEFORE it started,
    // so prices from before the order existed can never fill it (no look-ahead).
    const counts = (o: PaperOrder) => live || c.start >= o.createdAt;
    // 1) Resting entries.
    for (const order of await this.store.listOrders(userId, { status: "OPEN", symbol })) {
      if (order.reduceOnly || order.orderType !== "LIMIT") continue;
      if (!counts(order)) continue;
      const limit = order.price as number;
      if (order.side === "BUY" ? c.low <= limit : c.high >= limit) await this.fill(order, limit, MAKER_FEE, at);
    }

    // 2) Exits for the open position: stop first, then target, then liquidation.
    let position = (await this.store.listPositions(userId)).find((p) => p.symbol === symbol) ?? null;
    if (!position) return;
    const reduce = (await this.store.listOrders(userId, { status: "OPEN", symbol })).filter((o) => o.reduceOnly && counts(o));
    const closing = position.side === "LONG" ? "SELL" : "BUY";
    const triggered = (o: PaperOrder) => {
      const t = o.triggerPrice as number;
      if (o.side !== closing) return false;
      if (o.orderType === "STOP_MARKET") return closing === "SELL" ? c.low <= t : c.high >= t;
      if (o.orderType === "TAKE_PROFIT_MARKET") return closing === "SELL" ? c.high >= t : c.low <= t;
      return o.orderType === "MARKET";
    };
    const hits = reduce.filter(triggered).sort((a, b) => rank(a) - rank(b));
    const liq = liquidationPrice(position.side, position.entryPrice, position.leverage);
    const liqHit = position.side === "LONG" ? c.low <= liq : c.high >= liq;
    const firstStop = hits.find((o) => o.orderType === "STOP_MARKET");
    const stopBeforeLiq = firstStop && (position.side === "LONG" ? (firstStop.triggerPrice as number) > liq : (firstStop.triggerPrice as number) < liq);

    if (liqHit && !stopBeforeLiq) {
      await this.liquidate(position, liq, at);
      return;
    }
    for (const order of hits) {
      position = (await this.store.listPositions(userId)).find((p) => p.symbol === symbol) ?? null;
      if (!position) break;
      await this.fill(order, (order.triggerPrice as number) ?? c.close, TAKER_FEE, at);
    }
  }

  // ----------------------------------------------------------------- fills --

  private async fill(order: PaperOrder, price: number, feeRate: number, at: number): Promise<void> {
    const positions = await this.store.listPositions(order.userId);
    let position = positions.find((p) => p.symbol === order.symbol) ?? null;
    const wallet = await this.wallet(order.userId);
    const orderSide = order.side === "BUY" ? "LONG" : "SHORT";
    let remaining = order.quantity;
    let realised = 0;

    // Reduce (or reduce-only close) an opposite position first.
    if (position && position.side !== orderSide) {
      const qty = Math.min(remaining, position.quantity);
      realised = (position.side === "LONG" ? 1 : -1) * (price - position.entryPrice) * qty;
      position.quantity = round8(position.quantity - qty);
      remaining = round8(remaining - qty);
      if (position.quantity <= 0) {
        await this.store.deletePosition(order.userId, order.symbol);
        position = null;
      } else {
        position.updatedAt = at;
        await this.store.savePosition(position);
      }
    } else if (order.reduceOnly) {
      // Reduce-only with nothing to reduce: cancel, like the exchange.
      order.status = "CANCELLED";
      order.updatedAt = at;
      await this.store.saveOrder(order);
      return;
    }

    // Anything left opens / adds to a position (never for reduce-only orders).
    if (remaining > 0 && !order.reduceOnly) {
      if (position && position.side === orderSide) {
        const total = position.quantity + remaining;
        position.entryPrice = round8((position.entryPrice * position.quantity + price * remaining) / total);
        position.quantity = round8(total);
        position.leverage = order.leverage;
        position.updatedAt = at;
      } else {
        position = { userId: order.userId, symbol: order.symbol, side: orderSide, quantity: round8(remaining), entryPrice: price, leverage: order.leverage, positionId: `paper-pos-${crypto.randomUUID()}`, openedAt: at, updatedAt: at };
      }
      await this.store.savePosition(position);
    }

    const executed = order.reduceOnly ? round8(order.quantity - remaining) : order.quantity;
    const fee = round8(price * executed * feeRate);
    wallet.balance = round8(wallet.balance + realised - fee);
    await this.store.saveWallet(wallet);
    await this.store.addTransaction({ userId: order.userId, symbol: order.symbol, type: "COMMISSION", amount: -fee, orderId: order.orderId, createdAt: at });
    if (realised !== 0) await this.store.addTransaction({ userId: order.userId, symbol: order.symbol, type: "PNL", amount: round8(realised), orderId: order.orderId, createdAt: at });

    order.status = "EXECUTED";
    order.execQuantity = executed;
    order.avgExecutionPrice = price;
    order.executionFee = fee;
    order.realisedPnl = round8(realised);
    order.updatedAt = at;
    await this.store.saveOrder(order);

    if (!(await this.store.listPositions(order.userId)).some((p) => p.symbol === order.symbol)) {
      await this.cancelReduceOnly(order.userId, order.symbol, at);
    }
  }

  private async liquidate(position: PaperPosition, price: number, at: number): Promise<void> {
    const wallet = await this.wallet(position.userId);
    const margin = (position.entryPrice * position.quantity) / position.leverage;
    const loss = -margin;
    wallet.balance = round8(wallet.balance + loss);
    await this.store.saveWallet(wallet);
    await this.store.addTransaction({ userId: position.userId, symbol: position.symbol, type: "PNL", amount: round8(loss), orderId: null, createdAt: at });
    const order: PaperOrder = {
      orderId: `paper-liq-${crypto.randomUUID()}`,
      clientOrderId: null,
      userId: position.userId,
      symbol: position.symbol,
      side: position.side === "LONG" ? "SELL" : "BUY",
      orderType: "MARKET",
      quantity: position.quantity,
      price: null,
      triggerPrice: null,
      reduceOnly: true,
      leverage: position.leverage,
      status: "EXECUTED",
      execQuantity: position.quantity,
      avgExecutionPrice: price,
      executionFee: 0,
      realisedPnl: round8(loss),
      createdAt: at,
      updatedAt: at,
    };
    await this.store.saveOrder(order);
    await this.store.deletePosition(position.userId, position.symbol);
    await this.cancelReduceOnly(position.userId, position.symbol, at);
  }

  private async cancelReduceOnly(userId: number, symbol: string, at: number): Promise<void> {
    for (const o of await this.store.listOrders(userId, { status: "OPEN", symbol })) {
      if (!o.reduceOnly) continue;
      o.status = "CANCELLED";
      o.updatedAt = at;
      await this.store.saveOrder(o);
    }
  }

  // ------------------------------------------------------------------ json --

  private orderJson(o: PaperOrder) {
    return {
      order_id: o.orderId,
      client_order_id: o.clientOrderId,
      symbol: o.symbol,
      side: o.side,
      order_type: o.orderType,
      quantity: o.quantity,
      exec_quantity: o.execQuantity,
      price: o.price,
      trigger_price: o.triggerPrice,
      avg_execution_price: o.avgExecutionPrice,
      execution_fee: o.executionFee,
      realised_pnl: o.realisedPnl,
      reduce_only: o.reduceOnly,
      leverage: o.leverage,
      status: o.status,
      created_at: o.createdAt,
      updated_at: o.updatedAt,
      paper: true,
    };
  }

  private async positionJson(userId: number, p: PaperPosition) {
    const mark = (await this.market.price(userId, p.symbol).catch(() => null)) ?? p.entryPrice;
    const pnl = (p.side === "LONG" ? 1 : -1) * (mark - p.entryPrice) * p.quantity;
    const margin = (p.entryPrice * p.quantity) / p.leverage;
    return {
      symbol: p.symbol,
      side: p.side,
      position_side: p.side,
      quantity: p.quantity,
      position_size: p.quantity,
      entry_price: p.entryPrice,
      avg_entry_price: p.entryPrice,
      mark_price: mark,
      unrealised_pnl: round8(pnl),
      realised_pnl: 0,
      leverage: p.leverage,
      position_id: p.positionId,
      liquidation_price: round8(liquidationPrice(p.side, p.entryPrice, p.leverage)),
      position_margin: round8(margin),
      maint_margin: round8(margin * MMR * p.leverage),
      paper: true,
    };
  }
}

function rank(o: PaperOrder): number {
  return o.orderType === "STOP_MARKET" ? 0 : o.orderType === "MARKET" ? 1 : 2;
}

// ---- production instance ------------------------------------------------------

let instance: PaperExchange | null = null;

/** Real market data through the live client (market endpoints are never routed to paper). */
async function liveMarket(): Promise<PaperMarket> {
  const { coinswitchClient } = await import("@/automation/executor/client");
  const priceCache = new Map<string, { at: number; value: number | null }>();
  const candleCache = new Map<string, { at: number; rows: Candle1m[] }>();
  return {
    async price(userId, symbol) {
      const hit = priceCache.get(symbol);
      if (hit && Date.now() - hit.at < 5_000) return hit.value;
      const value = await coinswitchClient.getCurrentPrice(userId, symbol);
      priceCache.set(symbol, { at: Date.now(), value });
      return value;
    },
    async candles(userId, symbol, sinceMs) {
      const hit = candleCache.get(symbol);
      let rows = hit && Date.now() - hit.at < 20_000 ? hit.rows : null;
      if (!rows) {
        const raw = await coinswitchClient.getKline(userId, symbol, "1", 360, { startTime: Math.max(sinceMs, Date.now() - MAX_LOOKBACK_MS) });
        rows = (raw ?? [])
          .map((k: Record<string, unknown>) => ({ start: Number(k.start_time ?? k.t ?? k.open_time), high: Number(k.h ?? k.high), low: Number(k.l ?? k.low), close: Number(k.c ?? k.close) }))
          .filter((k: Candle1m) => Number.isFinite(k.start) && Number.isFinite(k.high) && Number.isFinite(k.low))
          .sort((a: Candle1m, b: Candle1m) => a.start - b.start);
        candleCache.set(symbol, { at: Date.now(), rows: rows as Candle1m[] });
      }
      return (rows as Candle1m[]).filter((k) => k.start >= sinceMs);
    },
  };
}

export async function paperExchange(): Promise<PaperExchange> {
  if (!instance) instance = new PaperExchange(new MySqlPaperStore(), await liveMarket());
  return instance;
}
