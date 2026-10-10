import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, requireUserId } from "../_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { botId } = parseFilters(new URL(req.url));
    const data = await getAnalyticsService().getOrders(userId, botId ?? undefined);
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/orders]", error);
    return errorResponse(error, 500, "Failed to load active orders", "/api/analytics/orders");
  }
}
