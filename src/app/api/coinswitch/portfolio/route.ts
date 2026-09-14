import { NextResponse, NextRequest } from "next/server";
import { buildSignedRequest } from "@/lib/coinswitch/reference-client";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";

export async function GET(req: NextRequest) {
  try {
    const keys = await getKeysFromRequest(req as any);
    if (!keys?.apiKey || !keys?.apiSecret) {
      throw new Error("No saved CoinSwitch credentials were found for this account. Please reconnect your CoinSwitch account.");
    }

    const { url, headers } = await buildSignedRequest("GET", "/user/portfolio", undefined, keys.apiKey, keys.apiSecret);

    const response = await fetch(url, { method: "GET", headers });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
