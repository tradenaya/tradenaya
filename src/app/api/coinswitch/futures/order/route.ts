import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";
import { db } from "@/lib/db";
import { getCustomerFromRequest } from "@/lib/auth";

interface PlaceOrderBody {
  symbol: string;
  side: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT" | "TAKE_PROFIT_MARKET" | "STOP_MARKET";
  quantity: number;
  price?: number;
  trigger_price?: number;
  reduce_only?: boolean;
  time_in_force?: "GTC" | "IOC" | "FOK";
  client_order_id?: string;
  order_context?: "entry" | "stop_loss" | "take_profit";
  user_code?: string;
}

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
  rawResponse: string | null;
}) {
  await ensureFuturesOrdersTable();

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
      raw_response
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
      payload.rawResponse,
    ]
  );
}

export async function POST(req: NextRequest) {
  try {
    const body: PlaceOrderBody = await req.json();
    const customer = getCustomerFromRequest(req as any);

    if (!body.symbol || !body.side || !body.order_type) {
      return NextResponse.json(
        { success: false, message: "symbol, side, and order_type are required" },
        { status: 400 }
      );
    }

    if (body.order_type === "LIMIT" && !body.price) {
      return NextResponse.json(
        { success: false, message: "price is required for LIMIT orders" },
        { status: 400 }
      );
    }

    if (body.order_type === "TAKE_PROFIT_MARKET" || body.order_type === "STOP_MARKET") {
      if (!body.trigger_price) {
        return NextResponse.json(
          { success: false, message: "trigger_price is required for TP/SL orders" },
          { status: 400 }
        );
      }
      if (body.quantity === undefined || Number(body.quantity) <= 0) {
        return NextResponse.json(
          { success: false, message: "quantity is required for TP/SL orders" },
          { status: 400 }
        );
      }
      body.reduce_only = true;
    }

    const clientOrderId = body.client_order_id ?? crypto.randomUUID();
    const orderContext = body.order_context ?? (body.order_type === "STOP_MARKET" ? "stop_loss" : body.order_type === "TAKE_PROFIT_MARKET" ? "take_profit" : "entry");

    const orderPayload: Record<string, any> = {
      exchange: "EXCHANGE_2",
      symbol: body.symbol.toLowerCase(), // kline route lowercases symbol too — matching convention
      side: body.side,
      order_type: body.order_type,
      quantity: body.quantity,
      reduce_only: body.reduce_only ?? false,
      time_in_force: body.time_in_force ?? "GTC",
      client_order_id: clientOrderId,
    };

    if (body.price !== undefined) orderPayload.price = body.price;
    if (body.trigger_price !== undefined) orderPayload.trigger_price = body.trigger_price;

    const keys = await getKeysFromRequest(req as any);
    const { url, headers } = buildSignedRequest("POST", "/futures/order", orderPayload, keys?.apiKey, keys?.apiSecret);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(orderPayload),
    });

    const data = await res.json();
    const exchangeOrder = data?.data ?? data;
    const responseStatus = exchangeOrder?.status ?? null;

    await saveFuturesOrderRecord({
      userId: customer?.customerId ?? null,
      userEmail: customer?.email ?? null,
      userCode: body.user_code ?? (customer ? `CUS-${customer.customerId}` : null),
      symbol: body.symbol.toLowerCase(),
      side: body.side,
      orderType: body.order_type,
      orderContext,
      quantity: body.quantity ?? null,
      price: body.price ?? null,
      triggerPrice: body.trigger_price ?? null,
      reduceOnly: body.reduce_only ?? false,
      status: res.ok ? (responseStatus ?? "PENDING") : "FAILED",
      exchangeOrderId: exchangeOrder?.order_id ?? null,
      clientOrderId,
      responseStatus,
      message: res.ok ? null : JSON.stringify(data),
      amountUsed: body.price ? Number(body.price) * Number(body.quantity) : null,
      rawResponse: JSON.stringify(data),
    });

    if (!res.ok) throw new Error(JSON.stringify(data));

    return NextResponse.json({ success: true, data: exchangeOrder });
  } catch (error: any) {
    console.log("PLACE ORDER ERROR", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}