import { NextRequest } from "next/server";
import { fail, getBacktestService, ok, requireUserId } from "../../_helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { id } = await params;
    const backtestId = Number(id);
    if (!Number.isFinite(backtestId)) return fail(400, "Invalid backtest id");
    const data = await getBacktestService().getDetail(userId, backtestId);
    if (!data) return fail(404, "Backtest not found");
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/backtests/[id]]", error);
    return fail(500, error?.message ?? "Failed to load backtest");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { id } = await params;
    const backtestId = Number(id);
    if (!Number.isFinite(backtestId)) return fail(400, "Invalid backtest id");
    const deleted = await getBacktestService().remove(userId, backtestId);
    if (!deleted) return fail(404, "Backtest not found");
    return ok({ deleted: true });
  } catch (error: any) {
    console.error("[analytics/backtests/[id]] delete", error);
    return fail(500, error?.message ?? "Failed to delete backtest");
  }
}
