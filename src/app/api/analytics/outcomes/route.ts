import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, requireUserId } from "../_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const data = await getAnalyticsService().getOutcomeAnalytics(userId, parseFilters(new URL(req.url)));
    return ok(data);
  } catch (error) {
    console.error("[analytics/outcomes]", error);
    return errorResponse(error, 500, "Failed to load trade outcomes", "/api/analytics/outcomes");
  }
}