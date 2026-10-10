import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, requireUserId } from "../_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const data = await getAnalyticsService().getEquity(userId, parseFilters(new URL(req.url)));
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/equity]", error);
    return errorResponse(error, 500, "Failed to load equity curve", "/api/analytics/equity");
  }
}
