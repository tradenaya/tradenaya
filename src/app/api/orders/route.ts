import { NextRequest } from "next/server";
import { getCustomerFromRequest } from "@/lib/auth";
import { orderHistoryService } from "@/automation/order-history/service";

export async function GET(req: NextRequest) {
  const customer = getCustomerFromRequest(req);
  if (!customer) return Response.json({ success: false, message: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));
    const search = url.searchParams.get("search") ?? "";
    const data = await orderHistoryService.getOrders(customer.customerId, { page, pageSize, search });
    return Response.json({ success: true, data });
  } catch (error: any) {
    console.error("[orders]", error);
    return Response.json(
      { success: false, message: error?.message ?? "Failed to load order history" },
      { status: 500 },
    );
  }
}
