import type { NextRequest } from "next/server";
import { botScheduler } from "@/automation/scheduler/BotScheduler";
import { fail, ok, requireUserId } from "../_helpers";

/**
 * POST /api/bots/cleanup-activity
 *
 * Manually prune activity log rows older than one hour from
 * automation_scheduler_events, automation_position_events and
 * automation_execution_notifications. Safe to call any time — the logs are
 * display-only and rebuilt from the latest cycle. Returns rows removed per
 * table.
 */
export async function POST(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    await botScheduler.ensureStarted();
    const removed = await botScheduler.cleanupActivityLogs();
    return ok(removed);
  } catch (error: any) {
    console.error("[bots/cleanup-activity]", error);
    return fail(500, error?.message ?? "Failed to clean activity logs");
  }
}