/**
 * INR → USDT conversion helpers for CoinSwitch PRO Spot trading.
 *
 * Deposited INR sits in the user's CoinSwitch exchange (spot) wallet but the
 * automation trades USDT-margined futures. These helpers read the spot wallet,
 * find the live USDT/INR price, place a spot BUY order on the `coinswitchx`
 * INR venue at the current market price, and report what was actually filled.
 *
 * The spot exchange API currently accepts LIMIT orders only, so "buy at market"
 * is implemented as a LIMIT order priced at the best ask, polled until it fills
 * (with a market-order attempt first, dropped to limit automatically if the
 * exchange rejects the `type`).
 */

import { buildSignedRequest } from "./reference-client";
import crypto from "crypto";

export interface CoinSwitchKeys {
  apiKey: string;
  apiSecret: string;
}

export interface SpotHolding {
  currency: string;
  name: string;
  main_balance: number;
  invested_value: number;
  current_value: number;
}

export interface FuturesUsdtBalance {
  total: number;
  available: number;
}

export interface ConversionResult {
  amountInr: number;
  inrSpent: number;
  usdtReceived: number;
  rate: number;
  fee: number | null;
  orderId: string;
  clientOrderId: string;
  status: string;
}

type Signed = { url: string; headers: Record<string, string> };

function isInrHolding(h: SpotHolding): boolean {
  const code = String(h.currency ?? "").trim().toUpperCase().replace(/\.$/, "");
  const name = String(h.name ?? "").toLowerCase();
  return code === "INR" || name.includes("indian rupee");
}

function isUsdtHolding(h: SpotHolding): boolean {
  return String(h.currency ?? "").trim().toUpperCase().replace(/\.$/, "") === "USDT";
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function floorTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(n * f) / f;
}

function ceilTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.ceil(n * f) / f;
}

function firstMessage(body: any): string {
  if (!body || typeof body !== "object") return "";
  return String(body?.message ?? body?.error ?? body?.msg ?? "");
}

/**
 * Execute a signed CoinSwitch request. GET params are embedded in the signed
 * query string; POST/DELETE params are sent as the JSON body.
 */
async function signed<Body = any>(method: "GET" | "POST" | "DELETE", endpoint: string, params: Record<string, any> | undefined, keys: CoinSwitchKeys) {
  const built: Signed = await buildSignedRequest(method, endpoint, params, keys.apiKey, keys.apiSecret);
  const init: RequestInit = { method, headers: built.headers, cache: "no-store" as RequestCache };
  if (method !== "GET" && params) init.body = JSON.stringify(params);
  const res = await fetch(built.url, init);
  const raw = await res.text();
  let body: any = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }
  return { ok: res.ok, status: res.status, body };
}

/** Read the user's spot holdings (INR cash + crypto) from /user/portfolio. */
export async function getSpotHoldings(keys: CoinSwitchKeys): Promise<SpotHolding[]> {
  const { ok, status, body } = await signed("GET", "/user/portfolio", undefined, keys);
  if (!ok) {
    const msg = firstMessage(body);
    throw new CoinSwitchAccessError(status, msg, "Could not read your CoinSwitch wallet balance.");
  }
  const rows = body?.data?.data ?? body?.data ?? [];
  return Array.isArray(rows) ? (rows as SpotHolding[]) : [];
}

export interface ConvertWalletStatus {
  inrAvailable: number;
  usdtSpot: number;
  futuresUsdt: FuturesUsdtBalance | null;
  inrRate: number | null;
  rateSource: string | null;
  /** Minimum single conversion (₹) accepted by CoinSwitch for USDT/INR. */
  minInr: number | null;
  spotAccess: boolean;
  errors?: { spot?: string; futures?: string };
}

