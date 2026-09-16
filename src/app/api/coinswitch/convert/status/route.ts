import { NextResponse, NextRequest } from "next/server";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";
import { getConvertWalletStatus } from "@/lib/coinswitch/convert";

/**
 * GET /api/coinswitch/convert/status
 *
 * Conversion status for the INR → USDT flow: how much INR sits in the spot
 * wallet, how much USDT sits in the spot wallet, how much USDT is in the
 * Futures wallet (what the bots actually trade with), and the live rate for the
 * estimate. Never throws — each upstream call is isolated so one failure cannot
 * hide the rest.
 */
export async function GET(req: NextRequest) {
  try {
    const keys = await getKeysFromRequest(req as any);
    if (!keys?.apiKey || !keys?.apiSecret) {
      return NextResponse.json(
        { success: false, message: "No saved CoinSwitch credentials were found for this account. Please reconnect your CoinSwitch account." },
        { status: 401 },
      );
    }

    const status = await getConvertWalletStatus({ apiKey: keys.apiKey, apiSecret: keys.apiSecret });
    return NextResponse.json({ success: true, data: status });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message ?? "Failed to load conversion status" }, { status: 502 });
  }
}