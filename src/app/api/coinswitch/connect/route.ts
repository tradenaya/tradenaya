import { NextResponse, NextRequest } from "next/server";
import { verifyConnection } from "@/app/services/coinswitch.service";
import { saveKeysForUser } from "@/lib/coinswitch.store";
import { getCustomerFromRequest } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const customer = getCustomerFromRequest(request as any);
    if (!customer) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const apiKey = body?.apiKey || process.env.COINSWITCH_API_KEY;
    const apiSecret = body?.apiSecret || process.env.COINSWITCH_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ success: false, message: "CoinSwitch credentials missing" }, { status: 400 });
    }

    // verify connection first
    const response = await verifyConnection(apiKey, apiSecret);

    // save keys for this user (encrypted)
    await saveKeysForUser(customer.customerId, apiKey, apiSecret);

    return NextResponse.json({ success: true, data: response });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}