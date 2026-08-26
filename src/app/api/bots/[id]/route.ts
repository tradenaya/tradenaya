import type { NextRequest } from "next/server";
import { botScheduler } from "@/automation/scheduler/BotScheduler";
import { fail, ok, parseBotId, requireUserId, sanitizeConfig } from "../_helpers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { id } = await params;
    const botId = parseBotId(id);
    if (botId == null) return fail(400, "Invalid bot id");
    await botScheduler.ensureStarted();
    const bot = await botScheduler.getBot(userId, botId);
    if (!bot) return fail(404, "Bot not found");
    return ok(bot);
  } catch (error: any) {
    console.error("[bots/[id]]", error);
    return fail(500, error?.message ?? "Failed to load bot");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { id } = await params;
    const botId = parseBotId(id);
    if (botId == null) return fail(400, "Invalid bot id");
    const body = await req.json();
    const config = sanitizeConfig(body ?? {});
    const bot = await botScheduler.updateConfig(userId, botId, config);
    return ok(bot);
  } catch (error: any) {
    console.error("[bots/[id]] patch", error);
    return fail(400, error?.message ?? "Failed to update bot");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { id } = await params;
    const botId = parseBotId(id);
    if (botId == null) return fail(400, "Invalid bot id");
    const deleted = await botScheduler.deleteBot(userId, botId);
    if (!deleted) return fail(404, "Bot not found");
    return ok({ deleted: true });
  } catch (error: any) {
    console.error("[bots/[id]] delete", error);
    return fail(400, error?.message ?? "Failed to delete bot");
  }
}
