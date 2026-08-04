import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json({ success: false, message: "symbol required" }, { status: 400 });
  }

  try {
    const keys = await getKeysFromRequest(req as any);
    const { url, headers } = buildSignedRequest("GET", "/futures/positions", { exchange: "EXCHANGE_2", symbol: symbol.toLowerCase() }, keys?.apiKey, keys?.apiSecret);

    console.log("=== POSITIONS DEBUG START ===");
    console.log("POSITIONS URL:", url);

    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const raw = await res.text();

    console.log("POSITIONS STATUS:", res.status);
    console.log("POSITIONS RAW BODY:", raw);
    console.log("=== POSITIONS DEBUG END ===");

    const data = JSON.parse(raw);
    const payload = data?.data ?? data;
    let positions: any[] = [];

    if (Array.isArray(payload)) {
      positions = payload;
    } else if (Array.isArray(payload?.positions)) {
      positions = payload.positions;
    } else if (Array.isArray(payload?.data)) {
      positions = payload.data;
    } else if (payload && typeof payload === "object") {
      positions = [payload];
    }

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: JSON.stringify(data), status: res.status },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, data: positions });
  } catch (error: any) {
    console.log("POSITIONS ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}