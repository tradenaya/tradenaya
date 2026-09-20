import { NextResponse, NextRequest } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";

export async function GET(req: NextRequest) {
  try {
    const keys = await getKeysFromRequest(req as any);
    const { url, headers } = buildSignedRequest("GET", "/futures/wallet_balance", undefined, keys?.apiKey, keys?.apiSecret);

    const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
    const data = await res.json();

    if (!res.ok) throw new Error(JSON.stringify(data));

    return NextResponse.json({ success: true, data: data.data });
  } catch (error: any) {
    console.log("WALLET BALANCE ERROR", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}