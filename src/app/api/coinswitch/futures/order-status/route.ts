import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { requireKeysFromRequest, paperFetch } from "@/app/api/coinswitch/_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("order_id");

  if (!orderId) {
    return NextResponse.json(
      { success: false, message: "order_id required" },
      { status: 400 }
    );
  }

  try {
    const keys = await requireKeysFromRequest(req as any);
    const { url, headers } = buildSignedRequest("GET", "/futures/order", { order_id: orderId }, keys?.apiKey, keys?.apiSecret);

    const res = (await paperFetch(req as any, "GET", "/futures/order", { order_id: orderId })) ?? await fetch(url, { method: "GET", headers, cache: "no-store" });
    const data = await res.json();

    if (!res.ok) throw new Error(JSON.stringify(data));

    return NextResponse.json({ success: true, data: data.data.order });
  } catch (error: any) {
    console.log("ORDER STATUS ERROR", error);
    return errorResponse(error, 500, "Request failed", "/api/coinswitch/futures/order-status");
  }
}