import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";

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
}

export async function POST(req: NextRequest) {
  try {
    const body: PlaceOrderBody = await req.json();

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
      body.quantity = 0;
      body.reduce_only = true;
    }

    const orderPayload: Record<string, any> = {
      exchange: "EXCHANGE_2",
      symbol: body.symbol.toLowerCase(), // kline route lowercases symbol too — matching convention
      side: body.side,
      order_type: body.order_type,
      quantity: body.quantity,
      reduce_only: body.reduce_only ?? false,
      time_in_force: body.time_in_force ?? "GTC",
      client_order_id: body.client_order_id ?? crypto.randomUUID(),
    };

    if (body.price !== undefined) orderPayload.price = body.price;
    if (body.trigger_price !== undefined) orderPayload.trigger_price = body.trigger_price;

    const { url, headers } = buildSignedRequest("POST", "/futures/order", orderPayload);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(orderPayload),
    });

    const data = await res.json();

    if (!res.ok) throw new Error(JSON.stringify(data));

    return NextResponse.json({ success: true, data: data.data });
  } catch (error: any) {
    console.log("PLACE ORDER ERROR", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}