import { NextRequest } from "next/server";
import { getCustomerFromRequest } from "@/lib/auth";
import { orderHistoryService } from "@/automation/order-history/service";
import { errorResponse } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  const customer = getCustomerFromRequest(req);
  if (!customer) return Response.json({ success: false, message: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const days = body?.days != null ? Number(body.days) : undefined;
    const data = await orderHistoryService.syncClosedOrdersFromExchange(
      customer.customerId,
      days != null ? { days } : {},
    );
    return Response.json({ success: true, data });
  } catch (error: unknown) {
    return errorResponse(error, 500, "Failed to sync order history", "/api/orders/sync");
  }
}