export async function getConvertWalletStatus(keys: CoinSwitchKeys): Promise<ConvertWalletStatus> {
  const out: ConvertWalletStatus = {
    inrAvailable: 0,
    usdtSpot: 0,
    futuresUsdt: null,
    inrRate: null,
    rateSource: null,
    minInr: null,
    spotAccess: true,
  };

  const errors: { spot?: string; futures?: string } = {};

  try {
    const holdings = await getSpotHoldings(keys);
    const inr = holdings.find(isInrHolding);
    const usdt = holdings.find(isUsdtHolding);
    out.inrAvailable = inr ? toNumber(inr.main_balance) || 0 : 0;
    out.usdtSpot = usdt ? toNumber(usdt.main_balance) || 0 : 0;
  } catch (error: any) {
    out.spotAccess = false;
    errors.spot = error.message ?? "Spot wallet unavailable";
  }

  try {
    const futures = await getFuturesUsdt(keys);
    out.futuresUsdt = futures;
  } catch (error: any) {
    errors.futures = error.message ?? "Futures wallet unavailable";
  }

  out.errors = errors;

  // Never let the (display) rate failure break the status — it is only used to
  // show an estimate in the UI.
  try {
    const rate = await getInrRate(keys);
    out.inrRate = rate.rate;
    out.rateSource = rate.source;
  } catch {
    out.inrRate = null;
  }

  // Minimum conversion amount for the inline hint — non-fatal if unavailable.
  try {
    const orderInfo = await getUsdtInrOrderInfo(keys);
    out.minInr = orderInfo?.minOrderInr ?? null;
  } catch {
    out.minInr = null;
  }

  return out;
}

/** Futures wallet USDT totals from /futures/wallet_balance. */
export async function getFuturesUsdt(keys: CoinSwitchKeys): Promise<FuturesUsdtBalance | null> {
  const { ok, body } = await signed("GET", "/futures/wallet_balance", undefined, keys);
  if (!ok) throw new Error("Could not read your Futures wallet balance.");
  const balances = body?.data?.base_asset_balances ?? [];
  const usdt = Array.isArray(balances)
    ? (balances as Array<{ base_asset?: string; balances?: Record<string, string | number> }>).find(
        (b) => String(b?.base_asset ?? "").toUpperCase() === "USDT",
      )
    : null;
  const raw = usdt?.balances ?? {};
  return {
    total: toNumber(raw.total_balance) || 0,
    available: toNumber(raw.total_available_balance) || 0,
  };
}

export interface InrRate { rate: number; source: string }

/**
 * Live USDT→INR rate (INR per 1 USDT) — CoinSwitch spot ticker first, then a
 * BTC cross rate, then a public CoinGecko fallback. Mirrors /api/currency/rate.
 */
export async function getInrRate(keys: CoinSwitchKeys): Promise<InrRate> {
  const SPOT_TICKER = "/24hr/all-pairs/ticker";

  function findPair(data: Record<string, any>, base: string, quote: string): number {
    const wantsBase = new Set([base, `${base}USDT`, `USDT${base}`]);
    for (const [key, row] of Object.entries(data)) {
      const norm = key.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      if (!norm.includes(base) || !norm.includes(quote)) continue;
      const price = toNumber(row?.last_price ?? row?.last ?? row?.price);
      if (!Number.isNaN(price)) return price;
    }
    return Number.NaN;
  }

  // 1) Direct USDT/INR from the CoinSwitch spot ticker.
  try {
    const { ok, body } = await signed("GET", `${SPOT_TICKER}?exchange=coinswitchx`, undefined, keys);
    if (ok) {
      const data = body?.data ?? {};
      const direct = findPair(data, "USDT", "INR");
      if (!Number.isNaN(direct)) return { rate: direct, source: "coinswitch" };
    }
  } catch {
    // fall through
  }

  // 2) Cross rate BTC/INR (spot) ÷ BTC/USDT (futures).
  try {
    const [spotRes, futRes] = await Promise.all([
      signed("GET", `${SPOT_TICKER}?exchange=coinswitchx`, undefined, keys),
      signed("GET", "/futures/all-pairs/ticker", { exchange: "EXCHANGE_2" }, keys),
    ]);
    const btcInr = findPair(spotRes.body?.data ?? {}, "BTC", "INR");
    const btcUsdt = findPair(futRes.body?.data ?? {}, "BTC", "USDT");
    if (!Number.isNaN(btcInr) && !Number.isNaN(btcUsdt) && btcUsdt > 0) {
      return { rate: btcInr / btcUsdt, source: "cross" };
    }
  } catch {
    // fall through
  }

  // 3) Live order-book ask (what the conversion will actually pay) — preferred
  // over public-feed prices, which ignore the India crypto premium.
  try {
    const ask = await getUsdtInrBestAsk(keys);
    if (ask != null && ask > 0) return { rate: ask, source: "depth" };
  } catch {
    // fall through
  }

  // 4) Public CoinGecko fallback.
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr", {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Tradenaya/1.0)" },
    });
    if (res.ok) {
      const body = (await res.json()) as { tether?: { inr?: number | string } };
      const cg = toNumber(body?.tether?.inr);
      if (!Number.isNaN(cg) && cg > 0) return { rate: cg, source: "coingecko" };
    }
  } catch {
    // fall through
  }

  throw new Error("Could not fetch the live USDT→INR rate from the exchange.");
}

