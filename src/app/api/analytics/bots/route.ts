import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, requireUserId } from "../_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const data = await getAnalyticsService().getBotSummaries(userId, parseFilters(new URL(req.url)));
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/bots]", error);
    return errorResponse(error, 500, "Failed to load bot summaries", "/api/analytics/bots");
  }
}
