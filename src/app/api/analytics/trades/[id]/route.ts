import { NextRequest } from "next/server";
import { fail, getAnalyticsService, ok, requireUserId } from "../../_helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { id } = await params;
    const tradeId = Number(id);
    if (!Number.isFinite(tradeId)) return fail(400, "Invalid trade id");
    const data = await getAnalyticsService().getTradeDetail(userId, tradeId);
    if (!data) return fail(404, "Trade not found");
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/trades/[id]]", error);
    return fail(500, error?.message ?? "Failed to load trade detail");
  }
}
