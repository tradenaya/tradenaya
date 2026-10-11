import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, parseFilters, requireUserId } from "../_helpers";
import { errorResponse } from "@/lib/api-error";
import { STRATEGIES } from "@/automation/strategy/catalog";

/**
 * GET /api/analytics/compare?strategies=A,B&startTime=…&endTime=…
 * Live closed-trade results per strategy over one window. With no
 * `strategies` param every known strategy is compared.
 */
export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const url = new URL(req.url);
    const { startTime, endTime } = parseFilters(url);
    const requested = (url.searchParams.get("strategies") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const strategies = requested.length ? requested : STRATEGIES.map((s) => s.id);
    const data = await getAnalyticsService().getStrategyComparison(userId, strategies, startTime ?? null, endTime ?? null);
    return ok(data);
  } catch (error: unknown) {
    console.error("[analytics/compare]", error);
    return errorResponse(error, 500, "Failed to compare strategies", "/api/analytics/compare");
  }
}
