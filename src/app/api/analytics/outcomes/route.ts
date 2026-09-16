import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, requireUserId } from "../_helpers";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const data = await getAnalyticsService().getOutcomeAnalytics(userId, parseFilters(new URL(req.url)));
    return ok(data);
  } catch (error) {
    console.error("[analytics/outcomes]", error);
    return fail(500, error instanceof Error ? error.message : "Failed to load trade outcomes");
  }
}