import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");

  try {
    const payload = {
      exchange: "EXCHANGE_2",
      ...(symbol && { symbol: symbol.toLowerCase() }),
    };

    const keys = await getKeysFromRequest(req as any);
    const { url, headers } = buildSignedRequest("POST", "/futures/orders/open", payload, keys?.apiKey, keys?.apiSecret);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    const data = JSON.parse(raw);
    const responsePayload = data?.data ?? data;
    let orders: any[] = [];

    if (Array.isArray(responsePayload)) {
      orders = responsePayload;
    } else if (Array.isArray(responsePayload?.orders)) {
      orders = responsePayload.orders;
    } else if (Array.isArray(responsePayload?.data)) {
      orders = responsePayload.data;
    } else if (responsePayload && typeof responsePayload === "object") {
      orders = [responsePayload];
    }

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: JSON.stringify(data), status: res.status },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, data: orders });
  } catch (error: any) {
    console.log("OPEN ORDERS ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}