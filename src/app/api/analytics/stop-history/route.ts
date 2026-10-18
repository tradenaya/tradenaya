import { NextRequest } from "next/server";
import { fail, ok, requireUserId } from "../_helpers";
import { errorResponse } from "@/lib/api-error";
import { getStopHistory } from "@/automation/position/stop-history";

/** GET /api/analytics/stop-history?positionId=N (or executionId=N) — stop-loss / target history with exchange proof. */
export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  const params = new URL(req.url).searchParams;
  const id = (k: string) => {
    const n = Number(params.get(k));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const positionId = id("positionId");
  const executionId = id("executionId");
  if (!positionId && !executionId) return fail(400, "positionId or executionId is required");
  try {
    const history = await getStopHistory(userId, { positionId, executionId });
    if (!history) return fail(404, "Position not found");
    return ok(history);
  } catch (error) {
    console.error("[analytics/stop-history]", error);
    return errorResponse(error, 500, "Failed to load stop-loss history", "/api/analytics/stop-history");
  }
}
