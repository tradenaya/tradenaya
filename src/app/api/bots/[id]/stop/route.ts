import type { NextRequest } from "next/server";
import { botScheduler } from "@/automation/scheduler/BotScheduler";
import { fail, ok, parseBotId, requireUserId } from "../../_helpers";
import { errorResponse } from "@/lib/api-error";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { id } = await params;
    const botId = parseBotId(id);
    if (botId == null) return fail(400, "Invalid bot id");
    const bot = await botScheduler.getBot(userId, botId);
    if (!bot) return fail(404, "Bot not found");
    await botScheduler.stopBot(userId, botId);
    return ok({ stopped: true });
  } catch (error: any) {
    console.error("[bots/[id]/stop]", error);
    return errorResponse(error, 400, "Failed to stop bot", "/api/bots/[id]/stop");
  }
}
