import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";

export async function POST(req: NextRequest) {
  try {
    const { order_id } = await req.json();

    if (!order_id) {
      return NextResponse.json({ success: false, message: "order_id required" }, { status: 400 });
    }

    const payload = { exchange: "EXCHANGE_2", order_id };

    const { url, headers } = buildSignedRequest("DELETE", "/futures/order", payload);

    const res = await fetch(url, {
      method: "DELETE",
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
    console.log("CANCEL ORDER ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}