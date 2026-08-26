import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, requireUserId } from "../_helpers";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { botId } = parseFilters(new URL(req.url));
    const data = await getAnalyticsService().getOrders(userId, botId ?? undefined);
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/orders]", error);
    return fail(500, error?.message ?? "Failed to load active orders");
  }
}
