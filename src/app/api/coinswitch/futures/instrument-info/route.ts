import { NextResponse, NextRequest } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { requireKeysFromRequest } from "@/app/api/coinswitch/_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  try {
    const keys = await requireKeysFromRequest(req as any);
    const { url, headers } = buildSignedRequest("GET", "/futures/instrument_info", { exchange: "EXCHANGE_2" }, keys?.apiKey, keys?.apiSecret);

    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const data = await res.json();

    if (!res.ok) throw new Error(JSON.stringify(data));

    return NextResponse.json({ success: true, data: data.data });
  } catch (error: any) {
    console.log("INSTRUMENT INFO ERROR", error);
    return errorResponse(error, 500, "Request failed", "/api/coinswitch/futures/instrument-info");
  }
}