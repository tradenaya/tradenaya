import { NextResponse, NextRequest } from "next/server";
import { getCustomerFromRequest } from "@/lib/auth";
import { setStatusForUser } from "@/lib/coinswitch.store";
import { errorResponse } from "@/lib/api-error";

export async function POST(request: NextRequest) {
  try {
    const customer = getCustomerFromRequest(request as any);
    if (!customer) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    await setStatusForUser(customer.customerId, "I");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error, 500, "Request failed", "/api/coinswitch/disconnect");
  }
}
