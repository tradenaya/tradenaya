import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";

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
    const { url, headers } = buildSignedRequest("GET", "/futures/order", {
      order_id: orderId,
    });

    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const data = await res.json();

    if (!res.ok) throw new Error(JSON.stringify(data));

    return NextResponse.json({ success: true, data: data.data.order });
  } catch (error: any) {
    console.log("ORDER STATUS ERROR", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}