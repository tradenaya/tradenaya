import { NextResponse, NextRequest } from "next/server";
import { coinSwitchRequest } from "@/lib/coinswitch";
import { requireKeysFromRequest } from "@/app/api/coinswitch/_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(request: NextRequest) {
  try {
    const keys = await requireKeysFromRequest(request as any, { allowServerKeys: true });
    const apiKey = keys?.apiKey || process.env.COINSWITCH_API_KEY!;
    const apiSecret = keys?.apiSecret || process.env.COINSWITCH_API_SECRET!;

    const result = await coinSwitchRequest("/24hr/all-pairs/ticker?exchange=coinswitchx", "GET", apiKey, apiSecret);

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 500, "Failed to load ticker", "/api/coinswitch/ticker");
  }
}