export interface UsdtInrOrderInfo {
  minOrderInr: number;
  maxOrderInr: number | null;
  basePrecision: number;
  quotePrecision: number;
  limitPrecision: number;
}

/** Min/max order size + price/quantity precision for USDT/INR on coinswitchx. */
export async function getUsdtInrOrderInfo(keys: CoinSwitchKeys): Promise<UsdtInrOrderInfo | null> {
  const info: UsdtInrOrderInfo = {
    minOrderInr: 100,
    maxOrderInr: null,
    basePrecision: 6,
    quotePrecision: 2,
    limitPrecision: 0,
  };
  try {
    const { ok, body } = await signed("GET", "/tradeInfo", { exchange: "coinswitchx", symbol: "USDT/INR" }, keys);
    if (!ok) return info;
    const byExchange = body?.data ?? {};
    for (const exchangeData of Object.values(byExchange) as any[]) {
      const row = exchangeData?.["USDT/INR"] ?? exchangeData?.USDTINR;
      if (!row) continue;
      const quote = row.quote ?? {};
      const precision = row.precision ?? {};
      const min = toNumber(quote.min);
      const max = toNumber(quote.max);
      const baseP = toNumber(precision.base);
      const quoteP = toNumber(precision.quote);
      const limitP = toNumber(precision.limit);
      if (!Number.isNaN(min) && min > 0) info.minOrderInr = min;
      if (!Number.isNaN(max) && max > 0) info.maxOrderInr = max;
      if (!Number.isNaN(baseP)) info.basePrecision = baseP;
      if (!Number.isNaN(quoteP)) info.quotePrecision = quoteP;
      if (!Number.isNaN(limitP)) info.limitPrecision = limitP;
      break;
    }
  } catch {
    // defaults stand
  }
  return info;
}

/** Lowest ask price for USDT/INR — the effective market buy price for a buyer. */
export async function getUsdtInrBestAsk(keys: CoinSwitchKeys): Promise<number | null> {
  try {
    const { ok, body } = await signed("GET", "/depth", { exchange: "coinswitchx", symbol: "USDT/INR", limit: 5 }, keys);
    if (!ok) return null;
    const data = body?.data ?? body;
    const asks: unknown[] = Array.isArray(data?.asks) ? data.asks : Array.isArray(data?.data?.asks) ? data.data.asks : [];
    const prices = asks
      .map((row: any) => (Array.isArray(row) ? toNumber(row[0]) : toNumber(row?.price)))
      .filter((p) => Number.isFinite(p) && p > 0) as number[];
    if (prices.length === 0) return null;
    return Math.min(...prices);
  } catch {
    return null;
  }
}

export interface SpotOrderLike {
  order_id?: string;
  client_order_id?: string;
  status?: string;
  executed_qty?: string | number;
  average_price?: string | number;
  avg_price?: string | number;
  execution_fee?: string | number;
  fee?: string | number;
  fees?: string | number;
}

async function placeSpotOrder(keys: CoinSwitchKeys, body: Record<string, any>): Promise<{ ok: boolean; status: number; body: any; order: SpotOrderLike | null }> {
  const result = await signed("POST", "/order", body, keys);
  return { ...result, order: (result.body?.data ?? result.body) as SpotOrderLike | null };
}

