import { NextResponse, NextRequest } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";

export async function GET(req: NextRequest) {
  try {
    const requestPayload = { exchange: "EXCHANGE_2", limit: 50 };
    const keys = await getKeysFromRequest(req as any);
    const { url, headers } = buildSignedRequest("POST", "/futures/orders/open", requestPayload, keys?.apiKey, keys?.apiSecret);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload),
    });

    const raw = await res.text();
    const data = JSON.parse(raw);
    const responsePayload = data?.data ?? data;
    let orders: unknown[] = [];

    if (Array.isArray(responsePayload)) {
      orders = responsePayload;
    } else if (responsePayload && typeof responsePayload === "object") {
      const maybeOrders = (responsePayload as { orders?: unknown[] }).orders;
      const maybeData = (responsePayload as { data?: unknown[] }).data;
      if (Array.isArray(maybeOrders)) {
        orders = maybeOrders;
      } else if (Array.isArray(maybeData)) {
        orders = maybeData;
      } else {
        orders = [responsePayload];
      }
    }

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: JSON.stringify(data), status: res.status },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, data: orders });
  } catch (error: any) {
    console.log("ALL OPEN ORDERS ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}