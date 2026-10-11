import { NextResponse, NextRequest } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { requireKeysFromRequest, paperFetch } from "@/app/api/coinswitch/_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  try {
    const payload = { exchange: "EXCHANGE_2", limit: 50 };
    const keys = await requireKeysFromRequest(req as any);
    const { url, headers } = buildSignedRequest("POST", "/futures/orders/open", payload, keys?.apiKey, keys?.apiSecret);

    const res = (await paperFetch(req as any, "POST", "/futures/orders/open", payload)) ?? await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    const data = JSON.parse(raw);

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: JSON.stringify(data), status: res.status },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, data: data.data });
  } catch (error: any) {
    console.log("ALL OPEN ORDERS ERROR", error);
    return errorResponse(error, 500, "Request failed", "/api/coinswitch/futures/all-open-orders");
  }
}