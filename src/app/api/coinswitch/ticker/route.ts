import { NextResponse, NextRequest } from "next/server";
import { coinSwitchRequest } from "@/lib/coinswitch";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";

export async function GET(request: NextRequest) {
  try {
    const keys = await getKeysFromRequest(request as any);
    const apiKey = keys?.apiKey;
    const apiSecret = keys?.apiSecret;

    if (!apiKey || !apiSecret) {
      throw new Error("No saved CoinSwitch credentials were found for this account. Please reconnect your CoinSwitch account.");
    }

    const result = await coinSwitchRequest("/24hr/all-pairs/ticker?exchange=coinswitchx", "GET", apiKey, apiSecret);

    return NextResponse.json(result);
  } catch (error: any) {
    console.log("TICKER ERROR", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}