async function getSpotOrderById(keys: CoinSwitchKeys, orderId: string): Promise<SpotOrderLike | null> {
  try {
    const { ok, body } = await signed("GET", "/order", { order_id: orderId }, keys);
    if (!ok) return null;
    return (body?.data ?? body) as SpotOrderLike;
  } catch {
    return null;
  }
}

async function cancelSpotOrderById(keys: CoinSwitchKeys, orderId: string): Promise<void> {
  try {
    await signed("DELETE", "/order", { order_id: orderId }, keys);
  } catch {
    // best-effort cancel — the order will expire on its own TTL otherwise
  }
}

const FILLED_LIKE = /executed|filled|complete|done|success/i;
const CLOSED_LIKE = /cancel|expire|reject|fail|insufficient|error/i;

/**
 * Poll a spot order until it fills (success) or reaches a terminal state.
 * Returns the executed quantity, average fill price and status.
 */
async function waitForFill(keys: CoinSwitchKeys, orderId: string, timeoutMs = 14_000, intervalMs = 1_500): Promise<{ executed: number; rate: number; fee: number | null; status: string; stillOpen: boolean }> {
  const started = Date.now();
  let lastOrder: SpotOrderLike | null = null;

  while (Date.now() - started < timeoutMs) {
    lastOrder = await getSpotOrderById(keys, orderId);
    if (lastOrder) {
      const status = String(lastOrder.status ?? "");
      const executed = toNumber(lastOrder.executed_qty) || 0;
      if (executed > 0) {
        return {
          executed,
          rate: toNumber(lastOrder.average_price ?? lastOrder.avg_price) || 0,
          fee: toNumber(lastOrder.execution_fee ?? lastOrder.fee ?? lastOrder.fees) || null,
          status: status || "EXECUTED",
          stillOpen: false,
        };
      }
      if (CLOSED_LIKE.test(status)) {
        return { executed: 0, rate: 0, fee: null, status: status || "CLOSED", stillOpen: false };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  lastOrder = lastOrder ?? (await getSpotOrderById(keys, orderId));
  if (lastOrder) {
    const executed = toNumber(lastOrder.executed_qty) || 0;
    if (executed > 0) {
      return {
        executed,
        rate: toNumber(lastOrder.average_price ?? lastOrder.avg_price) || 0,
        fee: toNumber(lastOrder.execution_fee ?? lastOrder.fee ?? lastOrder.fees) || null,
        status: String(lastOrder.status ?? "PARTIALLY_EXECUTED"),
        stillOpen: false,
      };
    }
    const status = String(lastOrder.status ?? "");
    if (!FILLED_LIKE.test(status)) {
      await cancelSpotOrderById(keys, orderId);
      return { executed: 0, rate: 0, fee: null, status: status || "OPEN", stillOpen: false };
    }
  }

  return { executed: 0, rate: 0, fee: null, status: "TIMEOUT", stillOpen: true };
}

/**
 * Convert an INR amount into USDT via a spot market buy on CoinSwitch.
 * Throws a human-readable Error on any failure (insufficient balance, no spot
 * access, min amount, price moved before fill, ...).
 */
export async function convertInrToUsdt(keys: CoinSwitchKeys, amountInr: number): Promise<ConversionResult> {
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    throw new Error("Enter an amount greater than zero.");
  }

  const holdings = await getSpotHoldings(keys);
  const inrHolding = holdings.find(isInrHolding);
  const inrAvailable = inrHolding ? toNumber(inrHolding.main_balance) || 0 : 0;
  if (amountInr > inrAvailable + 0.0001) {
    throw new Error(
      `Insufficient INR balance — you are converting ₹${amountInr.toLocaleString("en-IN")} but your CoinSwitch wallet has ₹${inrAvailable.toLocaleString("en-IN", { maximumFractionDigits: 2 })} in INR.`,
    );
  }

  const orderInfo = (await getUsdtInrOrderInfo(keys)) ?? null;
  const minOrderInr = orderInfo?.minOrderInr ?? 100;
  if (amountInr < minOrderInr) {
    throw new Error(`The minimum conversion amount on CoinSwitch is ₹${minOrderInr.toLocaleString("en-IN")}.`);
  }
  const maxOrderInr = orderInfo?.maxOrderInr ?? null;
  if (maxOrderInr != null && amountInr > maxOrderInr) {
    throw new Error(`One conversion order is capped at ₹${maxOrderInr.toLocaleString("en-IN")} on CoinSwitch. Try a smaller amount.`);
  }
  const basePrecision = orderInfo?.basePrecision ?? 6;
  const quotePrecision = orderInfo?.quotePrecision ?? 2;

  const placeData = (ask: number): { price: number; quantity: number } | Error => {
    const price = ceilTo(ask, quotePrecision);
    if (!Number.isFinite(price) || price <= 0) return new Error("Could not determine the current USDT price.");
    const quantity = floorTo(amountInr / price, basePrecision);
    if (quantity <= 0) return new Error("The amount is too small at the current USDT price. Try a bigger amount.");
    return { price, quantity };
  };

  let ask = await getUsdtInrBestAsk(keys);
  if (ask == null) throw new Error("Could not fetch the current USDT price from the exchange. Please try again.");
  let sized = placeData(ask);
  if (sized instanceof Error) throw sized;

  const clientOrderId = crypto.randomUUID();
  let placed: { ok: boolean; status: number; body: any; order: SpotOrderLike | null };
  let orderId = "";

  const marketBody = {
    side: "buy",
    symbol: "USDT/INR",
    type: "market",
    quantity: sized.quantity,
    exchange: "coinswitchx",
    client_order_id: clientOrderId,
    expiry_period: 60,
  };

  placed = await placeSpotOrder(keys, marketBody);

  if (!placed.ok) {
    const msg = firstMessage(placed.body);
    // The spot endpoint currently accepts LIMIT orders only — drop to a limit
    // order priced at the freshly-quoted ask when the exchange rejects `type`.
    if (/type|market/i.test(msg)) {
      ask = await getUsdtInrBestAsk(keys);
      if (ask == null) throw new Error("Could not re-quote the USDT price. Please try again.");
      sized = placeData(ask);
      if (sized instanceof Error) throw sized;
      placed = await placeSpotOrder(keys, {
        ...marketBody,
        type: "limit",
        price: sized.price,
        // A limit buy is intentionally slightly above the last trade so it
        // fills at the ask instead of sitting unfilled.
        expiry_period: 60,
      });
    }
  }

  if (!placed.ok) {
    const msg = firstMessage(placed.body);
    if (/\binvalid access\b/i.test(msg)) {
      throw new Error(
        "Your CoinSwitch API key does not have Spot (INR) trading permission. Enable Spot trading in CoinSwitch PRO → API Trading → Permissions, or reconnect with a key that has spot access.",
      );
    }
    if (/insufficient|balance|amount/i.test(msg)) {
      throw new Error(`The exchange rejected the order: ${msg}`);
    }
    throw new Error(msg ? `CoinSwitch rejected the order: ${msg}` : "CoinSwitch rejected the order. Please try again.");
  }

  orderId = placed.order?.order_id ?? "";
  if (!orderId) throw new Error("The exchange did not return an order ID. Please try again.");

  const fill = await waitForFill(keys, orderId);

  if (fill.executed <= 0) {
    throw new Error("Your INR→USDT conversion didn't fill at the current market price — no money was moved. Please try again.")
  }

  const rate = fill.rate > 0 ? fill.rate : ask;
  const inrSpent = fill.executed * rate;

  return {
    amountInr,
    inrSpent,
    usdtReceived: fill.executed,
    rate,
    fee: fill.fee,
    orderId,
    clientOrderId,
    status: fill.status,
  };
}

/** Error wrapper that keeps the HTTP status around for the route handler. */
export class CoinSwitchAccessError extends Error {
  status: number;
  constructor(status: number, rawMessage: string, fallback: string) {
    const message = /\binvalid access\b/i.test(rawMessage)
      ? "Your CoinSwitch API key does not have Spot (INR) access. Enable Spot trading in CoinSwitch PRO → API Trading → Permissions, or reconnect with a key that includes spot permission."
      : rawMessage || fallback;
    super(message);
    this.status = status;
    this.name = "CoinSwitchAccessError";
  }
}