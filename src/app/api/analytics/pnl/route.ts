import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, parseGranularity, requireUserId } from "../_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const url = new URL(req.url);
    const data = await getAnalyticsService().getPnl(userId, parseGranularity(url), parseFilters(url));
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/pnl]", error);
    return errorResponse(error, 500, "Failed to load PnL series", "/api/analytics/pnl");
  }
}
