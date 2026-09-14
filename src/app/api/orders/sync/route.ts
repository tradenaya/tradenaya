import { NextRequest } from "next/server";
import { getCustomerFromRequest } from "@/lib/auth";
import { orderHistoryService } from "@/automation/order-history/service";

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
    const message = error instanceof Error ? error.message : "Failed to sync order history";
    console.error("[orders/sync]", error);
    return Response.json({ success: false, message }, { status: 500 });
  }
}