import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { getKeysForUser } from "@/lib/coinswitch.store";
import { isUuid } from "./order-id";

function extractErrorMessage(data: any): string {
  if (typeof data === "string") return data;
  if (data?.message) return String(data.message);
  if (data?.error) return String(data.error);
  if (data?.errorMessage) return String(data.errorMessage);
  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    const first = data.errors[0];
    if (typeof first === "string") return first;
    if (first?.message) return String(first.message);
  }
  try {
    return JSON.stringify(data);
  } catch {
    return "CoinSwitch API error";
  }
}

function toNumberFallback(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function txTypeOf(t: any): string {
  const fields = [t.amount, t.pnl, t.fee, t.commission, t.change];
  const has = (k: string) => t[k] != null && t[k] !== "";
  if (has("funding_rate") || String(t.type ?? "").toLowerCase().includes("fund")) return "FUNDING_FEE";
  if (has("commission") || has("fee") || String(t.type ?? "").toLowerCase().includes("commission")) return "COMMISSION";
  return "P&L";
}

/**
 * Normalize a transaction "type" filter to CoinSwitch's strict uppercase enum
 * (PNL / COMMISSION / FUNDING_FEE). Callers historically pass display labels
 * like "P&L", "commission", and "funding fee"; sending those raw makes the API
 * answer 500 with an invalid-enum error.
 */
function normalizeTransactionType(type: string): string {
  const upper = String(type).trim().toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (upper === "PNL" || upper === "PL" || upper === "P" || upper === "R_L" || upper === "RL") return "PNL";
  if (upper === "FUNDING" || upper === "FUNDING_FEE" || upper === "FEE") return "FUNDING_FEE";
  if (upper === "COMMISSION" || upper === "FEES") return "COMMISSION";
  return upper;
}


export interface PlaceOrderParams {
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "TAKE_PROFIT_MARKET" | "STOP_MARKET";
  quantity: number;
  price?: number;
  triggerPrice?: number;
  reduceOnly?: boolean;
  timeInForce?: "GTC" | "IOC" | "FOK";
  clientOrderId?: string;
}

export interface ExchangeOrder {
  orderId: string | null;
  clientOrderId: string | null;
  status: string | null;
  raw: any;
}

export interface ExchangePosition {
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  leverage: number | null;
  positionId: string | null;
  liquidationPrice: number | null;
}

export interface FuturesTransaction {
  type: "FUNDING_FEE" | "COMMISSION" | "P&L" | "LIQUIDATION_FEE" | "ADD_MARGIN" | string;
  symbol: string;
  amount: number;
  fee: number | null;
  timestamp: number;
  orderId: string | null;
  raw: any;
}

export interface CoinSwitchClientOptions {
  requestTimeoutMs?: number;
  // Min spacing enforced between consecutive calls on the same endpoint bucket.
  // CoinSwitch caps per endpoint per key (e.g. 20/60s), so we pace below it.
  rateLimitOverrides?: Record<string, number>;
}

const DEFAULT_RATE_LIMITS: Record<string, number> = {
  place: 3300, // Place Order 20/60s -> ~18/min
  cancel: 6500, // Cancel Order 10/60s -> ~9/min
  status: 3300, // Get Order Status 20/60s -> ~18/min
  leverage: 6500, // Update Leverage 10/60s -> ~9/min
  positions: 3300, // Get Positions 20/60s -> ~18/min
  open_orders: 3300, // Open Orders 20/60s -> ~18/min
  wallet: 3300, // Get Wallet Balance 20/60s -> ~18/min
  instrument: 750, // Instrument Info 100/60s -> ~80/min
  klines: 2200, // Klines 30/60s -> ~27/min
  ticker: 750, // Ticker 100/60s -> ~80/min
  transactions: 3300, // Transactions 20/60s -> ~18/min
};

function rateBudget(method: "GET" | "POST" | "DELETE", endpoint: string): { key: string; intervalMs: number } | null {
  switch (endpoint) {
    case "/futures/order":
      if (method === "POST") return { key: "place", intervalMs: 3300 };
      if (method === "DELETE") return { key: "cancel", intervalMs: 6500 };
      return { key: "status", intervalMs: 3300 };
    case "/futures/leverage":
      return { key: "leverage", intervalMs: 6500 };
    case "/futures/positions":
      return { key: "positions", intervalMs: 3300 };
    case "/futures/orders/open":
      return { key: "open_orders", intervalMs: 3300 };
    case "/futures/wallet_balance":
      return { key: "wallet", intervalMs: 3300 };
    case "/futures/instrument_info":
      return { key: "instrument", intervalMs: 750 };
    case "/futures/klines":
      return { key: "klines", intervalMs: 2200 };
    case "/futures/all-pairs/ticker":
      return { key: "ticker", intervalMs: 750 };
    case "/futures/transactions":
      return { key: "transactions", intervalMs: 3300 };
    default:
      return null;
  }
}

/**
 * Paces calls per endpoint bucket to stay within CoinSwitch's per-key,
 * per-endpoint rate limits (Place 20/60s, Status 20/60s, Cancel 10/60s,
 * Leverage 10/60s, Positions/OpenOrders/Wallet 20/60s, Instrument/Ticker
 * 100/60s, Klines 30/60s).
 */
class RateLimiter {
  private nextSlot = new Map<string, number>();

  async wait(bucket: { key: string; intervalMs: number }) {
    const now = Date.now();
    const prev = this.nextSlot.get(bucket.key) ?? 0;
    const slot = Math.max(now, prev + bucket.intervalMs);
    const delay = slot - now;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    // Take this slot so the next call on this bucket waits a full interval.
    this.nextSlot.set(bucket.key, Math.max(slot, Date.now()));
  }
}

const rateLimiter = new RateLimiter();

export class CoinSwitchClient {
  constructor(private readonly options: CoinSwitchClientOptions = {}) {}

  private async call(
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    params: Record<string, any>,
    userId: number,
  ) {
    const budget = rateBudget(method, endpoint);
    if (budget) {
      const intervalMs = this.options.rateLimitOverrides?.[budget.key] ?? budget.intervalMs;
      await rateLimiter.wait({ key: budget.key, intervalMs });
    }

    const keys = await getKeysForUser(userId);
    if (!keys || keys.status !== "A") {
      throw new Error("CoinSwitch credentials are missing or inactive. Please reconnect your account.");
    }

    const { url, headers } = await buildSignedRequest(method, endpoint, params, keys.apiKey, keys.apiSecret);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.requestTimeoutMs ?? 15000,
    );

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: method === "GET" ? undefined : JSON.stringify(params),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        const message = extractErrorMessage(data);
        throw new Error(message);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async placeOrder(userId: number, params: PlaceOrderParams): Promise<ExchangeOrder> {
    const clientOrderIdValue = params.clientOrderId ?? crypto.randomUUID();
    if (!isUuid(clientOrderIdValue)) {
      throw new Error(`client_order_id must be a UUID, got: ${clientOrderIdValue}`);
    }
    const payload: Record<string, any> = {
      exchange: "EXCHANGE_2",
      symbol: params.symbol.toLowerCase(),
      side: params.side,
      order_type: params.orderType,
      quantity: params.quantity,
      reduce_only: params.reduceOnly ?? false,
      time_in_force: params.timeInForce ?? "GTC",
      client_order_id: clientOrderIdValue,
    };
    if (params.price !== undefined) payload.price = params.price;
    if (params.triggerPrice !== undefined) payload.trigger_price = params.triggerPrice;

    const data = await this.call("POST", "/futures/order", payload, userId);
    const order = data?.data ?? data;
    return {
      orderId: order?.order_id ?? null,
      clientOrderId: order?.client_order_id ?? params.clientOrderId ?? null,
      status: order?.status ?? null,
      raw: order,
    };
  }

  async cancelOrder(userId: number, orderId: string): Promise<boolean> {
    await this.call("DELETE", "/futures/order", { order_id: orderId, exchange: "EXCHANGE_2" }, userId);
    return true;
  }

  /** Set per-symbol leverage on the futures account. Required before the first order on a symbol. */
  async setLeverage(userId: number, symbol: string, leverage: number): Promise<{ symbol: string; leverage: number }> {
    const data = await this.call(
      "POST",
      "/futures/leverage",
      { exchange: "EXCHANGE_2", symbol: symbol.toLowerCase(), leverage: Math.round(leverage) },
      userId,
    );
    const result = data?.data ?? data;
    return {
      symbol: String(result?.symbol ?? symbol),
      leverage: Number(result?.leverage ?? leverage),
    };
  }

  async getOrderStatus(userId: number, orderId: string): Promise<ExchangeOrder> {
    const data = await this.call("GET", "/futures/order", { order_id: orderId, exchange: "EXCHANGE_2" }, userId);
    const order = data?.data?.order ?? data?.data ?? data;
    return {
      orderId: order?.order_id ?? null,
      clientOrderId: order?.client_order_id ?? null,
      status: order?.status ?? null,
      raw: order,
    };
  }

  async getPositions(userId: number, symbol?: string): Promise<ExchangePosition[]> {
    const params: Record<string, any> = { exchange: "EXCHANGE_2" };
    if (symbol) params.symbol = symbol.toLowerCase();
    const data = await this.call("GET", "/futures/positions", params, userId);
    const rows = this.extractList(data);
    return rows.map((p: any) => ({
      symbol: p.symbol ?? symbol,
      side: p.side ?? p.position_side ?? null,
      quantity: Number(p.quantity ?? p.size ?? p.position_size ?? 0),
      entryPrice: Number(p.entry_price ?? p.avg_entry_price ?? null) || null,
      markPrice: Number(p.mark_price ?? null) || null,
      unrealizedPnl: Number(p.unrealised_pnl ?? p.unrealized_pnl ?? p.pnl ?? null) || null,
      realizedPnl: Number(p.realised_pnl ?? p.realized_pnl ?? null) || null,
      leverage: Number(p.leverage ?? null) || null,
      positionId: p.position_id ?? null,
      liquidationPrice: Number(p.liquidation_price ?? null) || null,
    }));
  }

  async getOpenOrders(userId: number, symbol?: string): Promise<ExchangeOrder[]> {
    const params: Record<string, any> = { exchange: "EXCHANGE_2" };
    if (symbol) params.symbol = symbol.toLowerCase();
    const data = await this.call("POST", "/futures/orders/open", params, userId);
    const rows = this.extractList(data);
    return rows.map((o: any) => ({
      orderId: o.order_id ?? null,
      clientOrderId: o.client_order_id ?? null,
      status: o.status ?? null,
      raw: o,
    }));
  }

  /**
   * Fetch balance-affecting account transactions (commission, funding fee,
   * P&L, liquidation fee). Used to reconcile a closed trade's true costs:
   * actual entry+exit commissions and funding accrued while it was open.
   */
  async getTransactions(
    userId: number,
    opts: { symbol?: string; type?: string; fromTime?: number; toTime?: number; limit?: number } = {},
  ): Promise<FuturesTransaction[]> {
    const params: Record<string, any> = { exchange: "EXCHANGE_2" };
    if (opts.symbol) params.symbol = opts.symbol.toLowerCase();
    // CoinSwitch's transaction "type" is a strict uppercase enum
    // (PNL/COMMISSION/FUNDING_FEE) while the app historically used display
    // labels ("P&L", "commission", "funding fee") which the API rejects with a
    // 500, so normalize to the enum values here.
    if (opts.type) params.type = normalizeTransactionType(opts.type);
    // The transactions endpoint rejects from_time/to_time/limit — the only
    // time-window params it accepts are start_time/end_time.
    if (opts.fromTime != null) params.start_time = opts.fromTime;
    if (opts.toTime != null) params.end_time = opts.toTime;
    const data = await this.call("GET", "/futures/transactions", params, userId);
    const rows: any[] = this.extractList(data);
    return rows.map((t: any) => {
      const sym = String(t.symbol ?? t.s ?? "").toUpperCase();
      return {
        type: String(t.type ?? txTypeOf(t)).toUpperCase(),
        symbol: sym,
        amount: toNumberFallback(t.amount ?? t.value ?? t.pnl ?? t.fee ?? 0),
        fee: t.fee != null ? toNumberFallback(t.fee) : null,
        timestamp:
          Number(t.timestamp ?? t.created_at ?? t.time ?? t.transaction_time ?? 0) ||
          (t.created_at ? new Date(t.created_at).getTime() : 0),
        orderId: t.order_id ?? t.orderId ?? t.client_order_id ?? null,
        raw: t,
      };
    });
  }

  async getCurrentPrice(userId: number, symbol: string): Promise<number | null> {
    const ticker = await this.getTicker(userId, symbol);
    const price = Number(ticker?.c ?? ticker?.last ?? ticker?.close ?? ticker?.last_price ?? null);
    return Number.isFinite(price) && price > 0 ? price : null;
  }

  /** Fetch the full futures ticker row for one symbol (market-wide, not account-specific). */
  async getTicker(userId: number, symbol: string): Promise<Record<string, any> | null> {
    const data = await this.call("GET", "/futures/all-pairs/ticker", { exchange: "EXCHANGE_2" }, userId);
    const target = String(symbol ?? "").toLowerCase();

    const rows = this.extractList(data);
    const ticker = rows.find((t: any) => {
      const sym = String(t.s ?? t.symbol ?? t.pair ?? "").toLowerCase();
      return sym === target;
    });
    if (ticker) return ticker;

    // The ticker endpoint returns a symbol-keyed map: { data: { BTCUSDT: {...}, ... } }
    const map = data?.data ?? data;
    if (map && typeof map === "object" && !Array.isArray(map)) {
      const direct = map[target] ?? map[String(symbol ?? "").toUpperCase()];
      if (direct && typeof direct === "object") return direct;
    }
    return null;
  }

  async getKline(userId: number, symbol: string, interval: string, limit = 100, options?: { startTime?: number; endTime?: number }): Promise<any[]> {
    const params: Record<string, any> = { exchange: "EXCHANGE_2", symbol: symbol.toLowerCase(), interval, limit };
    if (options?.startTime !== undefined) params.start_time = options.startTime;
    if (options?.endTime !== undefined) params.end_time = options.endTime;
    const data = await this.call("GET", "/futures/klines", params, userId);
    const rows = this.extractList(data);
    return rows;
  }

  async getWalletBalance(userId: number): Promise<number | null> {
    const data = await this.call("GET", "/futures/wallet_balance", { exchange: "EXCHANGE_2" }, userId);
    const raw = data?.data ?? data;
    const usdt = Array.isArray(raw?.base_asset_balances)
      ? raw.base_asset_balances.find((b: any) => String(b?.base_asset).toUpperCase() === "USDT")
      : null;
    const balances = usdt?.balances ?? raw ?? {};
    const balance = Number(
      balances?.total_available_balance ??
        balances?.available_balance ??
        balances?.total_balance ??
        balances?.balance ??
        balances?.equity ??
        null,
    );
    return Number.isFinite(balance) ? balance : null;
  }

  /** Fetch instrument info (min/max leverage, quantity rules) for one symbol. */
  async getInstrumentInfo(userId: number, symbol: string): Promise<Record<string, any> | null> {
    const data = await this.call("GET", "/futures/instrument_info", { exchange: "EXCHANGE_2" }, userId);
    const map = data?.data ?? data ?? {};
    const target = String(symbol ?? "").toUpperCase();
    const instrument = map[target] ?? map[target.toLowerCase()] ?? null;
    return instrument ?? null;
  }

  private extractList(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.data?.positions)) return data.data.positions;
    if (Array.isArray(data?.data?.orders)) return data.data.orders;
    return [];
  }
}

export const coinswitchClient = new CoinSwitchClient();
