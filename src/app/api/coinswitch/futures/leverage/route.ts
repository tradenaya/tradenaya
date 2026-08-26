import { NextRequest, NextResponse } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";

function readableExchangeError(data: unknown): string {
  if (!data || typeof data !== "object") return "Request rejected by the exchange";
  const obj = data as Record<string, any>;
  const msg = obj.message ?? obj.error ?? obj.msg;
  if (typeof msg === "string" && msg) return msg;
  const reason = obj.data?.message ?? obj.data?.error;
  if (typeof reason === "string" && reason) return reason;
  return "Request rejected by the exchange";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json({ success: false, message: "symbol required" }, { status: 400 });
  }

  try {
    const keys = await getKeysFromRequest(req);
    if (!keys) {
      return NextResponse.json(
        { success: false, message: "Not authenticated — please sign in and reconnect your CoinSwitch account." },
        { status: 401 },
      );
    }
    const { url, headers } = buildSignedRequest("GET", "/futures/leverage", { symbol: symbol.toLowerCase(), exchange: "EXCHANGE_2" }, keys.apiKey, keys.apiSecret);

    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const raw = await res.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: readableExchangeError(data) },
        { status: res.status },
      );
    }

    return NextResponse.json({ success: true, data: data.data });
  } catch {
    return NextResponse.json({ success: false, message: "Failed to load leverage" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body" }, { status: 400 });
  }

  const { symbol, leverage } = body;
  if (!symbol) {
    return NextResponse.json({ success: false, message: "symbol required" }, { status: 400 });
  }
  const lev = Number(leverage);
  if (!Number.isFinite(lev) || lev <= 0) {
    return NextResponse.json({ success: false, message: "leverage must be a positive number" }, { status: 400 });
  }

  try {
    const keys = await getKeysFromRequest(req);
    if (!keys) {
      return NextResponse.json(
        { success: false, message: "Not authenticated — please sign in and reconnect your CoinSwitch account." },
        { status: 401 },
      );
    }

    const payload = {
      symbol: String(symbol).toLowerCase(),
      exchange: "EXCHANGE_2",
      leverage: lev,
    };

    const { url, headers } = buildSignedRequest("POST", "/futures/leverage", payload, keys.apiKey, keys.apiSecret);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: readableExchangeError(data) },
        { status: res.status },
      );
    }

    return NextResponse.json({ success: true, data: data.data });
  } catch {
    return NextResponse.json({ success: false, message: "Failed to update leverage" }, { status: 500 });
  }
}
