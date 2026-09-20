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
    const { url, headers } = buildSignedRequest("GET", "/futures/leverage", { symbol: symbol.toLowerCase(), exchange: "EXCHANGE_2" }, keys?.apiKey, keys?.apiSecret);

    console.log("LEVERAGE GET URL:", url);

    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const raw = await res.text();

    console.log("LEVERAGE GET STATUS:", res.status);
    console.log("LEVERAGE GET RAW BODY:", raw);

    const data = JSON.parse(raw);

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: JSON.stringify(data), status: res.status },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, data: data.data });
  } catch (error: any) {
    console.log("GET LEVERAGE ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { symbol, leverage } = body;

    if (!symbol || !leverage) {
      return NextResponse.json(
        { success: false, message: "symbol and leverage required" },
        { status: 400 }
      );
    }

    const payload = {
      symbol: String(symbol).toLowerCase(),
      exchange: "EXCHANGE_2",
      leverage: Number(leverage),
    };

    const keys = await getKeysFromRequest(req as any);
    const { url, headers } = buildSignedRequest("POST", "/futures/leverage", payload, keys?.apiKey, keys?.apiSecret);

    console.log("LEVERAGE POST URL:", url);
    console.log("LEVERAGE POST PAYLOAD:", payload);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const raw = await res.text();

    console.log("LEVERAGE POST STATUS:", res.status);
    console.log("LEVERAGE POST RAW BODY:", raw);

    const data = JSON.parse(raw);

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: JSON.stringify(data), status: res.status },
        { status: res.status }
      );
    }

    return NextResponse.json({ success: true, data: data.data });
  } catch (error: any) {
    console.log("UPDATE LEVERAGE ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}