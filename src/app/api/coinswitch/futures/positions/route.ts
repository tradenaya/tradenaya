import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json({ success: false, message: "symbol required" }, { status: 400 });
  }

  try {
    const { url, headers } = buildSignedRequest("GET", "/futures/positions", {
      exchange: "EXCHANGE_2",
      symbol: symbol.toLowerCase(),
    });

    console.log("=== POSITIONS DEBUG START ===");
    console.log("POSITIONS URL:", url);

    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const raw = await res.text();

    console.log("POSITIONS STATUS:", res.status);
    console.log("POSITIONS RAW BODY:", raw);
    console.log("=== POSITIONS DEBUG END ===");

    const data = JSON.parse(raw);

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: JSON.stringify(data), status: res.status },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, raw: data });
  } catch (error: any) {
    console.log("POSITIONS ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}