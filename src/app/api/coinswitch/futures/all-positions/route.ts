import { NextResponse, NextRequest } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";

async function callSigned(req: NextRequest, method: "GET" | "POST", endpoint: string, payload?: Record<string, any>) {
  const keys = await getKeysFromRequest(req as any);
  const { url, headers } = buildSignedRequest(method, endpoint, method === "GET" ? payload : undefined, keys?.apiKey, keys?.apiSecret);

  const res = await fetch(url, { method, headers, ...(method === "POST" && payload ? { body: JSON.stringify(payload) } : {}) });

  const raw = await res.text();
  const data = JSON.parse(raw);
  const payloadData = data?.data ?? data;
  let result: any[] = [];

  if (Array.isArray(payloadData)) {
    result = payloadData;
  } else if (Array.isArray(payloadData?.positions)) {
    result = payloadData.positions;
  } else if (Array.isArray(payloadData?.data)) {
    result = payloadData.data;
  } else if (payloadData && typeof payloadData === "object") {
    result = [payloadData];
  }

  if (!res.ok) throw new Error(JSON.stringify(data));
  return result;
}

export async function GET(req: NextRequest) {
  try {
    const keys = await getKeysFromRequest(req as any);
    const { url, headers } = buildSignedRequest("GET", "/futures/positions", { exchange: "EXCHANGE_2" }, keys?.apiKey, keys?.apiSecret);

    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const raw = await res.text();
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

    const filtered = positions.filter((p) => p && Number(p.position_size) > 0);
    return NextResponse.json({ success: true, data: filtered });
  } catch (error: any) {
    console.log("ALL POSITIONS ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}