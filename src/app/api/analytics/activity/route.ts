import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, requireUserId } from "../_helpers";
import { errorResponse } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const url = new URL(req.url);
    const botId = url.searchParams.get("botId") ? Number(url.searchParams.get("botId")) : undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 50;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : 0;
    const data = await getAnalyticsService().getActivity(userId, { botId, limit, offset });
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/activity]", error);
    return errorResponse(error, 500, "Failed to load activity feed", "/api/analytics/activity");
  }
}
