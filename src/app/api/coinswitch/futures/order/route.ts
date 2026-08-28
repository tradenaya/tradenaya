import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";
import { db } from "@/lib/db";
import { getCustomerFromRequest } from "@/lib/auth";

interface PlaceOrderBody {
  symbol: string;
  side: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT" | "TAKE_PROFIT_MARKET" | "STOP_MARKET";
  quantity?: number;
  price?: number;
  trigger_price?: number;
  reduce_only?: boolean;
  time_in_force?: "GTC" | "IOC" | "FOK";
  client_order_id?: string;
  order_context?: "entry" | "stop_loss" | "take_profit" | "close_position";
  user_code?: string;
  replace_existing?: boolean;
  existing_order_id?: string;
}

const ORDER_TYPES = new Set(["MARKET", "LIMIT", "TAKE_PROFIT_MARKET", "STOP_MARKET"]);
const SIDES = new Set(["BUY", "SELL"]);
const TIME_IN_FORCE = new Set(["GTC", "IOC", "FOK"]);

async function ensureFuturesOrdersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS futures_orders_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NULL,
      user_email VARCHAR(255) NULL,
      user_code VARCHAR(100) NULL,
      symbol VARCHAR(50) NOT NULL,
      side VARCHAR(10) NOT NULL,
      order_type VARCHAR(30) NOT NULL,
      order_context VARCHAR(30) NOT NULL DEFAULT 'entry',
      quantity DECIMAL(18, 8) NULL,
      price DECIMAL(18, 8) NULL,
      trigger_price DECIMAL(18, 8) NULL,
      reduce_only TINYINT(1) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL,
      exchange_order_id VARCHAR(255) NULL,
      client_order_id VARCHAR(255) NULL,
      response_status VARCHAR(50) NULL,
      message TEXT NULL,
      amount_used DECIMAL(18, 8) NULL,
      avg_execution_price DECIMAL(18, 8) NULL,
      execution_fee DECIMAL(18, 8) NULL,
      pnl DECIMAL(18, 8) NULL,
      realized_pnl DECIMAL(18, 8) NULL,
      is_profit TINYINT(1) NULL,
      raw_response JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_symbol_created (user_id, symbol, created_at),
      KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'futures_orders_history';`,
  );
  const existing = new Set((rows as Array<{ COLUMN_NAME: string }>).map((row) => row.COLUMN_NAME));
  for (const [name, definition] of [
    ["avg_execution_price", "DECIMAL(18, 8) NULL"],
    ["execution_fee", "DECIMAL(18, 8) NULL"],
  ] as Array<[string, string]>) {
    if (!existing.has(name)) {
      await db.query(`ALTER TABLE futures_orders_history ADD COLUMN ${name} ${definition};`);
    }
  }
}

async function saveFuturesOrderRecord(payload: {
  userId: number | null;
  userEmail: string | null;
  userCode: string | null;
  symbol: string;
  side: string;
  orderType: string;
  orderContext: string;
  quantity: number | null;
  price: number | null;
  triggerPrice: number | null;
  reduceOnly: boolean;
  status: string;
  exchangeOrderId: string | null;
  clientOrderId: string | null;
  responseStatus: string | null;
  message: string | null;
  amountUsed: number | null;
  avgExecutionPrice: number | null;
  executionFee: number | null;
  realizedPnl: number | null;
  rawResponse: string | null;
}) {
  await ensureFuturesOrdersTable();

  const pnl = payload.realizedPnl != null ? payload.realizedPnl : null;
  const isProfit = pnl != null ? (pnl >= 0 ? 1 : 0) : null;

  await db.query(
    `INSERT INTO futures_orders_history (
      user_id,
      user_email,
      user_code,
      symbol,
      side,
      order_type,
      order_context,
      quantity,
      price,
      trigger_price,
      reduce_only,
      status,
      exchange_order_id,
      client_order_id,
      response_status,
      message,
      amount_used,
      avg_execution_price,
      execution_fee,
      pnl,
      realized_pnl,
      is_profit,
      raw_response
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      payload.userId,
      payload.userEmail,
      payload.userCode,
      payload.symbol,
      payload.side,
      payload.orderType,
      payload.orderContext,
      payload.quantity ?? null,
      payload.price ?? null,
      payload.triggerPrice ?? null,
      payload.reduceOnly ? 1 : 0,
      payload.status,
      payload.exchangeOrderId,
      payload.clientOrderId,
      payload.responseStatus,
      payload.message,
      payload.amountUsed ?? null,
      payload.avgExecutionPrice ?? null,
      payload.executionFee ?? null,
      pnl,
      pnl,
      isProfit,
      payload.rawResponse,
    ]
  );
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readableExchangeError(data: unknown): string {
  if (!data || typeof data !== "object") return "Order rejected by the exchange";
  const obj = data as Record<string, any>;
  const msg = obj.message ?? obj.error ?? obj.msg;
  if (typeof msg === "string" && msg) return msg;
  const reason = obj.data?.message ?? obj.data?.error;
  if (typeof reason === "string" && reason) return reason;
  return "Order rejected by the exchange";
}

async function cancelExistingOrder(req: NextRequest, orderId: string) {
  const keys = await getKeysFromRequest(req);
  const { url, headers } = await buildSignedRequest(
    "DELETE",
    "/futures/order",
    { order_id: orderId, exchange: "EXCHANGE_2" },
    keys?.apiKey,
    keys?.apiSecret,
  );
  const res = await fetch(url, { method: "DELETE", headers });
  return res.ok;
}

