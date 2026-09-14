import type { NextRequest } from "next/server";
import { fail, ok, requireUserId } from "@/app/api/bots/_helpers";

/**
 * POST /api/bots/sync
 *
 * Manual exchange→DB position reconciliation. Runs the same full recovery
 * pass as the boot-time sweep and returns a summary of what changed. Safe to
 * call multiple times: an already-consistent position is verified again and
 * left untouched. No positions are closed by this endpoint — positions are
 * only marked closed when the exchange confirms they are gone.
 */
export async function POST(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  void userId;

  try {
    const { positionMonitor } = await import("@/automation/position/PositionMonitor");
    const summary = await positionMonitor.syncFromExchange();
    return ok(summary);
  } catch (error: any) {
    console.error("[api] /api/bots/sync failed", error);
    return fail(500, error?.message ?? "Failed to sync positions with exchange");
  }
}