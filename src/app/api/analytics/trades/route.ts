import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, parsePagedQuery, requireUserId } from "../_helpers";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const url = new URL(req.url);
    const { page, pageSize, sortBy, sortDir } = parsePagedQuery(url);
    const data = await getAnalyticsService().getTrades(userId, parseFilters(url), page, pageSize, sortBy, sortDir);
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/trades]", error);
    return fail(500, error?.message ?? "Failed to load closed trades");
  }
}