export async function POST(req: NextRequest) {
  let customer;
  try {
    customer = getCustomerFromRequest(req);
  } catch {
    customer = null;
  }

  let body: PlaceOrderBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = String(body.symbol ?? "").trim();
  if (!symbol) {
    return NextResponse.json({ success: false, message: "symbol is required" }, { status: 400 });
  }
  if (!SIDES.has(body.side)) {
    return NextResponse.json({ success: false, message: "side must be BUY or SELL" }, { status: 400 });
  }
  if (!ORDER_TYPES.has(body.order_type)) {
    return NextResponse.json(
      { success: false, message: "order_type must be MARKET, LIMIT, TAKE_PROFIT_MARKET, or STOP_MARKET" },
      { status: 400 },
    );
  }
  if (body.time_in_force && !TIME_IN_FORCE.has(body.time_in_force)) {
    return NextResponse.json({ success: false, message: "time_in_force must be GTC, IOC, or FOK" }, { status: 400 });
  }

  const quantity = toNumber(body.quantity);
  const price = toNumber(body.price);
  const triggerPrice = toNumber(body.trigger_price);

  if (body.order_type === "TAKE_PROFIT_MARKET" || body.order_type === "STOP_MARKET") {
    // Per the CoinSwitch futures contract: STOP_MARKET/TAKE_PROFIT_MARKET apply
    // to the full position and MUST carry quantity 0. A non-zero quantity is
    // a client bug — reject it rather than forward it.
    if (quantity != null && quantity > 0) {
      return NextResponse.json(
        { success: false, message: "quantity must be 0 for TP/SL orders (they apply to the full position)" },
        { status: 400 },
      );
    }
    if (triggerPrice == null || triggerPrice <= 0) {
      return NextResponse.json(
        { success: false, message: "trigger_price must be a positive number for TP/SL orders" },
        { status: 400 },
      );
    }
  } else {
    if (quantity == null || quantity <= 0) {
      return NextResponse.json(
        { success: false, message: "quantity must be a positive number for MARKET/LIMIT orders" },
        { status: 400 },
      );
    }
    if (body.order_type === "LIMIT" && (price == null || price <= 0)) {
      return NextResponse.json({ success: false, message: "price must be a positive number for LIMIT orders" }, { status: 400 });
    }
  }

  const keys = await getKeysFromRequest(req);
  if (!keys) {
    return NextResponse.json(
      { success: false, message: "Not authenticated — please sign in and reconnect your CoinSwitch account." },
      { status: 401 },
    );
  }

  // replace_existing => cancel the old protective order first so we never end
  // up with a duplicate SL/TP stacked on the same position.
  if (body.replace_existing && body.existing_order_id) {
    try {
      await cancelExistingOrder(req, body.existing_order_id);
    } catch {
      return NextResponse.json(
        { success: false, message: "Failed to cancel the existing protective order before replacing it" },
        { status: 409 },
      );
    }
  }

  try {
    const clientOrderId = body.client_order_id ?? crypto.randomUUID();
    const orderContext =
      body.order_context ??
      (body.order_type === "STOP_MARKET" ? "stop_loss" : body.order_type === "TAKE_PROFIT_MARKET" ? "take_profit" : "entry");
    const isProtective = body.order_type === "STOP_MARKET" || body.order_type === "TAKE_PROFIT_MARKET";

    const orderPayload: Record<string, any> = {
      exchange: "EXCHANGE_2",
      symbol: symbol.toLowerCase(),
      side: body.side,
      order_type: body.order_type,
      quantity: isProtective ? 0 : quantity,
      reduce_only: isProtective ? true : (body.reduce_only ?? false),
      time_in_force: body.time_in_force ?? "GTC",
      client_order_id: clientOrderId,
    };

    if (body.order_type === "LIMIT" && price != null) orderPayload.price = price;
    if (isProtective && triggerPrice != null) orderPayload.trigger_price = triggerPrice;

    const { url, headers } = await buildSignedRequest("POST", "/futures/order", orderPayload, keys.apiKey, keys.apiSecret);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(orderPayload),
    });

    const rawText = await res.text();
    let data: any = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { raw: rawText };
    }
    const exchangeOrder = data?.data ?? data;
    const responseStatus = exchangeOrder?.status ?? null;

    const notional = quantity != null ? (price ?? triggerPrice ?? 0) * quantity : null;

    await saveFuturesOrderRecord({
      userId: customer?.customerId ?? null,
      userEmail: customer?.email ?? null,
      userCode: body.user_code ?? (customer ? `CUS-${customer.customerId}` : null),
      symbol: symbol.toLowerCase(),
      side: body.side,
      orderType: body.order_type,
      orderContext,
      quantity: isProtective ? 0 : quantity,
      price: price ?? null,
      triggerPrice: isProtective ? triggerPrice ?? null : null,
      reduceOnly: isProtective ? true : (body.reduce_only ?? false),
      status: res.ok ? (responseStatus ?? "PENDING") : "FAILED",
      exchangeOrderId: exchangeOrder?.order_id ?? null,
      clientOrderId,
      responseStatus,
      message: res.ok ? null : readableExchangeError(data),
      amountUsed: notional,
      avgExecutionPrice: toNumber(exchangeOrder?.avg_execution_price ?? exchangeOrder?.avg_price),
      executionFee: toNumber(exchangeOrder?.execution_fee ?? exchangeOrder?.fee),
      realizedPnl: toNumber(exchangeOrder?.realised_pnl ?? exchangeOrder?.realized_pnl ?? exchangeOrder?.pnl),
      rawResponse: JSON.stringify(data),
    });

    if (!res.ok) {
      return NextResponse.json({ success: false, message: readableExchangeError(data) }, { status: res.status });
    }

    return NextResponse.json({ success: true, data: exchangeOrder });
  } catch (error: any) {
    console.error("PLACE ORDER ERROR", error);
    return NextResponse.json(
      { success: false, message: "Failed to place order — please try again" },
      { status: 500 },
    );
  }
}
