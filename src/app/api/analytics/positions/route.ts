import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, requireUserId } from "../_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { botId, strategy } = parseFilters(new URL(req.url));
    const data = await getAnalyticsService().getPositions(userId, botId ?? undefined, strategy);
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/positions]", error);
    return errorResponse(error, 500, "Failed to load open positions", "/api/analytics/positions");
  }
}
