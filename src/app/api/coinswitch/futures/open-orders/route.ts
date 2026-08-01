import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");

  try {
    const payload = {
      exchange: "EXCHANGE_2",
      ...(symbol && { symbol: symbol.toLowerCase() }),
    };

    const { url, headers } = buildSignedRequest("POST", "/futures/orders/open", payload);

    const res = await fetch(url, {
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
    console.log("OPEN ORDERS ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}